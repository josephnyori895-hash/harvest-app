// Port of server/src/routes/giving.js (pg → D1). M-Pesa flows unchanged (fetch is native).
import { query, uuid } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, httpError, ApiError } from '../lib/http.js'

function mpesaBase(env) {
  return String(env.MPESA_ENV || '') === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
}

function requiredEnv(env, name) {
  const value = env[name]
  if (!value) throw httpError(503, 'Giving service is temporarily unavailable')
  return value
}

function normalizePhone(value) {
  const raw = String(value || '').replace(/\s+/g, '')
  if (/^2547\d{8}$/.test(raw)) return raw
  if (/^07\d{8}$/.test(raw)) return `254${raw.slice(1)}`
  if (/^01\d{8}$/.test(raw)) return `254${raw.slice(1)}`
  return null
}

async function mpesaToken(env) {
  const key = requiredEnv(env, 'MPESA_CONSUMER_KEY')
  const secret = requiredEnv(env, 'MPESA_CONSUMER_SECRET')
  const auth = btoa(`${key}:${secret}`)
  const res = await fetch(`${mpesaBase(env)}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw httpError(503, 'Giving service is temporarily unavailable')
  const body = await res.json()
  if (!body.access_token) throw httpError(503, 'Giving service is temporarily unavailable')
  return body.access_token
}

function timestamp() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// btoa is ASCII-safe for UTF-8 bodies only after escaping; helper for JSON fetches.
async function postJson(url, headers, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

export async function handleGiving(request, env, ctx) {
  const path = new URL(request.url).pathname
  const user = ctx.user
  const method = request.method

  // GET /api/giving/config — public capability info for the Give screen.
  // Tells the app whether STK push is wired (secrets present) and the manual
  // Paybill fallback number (so members can still give before keys are added).
  if (path === '/api/giving/config' && method === 'GET') {
    const enabled = Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORTCODE && env.MPESA_PASSKEY && env.MPESA_CALLBACK_URL)
    return jsonResponse({ mpesa_enabled: enabled, paybill: String(env.PAYBILL_NUMBER || ''), env: String(env.MPESA_ENV || 'sandbox') })
  }

  // POST /api/giving/mpesa/stkpush
  if (path === '/api/giving/mpesa/stkpush' && method === 'POST') {
    const fresh = await requireMember(env, user)
    try {
      const body = await readJson(request)
      const amount = Number(body.amount)
      const phone = normalizePhone(body.phone)
      const purpose = String(body.purpose || 'General Giving').trim().slice(0, 120) || 'General Giving'
      if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) return errorResponse('amount must be between KES 1 and 1,000,000', 400)
      if (!phone) return errorResponse('valid Kenyan M-Pesa phone number required', 400)

      const shortCode = requiredEnv(env, 'MPESA_SHORTCODE')
      const passkey = requiredEnv(env, 'MPESA_PASSKEY')
      const callbackUrl = requiredEnv(env, 'MPESA_CALLBACK_URL')
      const token = await mpesaToken(env)
      const time = timestamp()
      const password = btoa(`${shortCode}${passkey}${time}`)
      const amountRounded = Math.round(amount)
      const id = uuid()
      const now = new Date().toISOString()
      await query(
        env,
        `INSERT INTO giving_transactions (id, user_id, phone, amount_kes, purpose, provider, status, metadata, created_at)
         VALUES (?,?,?,?,?,'mpesa','pending',?,?)`,
        [id, fresh.id, phone, amountRounded, purpose, JSON.stringify({ requestedBy: fresh.username }), now],
      )

      const res = await postJson(
        `${mpesaBase(env)}/mpesa/stkpush/v1/processrequest`,
        { Authorization: `Bearer ${token}` },
        {
          BusinessShortCode: shortCode, Password: password, Timestamp: time,
          TransactionType: 'CustomerPayBillOnline', Amount: amountRounded,
          PartyA: phone, PartyB: shortCode, PhoneNumber: phone, CallBackURL: callbackUrl,
          AccountReference: `HARVEST-${id.slice(0, 8).toUpperCase()}`,
          TransactionDesc: purpose.slice(0, 20),
        },
      )
      const resp = await res.json().catch(() => ({}))
      if (!res.ok || resp.ResponseCode !== '0') {
        await query(
          env,
          `UPDATE giving_transactions SET status='failed', provider_result_code=?, provider_result_description=? WHERE id=?`,
          [String(resp.ResponseCode ?? res.status), String(resp.ResponseDescription || 'M-Pesa request failed'), id],
        )
        return errorResponse('M-Pesa request failed', 502)
      }
      await query(
        env,
        `UPDATE giving_transactions SET merchant_request_id=?, checkout_request_id=?, metadata=? WHERE id=?`,
        [resp.MerchantRequestID, resp.CheckoutRequestID, JSON.stringify({ customerMessage: resp.CustomerMessage }), id],
      )
      return jsonResponse({ transactionId: id, checkoutRequestId: resp.CheckoutRequestID, message: resp.CustomerMessage || 'Check your phone to complete the M-Pesa prompt.' }, 202)
    } catch (e) {
      if (e instanceof ApiError) throw e
      return errorResponse('Giving service is temporarily unavailable', 503)
    }
  }

  // GET /api/giving/mine
  if (path === '/api/giving/mine' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT id, amount_kes, purpose, provider, status, receipt_number, created_at, completed_at
         FROM giving_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,
      [fresh.id],
    )
    return jsonResponse(rows)
  }

  // GET /api/giving/admin
  if (path === '/api/giving/admin' && method === 'GET') {
    await requireAdmin(env, user)
    const { rows } = await query(
      env,
      `SELECT g.id, g.amount_kes, g.purpose, g.provider, g.status, g.receipt_number, g.phone, g.created_at, g.completed_at, u.username
         FROM giving_transactions g LEFT JOIN users u ON u.id=g.user_id
        ORDER BY g.created_at DESC LIMIT 500`,
    )
    const totals = await query(
      env,
      `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN amount_kes ELSE 0 END), 0) AS completed_kes,
              SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count
         FROM giving_transactions`,
    )
    return jsonResponse({ transactions: rows, totals: { completed_kes: Number(totals.rows[0]?.completed_kes || 0), pending_count: Number(totals.rows[0]?.pending_count || 0) } })
  }

  // POST /api/giving/mpesa/callback — Safaricom calls this (no auth).
  if (path === '/api/giving/mpesa/callback' && method === 'POST') {
    try {
      const body = await readJson(request)
      const result = body?.Body?.stkCallback
      const checkoutId = String(result?.CheckoutRequestID || '')
      if (!checkoutId) return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
      const found = await query(env, `SELECT id, status, phone, amount_kes FROM giving_transactions WHERE checkout_request_id=?`, [checkoutId])
      const tx = found.rows[0]
      if (!tx || tx.status === 'completed') return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })

      const code = String(result.ResultCode ?? '')
      const metadata = Object.fromEntries((result.CallbackMetadata?.Item || []).map(item => [item.Name, item.Value]))
      if (code === '0') {
        const callbackAmount = Number(metadata.Amount)
        const callbackPhone = normalizePhone(metadata.PhoneNumber)
        const storedAmount = Number(tx.amount_kes)
        if (!Number.isFinite(callbackAmount) || callbackAmount !== storedAmount || !callbackPhone || callbackPhone !== tx.phone) {
          return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
        }
        const receipt = String(metadata.MpesaReceiptNumber || '').slice(0, 64)
        await query(
          env,
          `UPDATE giving_transactions SET status='completed', receipt_number=?, provider_result_code=?, provider_result_description=?, metadata=?, completed_at=? WHERE id=? AND status='pending'`,
          [receipt || null, code, String(result.ResultDesc || ''), JSON.stringify(metadata), new Date().toISOString(), tx.id],
        )
      } else {
        await query(
          env,
          `UPDATE giving_transactions SET status='failed', provider_result_code=?, provider_result_description=? WHERE id=? AND status='pending'`,
          [code, String(result.ResultDesc || 'M-Pesa payment failed'), tx.id],
        )
      }
      return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
    } catch {
      return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
    }
  }

  return null
}
