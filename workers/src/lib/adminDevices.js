// Single-administrator device policy.
//
// The admin account may be signed in on two devices in total (MAX_TRUSTED_DEVICES).
// A new browser becomes trusted only after an admin phone approves it. A third
// device evicts the least-recently-used one; token claims carry the device id,
// so an evicted device is refused on its next request.
import { query, uuid, nowIso, isoMinutesAgo } from './db.js'
import { pbkdf2Hash, pbkdf2Verify } from './crypto.js'
import { sendToDevice } from './fcm.js'

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
// Two devices may sign in with the admin password alone. Any further device —
// phone or browser — must be approved with a verification code first. When a
// third device is approved, the one used longest ago is dropped from the
// trusted list; its token carries the device id, so it is refused immediately.
export const MAX_TRUSTED_DEVICES = 2
const DEVICE_RE = /^[A-Za-z0-9._:-]{8,128}$/

// Break-glass path for the single administrator. When the bound phone cannot
// receive push (FCM unconfigured, notifications denied, phone lost), the admin
// would otherwise be locked out of every browser forever: the code has no
// route to the phone and there is no second channel. ADMIN_RECOVERY_CODE is a
// long server-held secret that approves the browser after the admin password
// has already been verified; it is rotatable with `wrangler secret put`.
export function adminRecoveryConfigured(env) {
  return String(env.ADMIN_RECOVERY_CODE || '').trim().length >= 12
}

// Constant-time string compare (length leaks only the length).
async function secretMatches(candidate, expected) {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(candidate))),
    crypto.subtle.digest('SHA-256', enc.encode(String(expected))),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

// Live approval request for the admin phone. The code travels over the
// authenticated realtime socket and is only revealed after the admin taps
// Authorize, so a stolen browser session can never approve itself.
async function publishLoginRequest(env, username, data) {
  if (!env?.REALTIME) return
  try {
    const stub = env.REALTIME.get(env.REALTIME.idFromName('singleton'))
    await stub.fetch('https://realtime.internal/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: username, event: 'admin:login-request', data }),
    })
  } catch { /* the browser can still use the recovery code */ }
}

export function primaryAdminId(env) {
  return String(env.ADMIN_USER_ID || '').trim()
}

export function primaryAdminUsername(env) {
  return String(env.ADMIN_USERNAME || 'hfcnyeri').trim().toLowerCase()
}

// Identify the primary administrator by the immutable user id, not by the
// username. A username can be corrected or changed without the account losing
// its admin role, password, devices or audit history.
export function isPrimaryAdmin(env, account) {
  const id = typeof account === 'string' ? '' : String(account?.id || '').trim()
  const adminId = primaryAdminId(env)
  if (adminId) return id === adminId
  const username = typeof account === 'string' ? account : account?.username
  return String(username || '').trim().toLowerCase() === primaryAdminUsername(env)
}

// The client describes its device so the admin can tell two phones apart. This
// is display data only: it is bounded, flattened and never used for a decision
// about trust — device_id is the identity.
const DETAIL_FIELDS = ['platform', 'os', 'browser', 'model', 'screen', 'app_version']
export function cleanDeviceDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out = {}
  for (const key of DETAIL_FIELDS) {
    const raw = input[key]
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const value = String(raw).replace(/\s+/g, ' ').trim().slice(0, 48)
    if (value) out[key] = value
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}

export function normalizeAdminDevice(kind, deviceId, label, details, ip) {
  const k = kind === 'mobile' ? 'mobile' : 'web'
  const id = String(deviceId || '').trim()
  if (!DEVICE_RE.test(id)) return { error: 'a valid device_id (8–128 chars) is required' }
  return {
    kind: k,
    deviceId: id,
    label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
    details: cleanDeviceDetails(details),
    ip: String(ip || '').trim().slice(0, 64) || null,
  }
}

async function getAllDevices(env, userId) {
  const { rows } = await query(
    env,
    'SELECT id, kind, device_id, label, details, last_ip, created_at, last_seen_at FROM admin_devices WHERE user_id=? ORDER BY last_seen_at DESC',
    [userId],
  )
  return rows
}

async function currentEpoch(env, userId, kind) {
  const column = kind === 'mobile' ? 'admin_mobile_epoch' : 'admin_web_epoch'
  const { rows } = await query(env, `SELECT ${column} AS epoch FROM users WHERE id=?`, [userId])
  return Number(rows[0]?.epoch) || 0
}

// Binds the first mobile device, or accepts the already-bound one. A different
// phone is refused: the code goes to the bound phone, so approving a new phone
// from an unbound phone would be a way around the single-phone rule.
// A device is trusted — and may sign in with just the password — if it is one
// of the two devices already on the account. Anything else needs a code.
async function trustDevice(env, user, device, all) {
  // Match on device_id alone. The installation id is the identity; a device
  // that signs out and back in is the same row, never a second entry.
  const bound = all.find(d => d.device_id === device.deviceId)
  const now = nowIso()
  if (bound) {
    await query(
      env,
      'UPDATE admin_devices SET kind=?, last_seen_at=?, label=COALESCE(?, label), details=COALESCE(?, details), last_ip=COALESCE(?, last_ip) WHERE id=?',
      [device.kind, now, device.label, device.details, device.ip, bound.id],
    )
    return { ok: true, kind: device.kind, epoch: await currentEpoch(env, user.id, device.kind), bound: 'existing', deviceId: device.deviceId }
  }
  // A phone can be trusted with the password alone while there is room, so the
  // first phone never needs a code posted to itself. Browsers always need
  // approval: a typed password must not add a browser to the trusted list.
  if (device.kind !== 'mobile') return { ok: false, needsCode: true }
  // Replace the stale phone slot, not the browser the admin actually works in.
  if (all.length >= MAX_TRUSTED_DEVICES) {
    await query(env, "DELETE FROM admin_devices WHERE user_id=? AND kind='mobile'", [user.id])
  }
  await query(
    env,
    'INSERT INTO admin_devices (id, user_id, kind, device_id, label, details, last_ip, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [uuid(), user.id, device.kind, device.deviceId, device.label, device.details, device.ip, now, now],
  )
  // The phone is the factor itself: a code sent to the phone cannot approve the
  // phone. Reinstalling the app or clearing its data changes the installation
  // id, which used to leave the single administrator with a full device list
  // and no route back into their own phone. A phone that presents the admin
  // password therefore takes the mobile slot. This prune is only the safety
  // net that keeps the allowance at two whatever order the rows arrived in.
  if (all.length >= MAX_TRUSTED_DEVICES) {
    await query(
      env,
      `DELETE FROM admin_devices
        WHERE user_id=? AND id NOT IN (
          SELECT id FROM admin_devices WHERE user_id=? ORDER BY last_seen_at DESC LIMIT ?
        )`,
      [user.id, user.id, MAX_TRUSTED_DEVICES],
    )
  }
  return { ok: true, kind: 'mobile', epoch: await currentEpoch(env, user.id, 'mobile'), bound: 'new', deviceId: device.deviceId }
}

// Trusted device → password only. Anything else gets a code, whatever its kind.
export async function checkAdminDevice(env, user, device) {
  const all = await getAllDevices(env, user.id)
  return trustDevice(env, user, device, all)
}

// Creates a browser challenge and pushes the code to the admin phone. There is
// deliberately no way to read the code back from the API. In local development
// ADMIN_OTP_DEV=1 returns the code so the flow can be tested without Firebase.
export async function createBrowserChallenge(env, user, device, ip = '') {
  // The approval is answered by a device that is already trusted (phone app or
  // an approved browser), over the realtime socket. A phone is only needed for
  // the push fallback.
  const trusted = await getAllDevices(env, user.id)
  if (!trusted.length) {
    return { ok: false, status: 409, error: 'sign in on the admin phone once, then approve this device' }
  }
  // A valid admin password should not turn into an unbounded stream of push
  // codes on the admin phone. Cap challenge creation per admin account.
  const marker = `admchallenge:${user.id}`
  const { rows: challengeRows } = await query(
    env,
    'SELECT COUNT(*) AS count FROM login_attempts WHERE username = ? AND created_at > ?',
    [marker, isoMinutesAgo(15)],
  )
  if (Number(challengeRows[0]?.count || 0) >= 5) {
    return { ok: false, status: 429, error: 'too many admin sign-in codes — wait 15 minutes and try again' }
  }
  await query(
    env,
    'INSERT INTO login_attempts (ip, username, success, created_at) VALUES (?, ?, 0, ?)',
    [String(ip || 'unknown'), marker, nowIso()],
  ).catch(() => {})

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  const id = uuid()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  const codeHash = await pbkdf2Hash(code, 100000)
  await query(
    env,
    `INSERT INTO admin_login_challenges
       (id, user_id, device_id, device_kind, label, details, code_hash, ip, attempts, used, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,0,0,?,?)`,
    [id, user.id, device.deviceId, device.kind, device.label, device.details, codeHash, String(ip || '').slice(0, 64), expiresAt, now],
  )

  if (String(env.ADMIN_OTP_DEV || '') === '1') {
    return { ok: true, challengeId: id, expiresAt, devCode: code, delivery: 'dev' }
  }

  // Deliver to every push-enrolled device on the admin account, newest first.
  // Matching one bound installation id was too brittle: reinstalling the app
  // issues a new installation id and a new token, so the row the server looked
  // for no longer existed and the code went nowhere. These are still only the
  // administrator's own devices — the account holds one admin.
  // Ask the signed-in admin phone directly (realtime socket). This needs no
  // push credentials and is the primary approval path.
  await publishLoginRequest(env, user.username, {
    challenge_id: id,
    code,
    label: device.label,
    ip: String(ip || '').slice(0, 64),
    expires_at: expiresAt,
    // Which device is asking. The receiving session uses this to ignore a
    // request that is really its own browser tab.
    device_kind: device.kind,
    device_id: device.deviceId,
  })

  const { rows: pushRows } = await query(
    env,
    `SELECT fcm_token FROM notification_devices
      WHERE user_id=? AND enabled=1 AND fcm_token != ''
      ORDER BY last_seen_at DESC LIMIT 5`,
    [user.id],
  )

  if (!pushRows[0]) {
    // No registered phone to receive the code. Keep the challenge so the admin
    // can approve this browser with the recovery code instead of being locked
    // out; without a recovery code configured this still fails closed.
    if (adminRecoveryConfigured(env)) return { ok: true, challengeId: id, expiresAt, delivery: 'unavailable' }
    await query(env, 'DELETE FROM admin_login_challenges WHERE id=?', [id]).catch(() => {})
    return { ok: false, status: 409, error: 'the admin phone is not receiving notifications — open the Harvest app on that phone and allow notifications' }
  }

  let delivered = { ok: false, status: 'unavailable' }
  for (const row of pushRows) {
    delivered = await sendToDevice(env, row.fcm_token, {
      notification: {
        title: 'Harvest admin sign-in code',
        body: `${code} is your admin code. It expires in 10 minutes. If this wasn't you, ignore it.`,
      },
      data: { kind: 'admin_login_code', challenge_id: id, code },
      collapseKey: `admin-login:${id}`,
    })
    if (delivered.ok) break
  }

  // One line per challenge so the sign-in log answers "why no code?" without
  // guessing: which accounts were tried, and what Firebase answered.
  console.log(JSON.stringify({
    evt: 'admin_code_push',
    challenge: id,
    devices: pushRows.length,
    delivered: delivered.ok ? 'push' : 'failed',
    status: delivered.status,
    error: delivered.error ? String(delivered.error).slice(0, 200) : undefined,
  }))

  if (delivered.ok) return { ok: true, challengeId: id, expiresAt, delivery: 'push' }

  // Undeliverable push (FCM disabled/unconfigured or rejected). Rather than
  // stranding the admin, keep the challenge and offer the recovery code.
  if (adminRecoveryConfigured(env)) return { ok: true, challengeId: id, expiresAt, delivery: 'unavailable' }

  // Do not leave an undeliverable challenge lying around.
  await query(env, 'DELETE FROM admin_login_challenges WHERE id=?', [id]).catch(() => {})
  if (delivered.status === 'disabled' || delivered.status === 'unconfigured') {
    return { ok: false, status: 503, error: 'admin code delivery is not configured — enable push notifications first' }
  }
  return { ok: false, status: 503, error: 'could not send the code to the admin phone — check its notifications and try again' }
}

// Admin phone decision. Only the bound mobile admin session may decide, so a
// browser can never authorise itself.
export async function decideAdminLoginRequest(env, user, challengeId, decision) {
  const verdict = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : ''
  if (!verdict) return { ok: false, status: 400, error: 'decision must be approve or deny' }
  const id = String(challengeId || '').trim()
  if (!id) return { ok: false, status: 400, error: 'sign-in request is required' }
  const { rows } = await query(
    env,
    'SELECT id, used, expires_at, decision, device_id, device_kind FROM admin_login_challenges WHERE id=? AND user_id=? LIMIT 1',
    [id, user.id],
  )
  const challenge = rows[0]
  if (!challenge) return { ok: false, status: 404, error: 'that sign-in request is no longer available' }
  // A trusted session may approve another device, never itself: the browser
  // asking for a code must not be able to answer its own request.
  const deciderKind = user?.admin_kind === 'mobile' ? 'mobile' : 'web'
  const deciderDevice = String(user?.admin_device_id || '')
  if (challenge.device_kind === deciderKind && challenge.device_id && challenge.device_id === deciderDevice) {
    return { ok: false, status: 403, error: 'this is the device asking to sign in — approve from the admin phone or another signed-in device' }
  }
  if (Number(challenge.used)) return { ok: false, status: 409, error: 'that sign-in was already completed' }
  if (Date.parse(challenge.expires_at) < Date.now()) return { ok: false, status: 410, error: 'that sign-in request expired — sign in again to get a new one' }
  if (challenge.decision && challenge.decision !== 'pending') return { ok: true, decision: challenge.decision, already: true }
  await query(
    env,
    "UPDATE admin_login_challenges SET decision=?, decided_at=? WHERE id=? AND decision='pending'",
    [verdict, nowIso(), id],
  )
  return { ok: true, decision: verdict }
}

export async function verifyBrowserChallenge(env, user, body) {
  const id = String(body?.challenge_id || '').trim()
  const code = String(body?.code || '').replace(/\s+/g, '')
  const recovery = String(body?.recovery_code || '').trim()
  if (!id || (!recovery && !/^\d{6}$/.test(code))) return { ok: false, status: 400, error: 'enter the 6-digit code from the admin phone' }
  if (recovery && !adminRecoveryConfigured(env)) {
    return { ok: false, status: 503, error: 'the admin recovery code is not configured on the server' }
  }

  const { rows } = await query(
    env,
    `SELECT id, device_id, device_kind, label, details, ip, code_hash, attempts, used, expires_at, decision
       FROM admin_login_challenges WHERE id=? AND user_id=? LIMIT 1`,
    [id, user.id],
  )
  const challenge = rows[0]
  if (!challenge || challenge.used) return { ok: false, status: 400, error: 'this code is no longer valid — sign in again to get a new one' }
  if (challenge.decision === 'denied') return { ok: false, status: 403, error: 'this sign-in was denied on the admin phone' }
  if (Date.parse(challenge.expires_at) < Date.now()) return { ok: false, status: 400, error: 'this code has expired — sign in again to get a new one' }
  if (Number(challenge.attempts) >= MAX_ATTEMPTS) return { ok: false, status: 429, error: 'too many wrong codes — sign in again to get a new one' }

  const deviceId = String(body?.device_id || '').trim()
  if (!deviceId || deviceId !== challenge.device_id) {
    return { ok: false, status: 400, error: 'this code was issued for a different browser — sign in again' }
  }

  let ok = false
  if (recovery) {
    ok = await secretMatches(recovery, String(env.ADMIN_RECOVERY_CODE || '').trim())
  } else {
    try { ok = await pbkdf2Verify(code, challenge.code_hash) } catch { ok = false }
  }
  if (!ok) {
    const next = Number(challenge.attempts) + 1
    await query(env, 'UPDATE admin_login_challenges SET attempts=? WHERE id=?', [next, id])
    return { ok: false, status: 401, error: next >= MAX_ATTEMPTS ? 'too many wrong codes — sign in again to get a new one' : recovery ? 'that recovery code is not right — check it and try again' : 'that code is not right — check the admin phone and try again' }
  }

  // Claim the challenge atomically: two simultaneous verifies must not both
  // approve a browser from one code.
  const claimed = await query(env, 'UPDATE admin_login_challenges SET used=1 WHERE id=? AND used=0', [id])
  if (Number(claimed?.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 400, error: 'this code is no longer valid — sign in again to get a new one' }
  }
  // Approving a third device keeps the other trusted devices signed in, but
  // the one used longest ago drops off the two-device allowance; its token
  // carries this device id, so it is refused on the next request.
  const kind = challenge.device_kind === 'mobile' ? 'mobile' : 'web'
  const now = nowIso()
  await query(
    env,
    `INSERT INTO admin_devices (id, user_id, kind, device_id, label, details, last_ip, created_at, last_seen_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (user_id, device_id) DO UPDATE SET
       kind=excluded.kind,
       last_seen_at=excluded.last_seen_at,
       label=COALESCE(excluded.label, admin_devices.label),
       details=COALESCE(excluded.details, admin_devices.details),
       last_ip=COALESCE(excluded.last_ip, admin_devices.last_ip)`,
    [uuid(), user.id, kind, deviceId, challenge.label, challenge.details || null, challenge.ip || null, now, now],
  )
  await query(
    env,
    `DELETE FROM admin_devices
      WHERE user_id=? AND id NOT IN (
        SELECT id FROM admin_devices WHERE user_id=? ORDER BY last_seen_at DESC LIMIT ?
      )`,
    [user.id, user.id, MAX_TRUSTED_DEVICES],
  )
  return { ok: true, kind, epoch: await currentEpoch(env, user.id, kind), deviceId }
}

function parseDetails(raw) {
  try {
    const value = JSON.parse(String(raw || '{}'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

// ── Device inventory ──
// The admin needs to see which devices hold a session, not just a count. One
// row per installation: signing out and back in updates that row, because the
// installation id is the key — so the list cannot grow twins over time.
export async function listAdminDevices(env, userId, currentDeviceId = '') {
  const rows = await getAllDevices(env, userId)
  const current = String(currentDeviceId || '')
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    label: row.label || (row.kind === 'mobile' ? 'Admin phone' : 'Admin browser'),
    details: parseDetails(row.details),
    last_ip: row.last_ip || '',
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    current: !!current && row.device_id === current,
  }))
}

// Revoking deletes the row; every admin request checks that its device row
// still exists, so the evicted device's token stops working immediately.
export async function revokeAdminDevice(env, userId, rowId, currentDeviceId = '') {
  const id = String(rowId || '').trim()
  if (!id) return { ok: false, status: 400, error: 'which device? none was named' }
  const { rows } = await query(
    env,
    'SELECT id, device_id FROM admin_devices WHERE user_id=? AND id=? LIMIT 1',
    [userId, id],
  )
  const row = rows[0]
  if (!row) return { ok: false, status: 404, error: 'that device is no longer signed in' }
  if (currentDeviceId && row.device_id === String(currentDeviceId)) {
    return { ok: false, status: 400, error: 'that is the device you are using — sign out on it instead' }
  }
  await query(env, 'DELETE FROM admin_devices WHERE user_id=? AND id=?', [userId, id])
  return { ok: true }
}

