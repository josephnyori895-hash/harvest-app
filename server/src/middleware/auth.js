import jwt from 'jsonwebtoken'
import { pool } from '../db.js'

/**
 * Hardened auth middleware — VPS-only, PIN bcrypt kept, no OTP.
 * Roles: admin | pastor | member | guest.
 * JWTs identify the account, but the database remains the source of truth for role privileges.
 */

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
      if (!payload?.id || !payload?.username || !payload?.role) throw new Error('bad payload shape')
      if (!['admin','pastor','member','guest'].includes(payload.role)) throw new Error('bad role')
      req.user = payload
    } catch (e) {
      req.user = null
      req.authError = e.message
    }
  }
}

// --- RBAC guard: database is the authority, not the role stored in a client JWT ---
const RANK = { guest: 0, member: 1, pastor: 2, admin: 3 }
export function requireRole(...allowed) {
  const set = new Set(allowed.flat())
  return async function guard(req, reply) {
    if (!req.user) {
      return reply.code(401).send({ error: 'auth required — POST /api/auth/login {pin, username} to get JWT' })
    }

    // Synthetic guest tokens must never receive member/admin privileges.
    if (req.user.id === '00000000-0000-0000-0000-000000000000') {
      return reply.code(403).send({ error: 'account authentication required' })
    }

    // Re-read the current role on every protected request so demotions/deactivations
    // take effect immediately instead of waiting for a long-lived JWT to expire.
    const { rows } = await pool.query('SELECT id, username, role FROM users WHERE id=$1', [req.user.id])
    const current = rows[0]
    if (!current) {
      req.user = null
      return reply.code(401).send({ error: 'account no longer exists' })
    }
    if (!['admin','pastor','member','guest'].includes(current.role)) {
      return reply.code(403).send({ error: 'account role is invalid' })
    }

    req.user = { ...req.user, id: current.id, username: current.username, role: current.role }
    const role = current.role
    if (role === 'admin') return
    if (set.has(role)) return

    const needRank = Math.min(...[...set].map(r => RANK[r] ?? 99))
    if ((RANK[role] ?? -1) >= needRank && needRank <= 1) return
    return reply.code(403).send({ error: `role ${role} not allowed — need ${[...set].join('|')}` })
  }
}

export const requireAdmin = requireRole('admin')
export const requirePastor = requireRole('pastor', 'admin')
export const requireMember = requireRole('member', 'pastor', 'admin')

// --- PIN helpers ---
import bcrypt from 'bcryptjs'
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
  if (!/^\d{4,6}$/.test(p) && p !== '7C3AED') return false
  const hashes = getAdminPinHashes()
  if (hashes) {
    for (const h of hashes) {
      try { if (await bcrypt.compare(p, h)) return true } catch {}
    }
    return false
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[auth] ADMIN_PIN_HASHES not set in production — admin login disabled (set hashes)')
    return false
  }
  const PLAIN_FALLBACK = ['7777','0000','7C3AED']
  return PLAIN_FALLBACK.includes(p)
}

export function isValidMemberPin(pin) {
  const p = String(pin || '').trim()
  return /^\d{4,6}$/.test(p)
}

// --- light in-memory rate limit for /api/auth/login ---
const buckets = new Map()
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
setInterval(() => {
  const now = Date.now()
  for (const [k,v] of buckets) if (now > v.resetAt) buckets.delete(k)
}, 30*60*1000).unref?.()
