// Single-administrator device policy.
//
// The admin account is locked to one phone (Capacitor) and one browser. The
// browser becomes trusted only after a 6-digit code is pushed to the phone.
// Tokens carry the epoch for their device kind; approving a new browser bumps
// admin_web_epoch, so the old browser's token is rejected on its next request.
import { query, uuid, nowIso } from './db.js'
import { pbkdf2Hash, pbkdf2Verify } from './crypto.js'
import { sendToDevice } from './fcm.js'

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const DEVICE_RE = /^[A-Za-z0-9._:-]{8,128}$/

export function primaryAdminUsername(env) {
  return String(env.ADMIN_USERNAME || 'harvest_nyeri').trim().toLowerCase()
}

export function isPrimaryAdmin(env, username) {
  return String(username || '').trim().toLowerCase() === primaryAdminUsername(env)
}

export function normalizeAdminDevice(kind, deviceId, label) {
  const k = kind === 'mobile' ? 'mobile' : 'web'
  const id = String(deviceId || '').trim()
  if (!DEVICE_RE.test(id)) return { error: 'a valid device_id (8–128 chars) is required' }
  return {
    kind: k,
    deviceId: id,
    label: String(label || '').trim().slice(0, 120) || null,
  }
}

async function getDevice(env, userId, kind) {
  const { rows } = await query(
    env,
    'SELECT id, device_id, created_at, last_seen_at FROM admin_devices WHERE user_id=? AND kind=? LIMIT 1',
    [userId, kind],
  )
  return rows[0] || null
}

async function currentEpoch(env, userId, kind) {
  const column = kind === 'mobile' ? 'admin_mobile_epoch' : 'admin_web_epoch'
  const { rows } = await query(env, `SELECT ${column} AS epoch FROM users WHERE id=?`, [userId])
  return Number(rows[0]?.epoch) || 0
}

// Binds the first mobile device, or accepts the already-bound one. A different
// phone is refused: the code goes to the bound phone, so approving a new phone
// from an unbound phone would be a way around the single-phone rule.
async function acceptMobile(env, user, device) {
  const bound = await getDevice(env, user.id, 'mobile')
  if (bound && bound.device_id !== device.deviceId) {
    return { ok: false, status: 409, error: 'this admin account is locked to another phone — use the bound phone' }
  }
  if (!bound) {
    const now = nowIso()
    await query(
      env,
      'INSERT INTO admin_devices (id, user_id, kind, device_id, label, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)',
      [uuid(), user.id, 'mobile', device.deviceId, device.label, now, now],
    )
    await query(env, 'UPDATE users SET admin_mobile_epoch=admin_mobile_epoch+1 WHERE id=?', [user.id])
  } else {
    await query(env, 'UPDATE admin_devices SET last_seen_at=?, label=COALESCE(?, label) WHERE id=?', [nowIso(), device.label, bound.id])
  }
  return { ok: true, kind: 'mobile', epoch: await currentEpoch(env, user.id, 'mobile'), bound: !bound ? 'new' : 'existing' }
}

// A browser is trusted if it is the already-bound web device. Anything else
// needs a code; the caller creates and sends the challenge.
export async function checkAdminDevice(env, user, device) {
  if (device.kind === 'mobile') return acceptMobile(env, user, device)
  const bound = await getDevice(env, user.id, 'web')
  if (bound && bound.device_id === device.deviceId) {
    await query(env, 'UPDATE admin_devices SET last_seen_at=? WHERE id=?', [nowIso(), bound.id])
    return { ok: true, kind: 'web', epoch: await currentEpoch(env, user.id, 'web'), bound: 'existing' }
  }
  return { ok: false, needsCode: true }
}

// Creates a browser challenge and pushes the code to the admin phone. There is
// deliberately no way to read the code back from the API. In local development
// ADMIN_OTP_DEV=1 returns the code so the flow can be tested without Firebase.
export async function createBrowserChallenge(env, user, device) {
  const phone = await getDevice(env, user.id, 'mobile')
  if (!phone) {
    return { ok: false, status: 409, error: 'sign in on the admin phone once, with notifications allowed, then approve this browser' }
  }

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  const id = uuid()
  const now = nowIso()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  const codeHash = await pbkdf2Hash(code, 100000)
  await query(
    env,
    `INSERT INTO admin_login_challenges
       (id, user_id, device_id, device_kind, label, code_hash, ip, attempts, used, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,0,0,?,?)`,
    [id, user.id, device.deviceId, device.kind, device.label, codeHash, '', expiresAt, now],
  )

  if (String(env.ADMIN_OTP_DEV || '') === '1') {
    return { ok: true, challengeId: id, expiresAt, devCode: code, delivery: 'dev' }
  }

  // Target only the bound phone's push token. Sending to every notification
  // device on the account would leak the code to a phone that is no longer the
  // admin's trusted device.
  const { rows: pushRows } = await query(
    env,
    `SELECT fcm_token FROM notification_devices
      WHERE user_id=? AND installation_id=? AND enabled=1
      ORDER BY last_seen_at DESC LIMIT 1`,
    [user.id, phone.device_id],
  )
  if (!pushRows[0]) {
    await query(env, 'DELETE FROM admin_login_challenges WHERE id=?', [id]).catch(() => {})
    return { ok: false, status: 409, error: 'the admin phone is not receiving notifications — open the Harvest app on that phone and allow notifications' }
  }

  const delivered = await sendToDevice(env, pushRows[0].fcm_token, {
    notification: {
      title: 'Harvest admin sign-in code',
      body: `${code} is your admin code. It expires in 10 minutes. If this wasn't you, ignore it.`,
    },
    data: { kind: 'admin_login_code', challenge_id: id, code },
    collapseKey: `admin-login:${id}`,
  })

  if (delivered.ok) return { ok: true, challengeId: id, expiresAt, delivery: 'push' }

  // Do not leave an undeliverable challenge lying around.
  await query(env, 'DELETE FROM admin_login_challenges WHERE id=?', [id]).catch(() => {})
  if (delivered.status === 'disabled' || delivered.status === 'unconfigured') {
    return { ok: false, status: 503, error: 'admin code delivery is not configured — enable push notifications first' }
  }
  return { ok: false, status: 503, error: 'could not send the code to the admin phone — check its notifications and try again' }
}

export async function verifyBrowserChallenge(env, user, body) {
  const id = String(body?.challenge_id || '').trim()
  const code = String(body?.code || '').replace(/\s+/g, '')
  if (!id || !/^\d{6}$/.test(code)) return { ok: false, status: 400, error: 'enter the 6-digit code from the admin phone' }

  const { rows } = await query(
    env,
    `SELECT id, device_id, device_kind, label, code_hash, attempts, used, expires_at
       FROM admin_login_challenges WHERE id=? AND user_id=? LIMIT 1`,
    [id, user.id],
  )
  const challenge = rows[0]
  if (!challenge || challenge.used) return { ok: false, status: 400, error: 'this code is no longer valid — sign in again to get a new one' }
  if (Date.parse(challenge.expires_at) < Date.now()) return { ok: false, status: 400, error: 'this code has expired — sign in again to get a new one' }
  if (Number(challenge.attempts) >= MAX_ATTEMPTS) return { ok: false, status: 429, error: 'too many wrong codes — sign in again to get a new one' }

  const deviceId = String(body?.device_id || '').trim()
  if (!deviceId || deviceId !== challenge.device_id) {
    return { ok: false, status: 400, error: 'this code was issued for a different browser — sign in again' }
  }

  let ok = false
  try { ok = await pbkdf2Verify(code, challenge.code_hash) } catch { ok = false }
  if (!ok) {
    const next = Number(challenge.attempts) + 1
    await query(env, 'UPDATE admin_login_challenges SET attempts=? WHERE id=?', [next, id])
    return { ok: false, status: 401, error: next >= MAX_ATTEMPTS ? 'too many wrong codes — sign in again to get a new one' : 'that code is not right — check the admin phone and try again' }
  }

  // Claim the challenge atomically: two simultaneous verifies must not both
  // approve a browser from one code.
  const claimed = await query(env, 'UPDATE admin_login_challenges SET used=1 WHERE id=? AND used=0', [id])
  if (Number(claimed?.meta?.changes ?? 0) < 1) {
    return { ok: false, status: 400, error: 'this code is no longer valid — sign in again to get a new one' }
  }
  // Approving a new browser replaces the old one and bumps the web epoch, so
  // the previous browser's token stops working immediately.
  await query(env, "DELETE FROM admin_devices WHERE user_id=? AND kind='web'", [user.id])
  const now = nowIso()
  await query(
    env,
    'INSERT INTO admin_devices (id, user_id, kind, device_id, label, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)',
    [uuid(), user.id, 'web', deviceId, challenge.label, now, now],
  )
  await query(env, 'UPDATE users SET admin_web_epoch=admin_web_epoch+1 WHERE id=?', [user.id])
  return { ok: true, kind: 'web', epoch: await currentEpoch(env, user.id, 'web') }
}

