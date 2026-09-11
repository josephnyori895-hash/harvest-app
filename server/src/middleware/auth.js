import jwt from 'jsonwebtoken'

/**
 * Hardened auth middleware — VPS-only, PIN bcrypt kept, no OTP.
 * Roles: admin | pastor | member | guest  (extends 001_init.sql member|admin)
 * - guest: no PIN / no JWT or expired -> req.user = null
 * - member: any 4-6 digit PIN (bcrypt hash stored in users.pin_hash)
 * - pastor: whitelisted username OR pin_hash + role='pastor' in DB (no separate PIN list)
 * - admin: PIN matches ADMIN_PIN_HASHES (bcrypt) — never plaintext in prod
 */

// --- JWT authenticate (replaces inline hook at src/index.js:20) ---
export function makeAuthenticate({ jwtSecret }) {
  if (!jwtSecret || jwtSecret === 'dev-jwt-secret-change-in-prod') {
    console.warn('[auth] JWT_SECRET is default — set JWT_SECRET env in prod (openssl rand -hex 32)')
  }
  return async function authenticate(req, reply) {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) {
      req.user = null
      return
    }
    const token = h.slice(7).trim()
    if (!token) { req.user = null; return }
    try {
      const payload = jwt.verify(token, jwtSecret)
      // enforce shape: id, username, role in {admin,pastor,member,guest}
      if (!payload?.id || !payload?.username || !payload?.role) throw new Error('bad payload shape')
      if (!['admin','pastor','member','guest'].includes(payload.role)) throw new Error('bad role')
      req.user = payload
      // optional: attach token iat/exp for sliding refresh check
    } catch (e) {
      // do NOT swallow silently — set null and optionally log once per IP (rate-limited)
      req.user = null
      // let protected routes reject with 401; public routes continue
      // attach error for downstream to inspect if needed
      req.authError = e.message
    }
  }
}

// --- RBAC guard factory (fixes Guard Admin 188) ---
// Usage: app.get('/api/pending', { preHandler: [authenticate, requireRole('admin')] }, handler)
// Admin bypasses pastor check; pastor can approve where allowed.
const RANK = { guest: 0, member: 1, pastor: 2, admin: 3 }
export function requireRole(...allowed) {
  const set = new Set(allowed.flat())
  return async function guard(req, reply) {
    const role = req.user?.role || 'guest'
    if (!req.user) {
      return reply.code(401).send({ error: 'auth required — POST /api/auth/login {pin, username} to get JWT' })
    }
    // admin always passes (superuser)
    if (role === 'admin') return
    if (set.has(role)) return
    // also allow higher rank if allowed includes lower rank? e.g. pastor can do member routes
    // Explicit: if route allows 'member', pastor+admin pass
    const needRank = Math.min(...[...set].map(r => RANK[r] ?? 99))
    if ((RANK[role] ?? -1) >= needRank && needRank <= 1) return
    return reply.code(403).send({ error: `role ${role} not allowed — need ${[...set].join('|')}` })
  }
}

// convenience shorthands for route files
export const requireAdmin = requireRole('admin')
export const requirePastor = requireRole('pastor', 'admin')
export const requireMember = requireRole('member', 'pastor', 'admin')

// --- PIN helpers (kept) ---
import bcrypt from 'bcryptjs'
// ADMIN PINs: never plaintext in prod. Env ADMIN_PIN_HASHES='["$2a$10$...","..."]'
// Dev fallback only when NODE_ENV !== 'production'
export function getAdminPinHashes() {
  try {
    const raw = process.env.ADMIN_PIN_HASHES
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) && arr.length ? arr : null
  } catch { return null }
}

export async function isAdminPin(pin) {
  const p = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(p) && p !== '7C3AED') return false // PIN kept: 4-6 digits + legacy 7C3AED
  const hashes = getAdminPinHashes()
  if (hashes) {
    for (const h of hashes) {
      try { if (await bcrypt.compare(p, h)) return true } catch {}
    }
    return false
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[auth] ADMIN_PIN_HASHES not set in production — admin login disabled (set hashes)')
    return false // fail-closed in prod, no plaintext fallback
  }
  const PLAIN_FALLBACK = ['7777','0000','7C3AED']
  return PLAIN_FALLBACK.includes(p)
}

// member PIN policy: 4-6 digits, not sequential like 1234? keep simple for church 500 users
export function isValidMemberPin(pin) {
  const p = String(pin || '').trim()
  return /^\d{4,6}$/.test(p)
}

// --- light in-memory rate limit for /api/auth/login (VPS 500 users, no Redis) ---
// 5 attempts / 15 min per IP+username, then 429. Single VPS memory is fine for 500 users.
// If REDIS_URL set, could upgrade to Redis; kept in-memory to save 64M.
const buckets = new Map() // key -> { count, resetAt }
export async function loginRateLimit(req, reply) {
  const ip = req.ip
  const uname = String(req.body?.username || '').toLowerCase()
  const key = `${ip}:${uname || 'guest'}`
  const now = Date.now()
  const rec = buckets.get(key)
  if (rec && now > rec.resetAt) buckets.delete(key)
  const cur = buckets.get(key) || { count: 0, resetAt: now + 15*60*1000 }
  if (cur.count >= 5) {
    return reply.code(429).send({ error: 'too many login attempts — try in 15 min', retryAfter: Math.ceil((cur.resetAt - now)/1000) })
  }
  cur.count++
  buckets.set(key, cur)
  req._rateKey = key
}
export function clearLoginRateLimit(req) {
  if (req._rateKey) buckets.delete(req._rateKey)
}
// periodic GC every 30 min
setInterval(() => {
  const now = Date.now()
  for (const [k,v] of buckets) if (now > v.resetAt) buckets.delete(k)
}, 30*60*1000).unref?.()
