import { pool } from '../db.js'
import { requireAdmin, requireMember } from '../middleware/auth.js'

const MPESA_BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

function normalizePhone(value) {
  const raw = String(value || '').replace(/\s+/g, '')
  if (/^2547\d{8}$/.test(raw)) return raw
  if (/^07\d{8}$/.test(raw)) return `254${raw.slice(1)}`
  if (/^01\d{8}$/.test(raw)) return `254${raw.slice(1)}`
  return null
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

async function mpesaToken() {
  const key = requiredEnv('MPESA_CONSUMER_KEY')
  const secret = requiredEnv('MPESA_CONSUMER_SECRET')
  const auth = Buffer.from(`${key}:${secret}`).toString('base64')
  const res = await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw new Error(`M-Pesa OAuth failed (${res.status})`)
  const body = await res.json()
  if (!body.access_token) throw new Error('M-Pesa OAuth returned no access token')
  return body.access_token
}

function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export default async function givingRoutes(app) {
  app.post('/api/giving/mpesa/stkpush', { preHandler: [requireMember] }, async (req, reply) => {
    try {
      const amount = Number(req.body?.amount)
      const phone = normalizePhone(req.body?.phone)
      const purpose = String(req.body?.purpose || 'General Giving').trim().slice(0, 120) || 'General Giving'
      if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return reply.code(400).send({ error: 'amount must be between KES 1 and 1,000,000' })
      if (!phone) return reply.code(400).send({ error: 'valid Kenyan M-Pesa phone number required' })

      const shortCode = requiredEnv('MPESA_SHORTCODE')
      const passkey = requiredEnv('MPESA_PASSKEY')
      const callbackUrl = requiredEnv('MPESA_CALLBACK_URL')
      const token = await mpesaToken()
      const time = timestamp()
      const password = Buffer.from(`${shortCode}${passkey}${time}`).toString('base64')
      const amountRounded = Math.round(amount)
      const pending = await pool.query(
        `INSERT INTO giving_transactions (user_id, phone, amount_kes, purpose, provider, status, metadata)
         VALUES ($1,$2,$3,$4,'mpesa','pending',$5) RETURNING id`,
        [req.user.id, phone, amountRounded, purpose, JSON.stringify({ requestedBy: req.user.username })],
      )

      const res = await fetch(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: shortCode, Password: password, Timestamp: time,
          TransactionType: 'CustomerPayBillOnline', Amount: amountRounded,
          PartyA: phone, PartyB: shortCode, PhoneNumber: phone, CallBackURL: callbackUrl,
          AccountReference: `HARVEST-${pending.rows[0].id.slice(0, 8).toUpperCase()}`,
          TransactionDesc: purpose.slice(0, 20),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ResponseCode !== '0') {
        await pool.query(`UPDATE giving_transactions SET status='failed', provider_result_code=$2, provider_result_description=$3 WHERE id=$1`, [pending.rows[0].id, String(body.ResponseCode ?? res.status), String(body.ResponseDescription || 'M-Pesa request failed')])
        return reply.code(502).send({ error: 'M-Pesa request failed' })
      }
      await pool.query(`UPDATE giving_transactions SET merchant_request_id=$2, checkout_request_id=$3, metadata=metadata || $4::jsonb WHERE id=$1`, [pending.rows[0].id, body.MerchantRequestID, body.CheckoutRequestID, JSON.stringify({ customerMessage: body.CustomerMessage })])
      return reply.code(202).send({ transactionId: pending.rows[0].id, checkoutRequestId: body.CheckoutRequestID, message: body.CustomerMessage || 'Check your phone to complete the M-Pesa prompt.' })
    } catch (error) {
      req.log.error({ err: error }, 'giving stkpush failed')
      return reply.code(503).send({ error: 'Giving service is temporarily unavailable' })
    }
  })

  app.get('/api/giving/mine', { preHandler: [requireMember] }, async (req, reply) => {
    const { rows } = await pool.query(`SELECT id, amount_kes, purpose, provider, status, receipt_number, created_at, completed_at FROM giving_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.id])
    return reply.send(rows)
  })

  app.get('/api/giving/admin', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { rows } = await pool.query(`
      SELECT g.id, g.amount_kes, g.purpose, g.provider, g.status, g.receipt_number,
             g.phone, g.created_at, g.completed_at, u.username
      FROM giving_transactions g
      LEFT JOIN users u ON u.id=g.user_id
      ORDER BY g.created_at DESC LIMIT 500`)
    const totals = await pool.query(`SELECT COALESCE(SUM(amount_kes) FILTER (WHERE status='completed'),0) AS completed_kes, COUNT(*) FILTER (WHERE status='pending')::int AS pending_count FROM giving_transactions`)
    return reply.send({ transactions: rows, totals: totals.rows[0] })
  })

  // Safaricom callback. Only a CheckoutRequestID created by our server can mutate a ledger row.
  app.post('/api/giving/mpesa/callback', async (req, reply) => {
    try {
      const result = req.body?.Body?.stkCallback
      const checkoutId = String(result?.CheckoutRequestID || '')
      if (!checkoutId) return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' })
      const found = await pool.query(`SELECT id, status FROM giving_transactions WHERE checkout_request_id=$1`, [checkoutId])
      const tx = found.rows[0]
      if (!tx || tx.status === 'completed') return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' })

      const code = String(result.ResultCode ?? '')
      const metadata = Object.fromEntries((result.CallbackMetadata?.Item || []).map(item => [item.Name, item.Value]))
      if (code === '0') {
        const receipt = String(metadata.MpesaReceiptNumber || '').slice(0, 64)
        await pool.query(`UPDATE giving_transactions SET status='completed', receipt_number=$2, provider_result_code=$3, provider_result_description=$4, metadata=metadata || $5::jsonb, completed_at=now() WHERE id=$1`, [tx.id, receipt || null, code, String(result.ResultDesc || ''), JSON.stringify(metadata)])
      } else {
        await pool.query(`UPDATE giving_transactions SET status='failed', provider_result_code=$2, provider_result_description=$3 WHERE id=$1`, [tx.id, code, String(result.ResultDesc || 'M-Pesa payment failed')])
      }
      return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' })
    } catch (error) {
      req.log.error({ err: error }, 'giving callback failed')
      return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' })
    }
  })
}
