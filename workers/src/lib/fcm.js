// FCM HTTP v1 delivery for Cloudflare Workers — WebCrypto only, no Node APIs.
// Pipeline (P1 notifications batch):
//   device registration → token validation → recipient lookup → FCM HTTP v1
//   → fan-out → invalid-token cleanup → delivery/error logging.
// Configuration (wrangler secrets/vars):
//   FCM_SERVICE_ACCOUNT — full Firebase service-account JSON (or
//                         FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY + FCM_PROJECT_ID)
//   FCM_ENABLED=1       — explicit kill switch; unset means log-only, never send.
// If unconfigured, delivery degrades to a no-op: nothing crashes, nothing sends.
import { query, batch, stmt, nowIso } from './db.js'

const FCM_OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const FCM_SEND_ENDPOINT = 'https://fcm.googleapis.com/v1/projects/{project}/messages:send'
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ── base64url helpers (ArrayBuffer ↔ b64url, no padding) ──
function b64urlFromBytes(bytes) {
  let bin = ''
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// PEM "-----BEGIN PRIVATE KEY-----" body is base64 DER (PKCS8), not hex.
function pemToPkcs8(pem) {
  const body = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  let raw
  try { raw = atob(body) } catch { throw new Error('fcm private key is not valid base64 PEM') }
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Accepts the service-account key JSON as a string, a parsed object, or the
// split FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY/FCM_PROJECT_ID variables.
function normalizeServiceAccount(env) {
  let sa = env.FCM_SERVICE_ACCOUNT
  if (typeof sa === 'string') {
    try { sa = JSON.parse(sa) } catch { return null }
  }
  if (!sa && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    sa = { client_email: env.FCM_CLIENT_EMAIL, private_key: env.FCM_PRIVATE_KEY, project_id: env.FCM_PROJECT_ID }
  }
  if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) return null
  return sa
}

// Access-token cache: Google tokens last ~1h; avoid an OAuth roundtrip per send.
let cachedToken = { value: null, exp: 0 }

// Indirection so tests can stub network calls without global mutation.
let netFetch = (url, init) => fetch(url, init)
export function __setFcmFetch(fn) { netFetch = fn; cachedToken = { value: null, exp: 0 } }
export function __resetFcmFetch() { netFetch = (url, init) => fetch(url, init); cachedToken = { value: null, exp: 0 } }

async function getAccessToken(sa) {
  const now = Date.now()
  if (cachedToken.value && cachedToken.exp > now + 60_000) return cachedToken.value
  const nowSec = Math.floor(now / 1000)
  const enc = (o) => b64urlFromBytes(new TextEncoder().encode(JSON.stringify(o)))
  const signingInput = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: FCM_OAUTH_SCOPE,
    aud: FCM_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  const res = await netFetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${b64urlFromBytes(sig)}`,
    }).toString(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(`fcm oauth failed: ${body.error_description || body.error || res.status}`)
  }
  cachedToken = { value: body.access_token, exp: now + 3_300_000 }
  return body.access_token
}

// ── FCM HTTP v1 send ──
// Returns { ok, permanent, transient, status } — `permanent` marks an invalid
// token that must be deleted; `transient` a retryable failure.
export async function sendToDevice(env, token, message) {
  const sa = normalizeServiceAccount(env)
  const projectId = String(env.FCM_PROJECT_ID || sa?.project_id || '')
  if (!sa || !projectId) return { ok: false, permanent: false, transient: false, status: 'unconfigured' }
  if (String(env.FCM_ENABLED || '') !== '1') return { ok: false, permanent: false, transient: false, status: 'disabled' }
  try {
    const accessToken = await getAccessToken(sa)
    const res = await netFetch(FCM_SEND_ENDPOINT.replace('{project}', encodeURIComponent(projectId)), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        message: {
          token,
          notification: message.notification,
          data: stringifyData(message.data || {}),
          android: { priority: 'HIGH', ttl: '604800s', collapse_key: message.collapseKey || undefined },
        },
      }),
    })
    if (res.ok) return { ok: true, permanent: false, transient: false, status: res.status }
    const errText = await res.text().catch(() => '')
    let code = ''
    try { code = String(JSON.parse(errText)?.error?.status || '') } catch { /* keep '' */ }
    const permanent = res.status === 404 || res.status === 410 ||
      code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT'
    const transient = [429, 500, 502, 503, 504].includes(res.status)
    return { ok: false, permanent, transient, status: res.status, error: errText.slice(0, 300) }
  } catch (e) {
    return { ok: false, permanent: false, transient: true, status: 0, error: String(e?.message || e).slice(0, 300) }
  }
}

function stringifyData(d) {
  const out = {}
  for (const [k, v] of Object.entries(d || {})) out[k] = String(v ?? '')
  return out
}

// ── Recipient resolution: authorization before fan-out ──
// Only active users' enabled devices are addressed.
export async function resolveRecipients(env, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const { rows } = await query(
    env,
    `SELECT d.id, d.user_id, d.fcm_token, d.platform, u.username
       FROM notification_devices d JOIN users u ON u.id = d.user_id
      WHERE d.user_id IN (${placeholders}) AND d.enabled = 1 AND u.active = 1`,
    ids,
  )
  return rows
}

// sendFanOut(env, { recipients, title, body, data, collapseKey, actor })
// Never throws; returns a summary. Safe to run inside ctx.waitUntil.
export async function sendFanOut(env, opts) {
  const { recipients, title, body, data = {}, collapseKey, requestKey, actor = 'system' } = opts || {}
  const summary = { recipients: 0, sent: 0, failed: 0, invalid_tokens_removed: 0, deduped: 0, disabled: false }
  try {
    let ids = [...new Set((recipients || []).filter(Boolean))]
    if (!ids.length) return summary
    // At-most-once per (request_key, user): the first claim wins, duplicates
    // (retries, double callbacks) are dropped before any device is touched.
    if (requestKey) {
      const stmts = ids.map(id => stmt(env, 'INSERT OR IGNORE INTO notification_sent_keys (request_key, user_id, created_at) VALUES (?,?,?)', [String(requestKey).slice(0, 160), id, nowIso()]))
      const results = await batch(env, stmts).catch(() => null)
      if (results) {
        const claimed = new Set()
        results.forEach((r, i) => { if (Number(r?.meta?.changes ?? 1) > 0) claimed.add(ids[i]) })
        summary.deduped = ids.length - claimed.size
        ids = ids.filter(id => claimed.has(id))
        if (!ids.length) return summary
      }
    }
    const rows = await resolveRecipients(env, ids)
    summary.recipients = rows.length
    if (!rows.length) return summary

    const configured = Boolean(normalizeServiceAccount(env)) && String(env.FCM_ENABLED || '') === '1'
    const results = []
    if (!configured) {
      summary.disabled = true
      for (const row of rows) results.push({ row, res: { ok: false, permanent: false, transient: false, status: 'disabled' } })
    } else {
      // FCM accepts one token per HTTP v1 call; chunk to keep awaits bounded.
      const CHUNK = 50
      for (let i = 0; i < rows.length; i += CHUNK) {
        for (const row of rows.slice(i, i + CHUNK)) {
          const res = await sendToDevice(env, row.fcm_token, { notification: { title, body }, data, collapseKey })
          results.push({ row, res })
        }
      }
    }

    // Invalid tokens (uninstalled app / rotated token) are removed immediately.
    const invalid = results.filter(x => x.res.permanent).map(x => x.row.fcm_token)
    if (invalid.length) {
      const placeholders = invalid.map(() => '?').join(',')
      await query(env, `DELETE FROM notification_devices WHERE fcm_token IN (${placeholders})`, invalid).catch(() => {})
      summary.invalid_tokens_removed = invalid.length
    }

    await logDeliveries(env, results, { title, body, data, actor })
    summary.sent = results.filter(x => x.res.ok).length
    summary.failed = results.filter(x => !x.res.ok && x.res.status !== 'disabled').length
    return summary
  } catch (e) {
    summary.error = String(e?.message || e).slice(0, 300)
    return summary
  }
}

// ── Delivery/error log (0025) — one row per device attempt ──
export async function logDeliveries(env, results, meta = {}) {
  if (!results?.length) return
  const now = new Date().toISOString()
  const statements = results.map(({ row, res }) =>
    stmt(env,
      `INSERT INTO notification_deliveries
         (id, device_id, user_id, fcm_token, actor, title, body, data_json, ok, status, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(), row.id, row.user_id, row.fcm_token,
        String(meta.actor || 'system').slice(0, 80),
        String(meta.title || '').slice(0, 120),
        String(meta.body || '').slice(0, 300),
        JSON.stringify(meta.data || {}),
        res.ok ? 1 : 0,
        String(res.status ?? ''),
        String(res.error || ''),
        now,
      ],
    ),
  )
  await batch(env, statements).catch(() => {})
}
