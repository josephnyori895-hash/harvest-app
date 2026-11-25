// Port of server/src/routes/giving.js (pg → D1). M-Pesa flows unchanged (fetch is native).
import { query, uuid, batch, stmt } from '../lib/db.js'
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

// ── Manual giving records ────────────────────────────────────────────────────
// The church still receives most money at the Paybill/Till/bank, so a treasurer
// records what arrived. Nothing here touches M-Pesa: `provider='manual'` rows
// are entered by an admin and every later correction is snapshotted into
// giving_transaction_audit before the row changes, so the money trail is never
// silently rewritten.
const MANUAL_METHODS = ['paybill', 'till', 'bank', 'cash', 'mpesa']
const CORRECTABLE_STATUS = ['pending', 'completed', 'failed', 'cancelled']

function wholeShillings(value) {
  const n = Number(value)
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : null
}

function receivedAt(value) {
  const raw = String(value || '').trim()
  if (!raw) return new Date().toISOString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  if (raw.slice(0, 10) > new Date().toISOString().slice(0, 10)) return null
  return d.toISOString()
}

// A financial write is one transaction: gift + derived project contribution +
// audit trail. These used to be separate statements, so a failure after the
// gift update could leave a changed ledger with no audit row (or a recorded
// gift while the request returned 500). D1 batch commits all statements or
// none, which keeps the money trail and the ledger in step.
function contributionStatements(env, tx) {
  const statements = [stmt(env, 'DELETE FROM project_contributions WHERE giving_transaction_id=?', [tx.id])]
  if (tx.project_id && tx.status === 'completed') {
    statements.push(stmt(
      env,
      'INSERT OR IGNORE INTO project_contributions(id,project_id,user_id,giving_transaction_id,amount_kes) VALUES(?,?,?,?,?)',
      [uuid(), tx.project_id, tx.user_id, tx.id, Number(tx.amount_kes)],
    ))
  }
  return statements
}

function auditStatement(env, fresh, transactionId, action, before, after, reason) {
  return stmt(
    env,
    `INSERT INTO giving_transaction_audit (transaction_id, actor_id, actor_username, action, before_json, after_json, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [transactionId, fresh.id, fresh.username, action, before ? JSON.stringify(before) : null, JSON.stringify(after), reason || null, new Date().toISOString()],
  )
}

function ledgerFilters(url) {
  const where = []
  const params = []
  const status = String(url.searchParams.get('status') || '').trim()
  if (status) {
    if (!['pending', 'completed', 'failed', 'cancelled'].includes(status)) throw httpError(400, 'invalid status filter')
    where.push('g.status=?'); params.push(status)
  }
  const from = String(url.searchParams.get('from') || '').trim()
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw httpError(400, 'from must be YYYY-MM-DD')
    where.push('g.created_at >= ?'); params.push(`${from}T00:00:00.000Z`)
  }
  const to = String(url.searchParams.get('to') || '').trim()
  if (to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw httpError(400, 'to must be YYYY-MM-DD')
    where.push('g.created_at <= ?'); params.push(`${to}T23:59:59.999Z`)
  }
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60)
  if (q) {
    // SQLite only treats backslash as an escape character when ESCAPE says so;
    // without it a member called "100%_giver" would match everything.
    where.push("(u.username LIKE ? ESCAPE '\\' OR g.receipt_number LIKE ? ESCAPE '\\' OR g.purpose LIKE ? ESCAPE '\\')")
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`
    params.push(like, like, like)
  }
  return { clause: where.length ? ' WHERE ' + where.join(' AND ') : '', params }
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  // A cell beginning with =, +, - or @ is a spreadsheet formula. Prefix it so
  // an exported purpose or note cannot execute when the treasurer opens the file.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
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
      const purposeId = String(body.purpose_id || '').trim().slice(0, 40)
      const purpose = String(body.purpose || 'General Giving').trim().slice(0, 120) || 'General Giving'
      if (purposeId) {
        const configResult = await query(env, "SELECT value FROM site_content WHERE key='giving_payment_methods' LIMIT 1")
        let configs = {}
        try { configs = JSON.parse(String(configResult.rows[0]?.value || '{}')) } catch { return errorResponse('giving payment configuration is invalid', 503) }
        const config = configs && typeof configs === 'object' && !Array.isArray(configs) ? configs[purposeId] : null
        if (config?.enabled === false) return errorResponse('This giving purpose is temporarily unavailable', 409)
        if (config?.method && config.method !== 'stk') return errorResponse('This purpose uses manual payment instructions; M-Pesa STK Push is not available', 409)
      }
      const projectId = body.project_id ? String(body.project_id).slice(0, 64) : null
      if (projectId) {
        const project = await query(env, 'SELECT id,status FROM projects WHERE id=?', [projectId])
        if (!project.rows[0]) return errorResponse('project not found', 404)
        if (project.rows[0].status !== 'active') return errorResponse('project is not accepting gifts', 409)
      }
      // M-Pesa STK push takes whole shillings only — reject fractions instead
      // of silently rounding a member's gift to a different amount.
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 1000000) return errorResponse('amount must be a whole number between KES 1 and 1,000,000', 400)
      if (!phone) return errorResponse('valid Kenyan M-Pesa phone number required — use 07…, 01… or 2547… format', 400)

      // RS-107, server half. The client ref guard only covers two taps in the
      // same commit; it cannot cover a retried request, a second device, or a
      // tap that lands after the busy re-render. M-Pesa has no idempotency on
      // this call, so a second STK push for the same member, phone and amount
      // while one is still pending would let the member answer twice and be
      // debited twice. Refuse instead of prompting again.
      const DUPLICATE_WINDOW_SECONDS = 90
      const pendingCutoff = new Date(Date.now() - DUPLICATE_WINDOW_SECONDS * 1000).toISOString()
      const pendingSame = await query(
        env,
        `SELECT id FROM giving_transactions
          WHERE user_id=? AND status='pending' AND provider='mpesa' AND phone=? AND amount_kes=? AND created_at > ?
          LIMIT 1`,
        [fresh.id, phone, amount, pendingCutoff],
      )
      if (pendingSame.rows[0]) {
        return errorResponse('An M-Pesa prompt for this gift is already on its way — finish it on your phone, or try again in two minutes', 409)
      }

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
        `INSERT INTO giving_transactions (id, user_id, phone, amount_kes, purpose, provider, status, metadata, created_at, project_id)
         VALUES (?,?,?,?,?,'mpesa','pending',?,?,?)`,
        [id, fresh.id, phone, amountRounded, purpose, JSON.stringify({ requestedBy: fresh.username }), now, projectId],
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

  // GET /api/giving/admin — filtered ledger for the treasurer.
  if (path === '/api/giving/admin' && method === 'GET') {
    await requireAdmin(env, user)
    const url = new URL(request.url)
    let filters
    try { filters = ledgerFilters(url) } catch (e) { if (e instanceof ApiError) throw e; return errorResponse('invalid ledger filter', 400) }
    const rawLimit = Number(url.searchParams.get('limit') || 200)
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200, 1), 500)
    const rawOffset = Number(url.searchParams.get('offset') || 0)
    const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0, 0), 100_000)
    const { rows } = await query(
      env,
      `SELECT g.id, g.amount_kes, g.purpose, g.provider, g.status, g.receipt_number, g.phone,
              g.created_at, g.completed_at, g.project_id, g.recorded_by, g.corrected_at,
              u.username, rb.username AS recorded_by_username, cb.username AS corrected_by_username
         FROM giving_transactions g
         LEFT JOIN users u ON u.id=g.user_id
         LEFT JOIN users rb ON rb.id=g.recorded_by
         LEFT JOIN users cb ON cb.id=g.corrected_by
         ${filters.clause}
        ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      [...filters.params, limit, offset],
    )
    // Totals must describe the same filtered ledger the treasurer is looking
    // at. Previously they summed the whole table, so a date/status filter
    // showed filtered rows above unfiltered money.
    const totals = await query(
      env,
      `SELECT COALESCE(SUM(CASE WHEN g.status='completed' THEN g.amount_kes ELSE 0 END), 0) AS completed_kes,
              SUM(CASE WHEN g.status='pending' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN g.status='pending' THEN g.amount_kes ELSE 0 END) AS pending_kes,
              COUNT(*) AS total_count
         FROM giving_transactions g
         LEFT JOIN users u ON u.id=g.user_id
         ${filters.clause}`,
      filters.params,
    )
    return jsonResponse({
      transactions: rows,
      totals: {
        completed_kes: Number(totals.rows[0]?.completed_kes || 0),
        pending_kes: Number(totals.rows[0]?.pending_kes || 0),
        pending_count: Number(totals.rows[0]?.pending_count || 0),
      },
      total: Number(totals.rows[0]?.total_count || 0),
      limit,
      offset,
    })
  }

  // GET /api/giving/admin/export.csv — the same filtered ledger as a spreadsheet.
  if (path === '/api/giving/admin/export.csv' && method === 'GET') {
    await requireAdmin(env, user)
    const url = new URL(request.url)
    let filters
    try { filters = ledgerFilters(url) } catch (e) { if (e instanceof ApiError) throw e; return errorResponse('invalid ledger filter', 400) }
    const { rows } = await query(
      env,
      `SELECT g.id, g.created_at, u.username, g.phone, g.amount_kes, g.purpose, g.provider, g.status,
              g.receipt_number, g.project_id, rb.username AS recorded_by_username, g.corrected_at
         FROM giving_transactions g
         LEFT JOIN users u ON u.id=g.user_id
         LEFT JOIN users rb ON rb.id=g.recorded_by
         ${filters.clause}
        ORDER BY g.created_at DESC LIMIT 5000`,
      filters.params,
    )
    const header = ['id', 'received_at', 'member', 'phone', 'amount_kes', 'purpose', 'method', 'status', 'receipt_number', 'project_id', 'recorded_by', 'corrected_at']
    const body = rows.map(r => [r.id, r.created_at, r.username, r.phone, r.amount_kes, r.purpose, r.provider, r.status, r.receipt_number, r.project_id, r.recorded_by_username, r.corrected_at].map(csvCell).join(','))
    const csv = [header.join(','), ...body].join('\n') + '\n'
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="harvest-giving-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // POST /api/giving/transactions — treasurer records a gift received manually.
  if (path === '/api/giving/transactions' && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const body = await readJson(request)
    const amount = wholeShillings(body.amount_kes)
    if (!amount) return errorResponse('amount_kes must be a whole number between 1 and 10,000,000', 400)
    const purpose = String(body.purpose || '').trim().slice(0, 120)
    if (!purpose) return errorResponse('purpose is required', 400)
    const method = String(body.method || 'paybill').trim()
    if (!MANUAL_METHODS.includes(method)) return errorResponse('method must be paybill, till, bank, cash or mpesa', 400)
    const created = receivedAt(body.received_at)
    if (!created) return errorResponse('received_at must be a past or present date (YYYY-MM-DD)', 400)
    const phone = body.phone ? normalizePhone(body.phone) : null
    if (body.phone && !phone) return errorResponse('phone must be a valid Kenyan number', 400)
    const receipt = String(body.receipt_number || '').trim().slice(0, 64) || null
    const note = String(body.note || '').trim().slice(0, 500)
    let projectId = body.project_id ? String(body.project_id).slice(0, 64) : null
    if (projectId) {
      const project = await query(env, 'SELECT id FROM projects WHERE id=?', [projectId])
      if (!project.rows[0]) return errorResponse('project not found', 404)
    }
    let donorId = null
    let donorUsername = null
    if (body.member_username) {
      const donor = await query(env, 'SELECT id,username FROM users WHERE username=?', [String(body.member_username).trim()])
      if (!donor.rows[0]) return errorResponse('member not found', 404)
      donorId = donor.rows[0].id
      donorUsername = donor.rows[0].username
    }
    const id = uuid()
    const now = new Date().toISOString()
    const status = 'completed'
    const saved = { id, amount_kes: amount, purpose, status, project_id: projectId, user_id: donorId }
    try {
      await batch(env, [
        stmt(
          env,
          `INSERT INTO giving_transactions
             (id, user_id, phone, amount_kes, purpose, provider, status, receipt_number, metadata, created_at, completed_at, project_id, recorded_by)
           VALUES (?,?,?,?,?,'manual',?,?,?,?,?,?,?)`,
          [id, donorId, phone || 'manual', amount, purpose, status, receipt, JSON.stringify({ method, note, recordedBy: fresh.username, member: donorUsername }), created, now, projectId, fresh.id],
        ),
        ...contributionStatements(env, saved),
        auditStatement(env, fresh, id, 'record', null, { ...saved, method, phone, receipt_number: receipt, note, received_at: created }, note || null),
      ])
    } catch (e) {
      console.error('manual giving record rolled back', e?.message)
      return errorResponse('The gift could not be saved. Nothing was recorded — please try again.', 500)
    }
    return jsonResponse({ transaction: { ...saved, provider: 'manual', phone: phone || 'manual', receipt_number: receipt, created_at: created, recorded_by_username: fresh.username } }, 201)
  }

  // PATCH /api/giving/transactions/:id — correct a record. A reason is required;
  // the previous row is snapshotted before anything changes.
  const correction = path.match(/^\/api\/giving\/transactions\/([^/]+)$/)
  if (correction && method === 'PATCH') {
    const fresh = await requireAdmin(env, user)
    const id = correction[1]
    const found = await query(env, 'SELECT * FROM giving_transactions WHERE id=?', [id])
    const before = found.rows[0]
    if (!before) return errorResponse('transaction not found', 404)
    const body = await readJson(request)
    const reason = String(body.reason || '').trim().slice(0, 500)
    if (reason.length < 4) return errorResponse('reason is required so the correction can be audited', 400)
    const updates = {}
    if (body.amount_kes !== undefined) {
      const amount = wholeShillings(body.amount_kes)
      if (!amount) return errorResponse('amount_kes must be a whole number between 1 and 10,000,000', 400)
      updates.amount_kes = amount
    }
    if (body.purpose !== undefined) {
      const purpose = String(body.purpose).trim().slice(0, 120)
      if (!purpose) return errorResponse('purpose cannot be empty', 400)
      updates.purpose = purpose
    }
    if (body.status !== undefined) {
      if (!CORRECTABLE_STATUS.includes(body.status)) return errorResponse('invalid status', 400)
      updates.status = body.status
      updates.completed_at = body.status === 'completed' ? (before.completed_at || new Date().toISOString()) : null
    }
    if (body.receipt_number !== undefined) updates.receipt_number = String(body.receipt_number || '').trim().slice(0, 64) || null
    if (body.phone !== undefined) {
      const phone = String(body.phone || '').trim()
      if (phone && !normalizePhone(phone)) return errorResponse('phone must be a valid Kenyan number', 400)
      updates.phone = phone ? normalizePhone(phone) : (before.phone || 'manual')
    }
    if (body.project_id !== undefined) {
      const projectId = body.project_id ? String(body.project_id).slice(0, 64) : null
      if (projectId) {
        const project = await query(env, 'SELECT id FROM projects WHERE id=?', [projectId])
        if (!project.rows[0]) return errorResponse('project not found', 404)
      }
      updates.project_id = projectId
    }
    if (!Object.keys(updates).length) return errorResponse('no changes to apply', 400)
    updates.corrected_at = new Date().toISOString()
    updates.corrected_by = fresh.id
    const keys = Object.keys(updates)
    const after = { ...before, ...updates }
    try {
      await batch(env, [
        stmt(env, `UPDATE giving_transactions SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, [...keys.map(k => updates[k]), id]),
        ...contributionStatements(env, after),
        auditStatement(
          env, fresh, id, 'correct',
          { amount_kes: before.amount_kes, purpose: before.purpose, status: before.status, receipt_number: before.receipt_number, phone: before.phone, project_id: before.project_id },
          { ...updates }, reason,
        ),
      ])
    } catch (e) {
      console.error('giving correction rolled back', e?.message)
      return errorResponse('The correction could not be saved. The original record is unchanged — please try again.', 500)
    }
    return jsonResponse({ transaction: { ...after, corrected_by_username: fresh.username, recorded_by_username: before.recorded_by } })
  }

  // GET /api/giving/transactions/:id/audit — who changed what, when and why.
  const auditMatch = path.match(/^\/api\/giving\/transactions\/([^/]+)\/audit$/)
  if (auditMatch && method === 'GET') {
    await requireAdmin(env, user)
    const { rows } = await query(
      env,
      `SELECT id, actor_username, action, before_json, after_json, reason, created_at
         FROM giving_transaction_audit WHERE transaction_id=? ORDER BY created_at ASC, id ASC`,
      [auditMatch[1]],
    )
    return jsonResponse({ audit: rows.map(r => ({
      ...r,
      before: (() => { try { return r.before_json ? JSON.parse(r.before_json) : null } catch { return null } })(),
      after: (() => { try { return JSON.parse(r.after_json) } catch { return null } })(),
    })) })
  }

  // POST /api/giving/mpesa/callback — Safaricom calls this (no auth).
  if (path === '/api/giving/mpesa/callback' && method === 'POST') {
    try {
      const body = await readJson(request)
      const result = body?.Body?.stkCallback
      const checkoutId = String(result?.CheckoutRequestID || '')
      if (!checkoutId) return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
      const found = await query(env, `SELECT id, status, phone, amount_kes, project_id, user_id FROM giving_transactions WHERE checkout_request_id=?`, [checkoutId])
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
        const completedAt = new Date().toISOString()
        const statements = [
          stmt(
            env,
            `UPDATE giving_transactions SET status='completed', receipt_number=?, provider_result_code=?, provider_result_description=?, metadata=?, completed_at=? WHERE id=? AND status='pending'`,
            [receipt || null, code, String(result.ResultDesc || ''), JSON.stringify(metadata), completedAt, tx.id],
          ),
        ]
        // Contribute ONLY on a real pending→completed transition. A replayed
        // success payload after the transaction was marked failed must not
        // create an orphan contribution; the UNIQUE(giving_transaction_id)
        // constraint plus INSERT OR IGNORE additionally caps contributions at
        // exactly one per transaction under concurrent duplicate callbacks.
        if (tx.project_id) {
          statements.push(stmt(
            env,
            `INSERT OR IGNORE INTO project_contributions(id,project_id,user_id,giving_transaction_id,amount_kes)
             SELECT ?,?,?,?,? WHERE EXISTS (
               SELECT 1 FROM giving_transactions WHERE id=? AND status='completed' AND completed_at=?
             )`,
            [uuid(), tx.project_id, tx.user_id, tx.id, Number(tx.amount_kes), tx.id, completedAt],
          ))
        }
        // The provider completion is part of the money trail too. Keep the
        // update, contribution and audit row in one D1 batch so a partial
        // failure cannot leave money without an audit record.
        statements.push(stmt(
          env,
          `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at)
           SELECT NULL, 'provider', 'giving.completed', 'giving_transaction', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM giving_transactions WHERE id=? AND status='completed' AND completed_at=?)`,
          [tx.id, JSON.stringify({ amount_kes: Number(tx.amount_kes), receipt, result_code: code }), completedAt, tx.id, completedAt],
        ))
        await batch(env, statements)
      } else {
        const failedAt = new Date().toISOString()
        await batch(env, [
          stmt(
            env,
            `UPDATE giving_transactions SET status='failed', provider_result_code=?, provider_result_description=? WHERE id=? AND status='pending'`,
            [code, String(result.ResultDesc || 'M-Pesa payment failed'), tx.id],
          ),
          stmt(
            env,
            `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at)
             SELECT NULL, 'provider', 'giving.failed', 'giving_transaction', ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM giving_transactions WHERE id=? AND status='failed' AND provider_result_code=?)`,
            [tx.id, JSON.stringify({ amount_kes: Number(tx.amount_kes), result_code: code }), failedAt, tx.id, code],
          ),
        ])
      }
      return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
    } catch {
      return jsonResponse({ ResultCode: 0, ResultDesc: 'Accepted' })
    }
  }

  return null
}
