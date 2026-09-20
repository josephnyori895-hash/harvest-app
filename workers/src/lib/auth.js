// Auth middleware — port of server/src/middleware/auth.js.
// JWT verify (HS256) + per-request user context + role guards + login rate limit.
import { jwtVerify, pbkdf2Verify } from './crypto.js'
import { query, isoMinutesAgo } from './db.js'
import { httpError } from './http.js'

const GUEST_ID = '00000000-0000-0000-0000-000000000000'

function requireJwtSecret(env) {
  const secret = String(env.JWT_SECRET || '')
  if (secret.length < 32) throw httpError(500, 'authentication service is not configured')
  return secret
}

export async function authenticate(env, request) {
  const h = request.headers.get('authorization') || ''
  if (!h.startsWith('Bearer ')) return null
  const token = h.slice(7).trim()
  if (!token) return null
  const secret = requireJwtSecret(env)
  try {
    const payload = await jwtVerify(token, secret)
    if (!payload?.id || !payload?.username || !payload?.role) throw new Error('bad payload shape')
    if (!['admin', 'member', 'guest'].includes(payload.role)) throw new Error('bad role')
    return payload
  } catch {
    return null
  }
}

const RANK = { guest: 0, member: 1, admin: 2 }

// Fresh-DB role guard. Throws ApiError on failure (caught by the router).
export async function requireRole(env, user, ...allowed) {
  const set = new Set(allowed.flat())
  if (!user) throw httpError(401, 'auth required — POST /api/auth/login {password, username} to get JWT')
  if (user.id === GUEST_ID || user.role === 'guest') throw httpError(403, 'account authentication required')

  const { rows } = await query(env, 'SELECT id, username, role, verified, active, grants FROM users WHERE id = ?', [user.id])
  const current = rows[0]
  if (!current) throw httpError(401, 'account no longer exists')
  if (!current.active) throw httpError(403, 'account is deactivated')
  if (!['admin', 'member'].includes(current.role)) throw httpError(403, 'account role is invalid')

  const fresh = { ...user, id: current.id, username: current.username, role: current.role, verified: !!current.verified, grants: current.grants || '' }
  const role = current.role
  if (set.has(role)) return fresh
  const needRank = Math.min(...[...set].map(r => RANK[r] ?? 99))
  if ((RANK[role] ?? -1) >= needRank && needRank <= 1) return fresh
  throw httpError(403, `role ${role} not allowed — need ${[...set].join('|')}`)
}

export const requireAdmin = (env, user) => requireRole(env, user, 'admin')
export const requireMember = (env, user) => requireRole(env, user, 'member', 'admin')

// ── PIN bootstrap (admin claim) ──

export function getAdminPinHashes(env) {
  try {
    const raw = env.ADMIN_PIN_HASHES
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) && arr.every(v => typeof v === 'string' && v.startsWith('$2')) ? arr : null
  } catch {
    return null
  }
}

// ADMIN_PIN_HASHES stay bcrypt (cost>=10). bcrypt is unavailable in Workers, so
// the bootstrap pin is verified with a pure-JS bcrypt (only on the admin-claim
// path; member/admin logins use PBKDF2 rows).
import bcrypt from 'bcryptjs'

export async function verifyAdminPin(env, pin) {
  const p = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(p)) return false
  const hashes = getAdminPinHashes(env)
  if (!hashes?.length) return false
  for (const h of hashes) {
    try {
      if (await bcrypt.compare(p, h)) return true
    } catch {}
  }
  return false
}

export function isValidMemberPin(pin) {
  return /^\d{4,6}$/.test(String(pin || '').trim())
}

// ── Login rate limiting: login_attempts table (15 min window, 5 fails) ──

export async function loginRateLimit(env, request, username) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32) || 'guest'
  const { rows } = await query(
    env,
    `SELECT COUNT(*) AS count FROM login_attempts
      WHERE ip = ? AND username = ? AND success = 0 AND created_at > ?`,
    [ip, uname, isoMinutesAgo(15)],
  )
  if (Number(rows[0]?.count || 0) >= 5) {
    throw httpError(429, 'too many login attempts — try in 15 min')
  }
  return { ip, username: uname }
}

export async function clearLoginRateLimit(env, identity) {
  if (!identity) return
  await query(
    env,
    `DELETE FROM login_attempts WHERE ip = ? AND username = ? AND success = 0 AND created_at > ?`,
    [identity.ip, identity.username, isoMinutesAgo(15)],
  ).catch(() => {})
}

export async function recordLoginAttempt(env, ip, username, success) {
  await query(env, 'INSERT INTO login_attempts (ip, username, success, created_at) VALUES (?, ?, ?, ?)', [
    ip,
    username,
    success ? 1 : 0,
    new Date().toISOString(),
  ]).catch(() => {})
}
