import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { redis } from '../redis.js'

export function makeAuthenticate({ jwtSecret }) {
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'dev-jwt-secret-change-in-prod') {
    throw new Error('JWT_SECRET must be configured with at least 32 random characters')
  }
  return async function authenticate(req, reply) {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) { req.user = null; return }
    const token = h.slice(7).trim()
    if (!token) { req.user = null; return }
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })
      if (!payload?.id || !payload?.username || !payload?.role) throw new Error('bad payload shape')
      if (!['admin', 'member', 'guest'].includes(payload.role)) throw new Error('bad role')
      req.user = payload
    } catch (e) { req.user = null; req.authError = e.message }
  }
}

const RANK = { guest: 0, member: 1, admin: 2 }
export function requireRole(...allowed) {
  const set = new Set(allowed.flat())
  return async function guard(req, reply) {
    if (!req.user) return reply.code(401).send({ error: 'auth required — POST /api/auth/login {pin, username} to get JWT' })
    if (req.user.id === '00000000-0000-0000-0000-000000000000' || req.user.role === 'guest') {
      return reply.code(403).send({ error: 'account authentication required' })
    }

    const { rows } = await pool.query('SELECT id, username, role, verified FROM users WHERE id=$1', [req.user.id])
    const current = rows[0]
    if (!current) { req.user = null; return reply.code(401).send({ error: 'account no longer exists' }) }
    if (!['admin', 'member'].includes(current.role)) return reply.code(403).send({ error: 'account role is invalid' })

    req.user = { ...req.user, id: current.id, username: current.username, role: current.role, verified: Boolean(current.verified) }
    const role = current.role
    if (set.has(role)) return
    const needRank = Math.min(...[...set].map(r => RANK[r] ?? 99))
    if ((RANK[role] ?? -1) >= needRank && needRank <= 1) return
    return reply.code(403).send({ error: `role ${role} not allowed — need ${[...set].join('|')}` })
  }
}

export const requireAdmin = requireRole('admin')
export const requireMember = requireRole('member', 'admin')

import bcrypt from 'bcryptjs'
export function getAdminPinHashes() {
  try {
    const raw = process.env.ADMIN_PIN_HASHES
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) && arr.every(v => typeof v === 'string' && v.startsWith('$2')) ? arr : null
  } catch { return null }
}
export async function isAdminPin(pin) {
  const p = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(p)) return false
  const hashes = getAdminPinHashes()
  if (!hashes?.length) return false
  for (const h of hashes) {
    try { if (await bcrypt.compare(p, h)) return true } catch {}
  }
  return false
}
export function isValidMemberPin(pin) { return /^\d{4,6}$/.test(String(pin || '').trim()) }

export async function loginRateLimit(req, reply) {
  const ip = String(req.ip || 'unknown')
  const uname = String(req.body?.username || '').trim().toLowerCase().slice(0, 64)
  const key = `harvest:login:${ip}:${uname || 'guest'}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 15 * 60)
  req._rateKey = key
  if (count > 5) {
    const ttl = await redis.ttl(key)
    return reply.code(429).send({ error: 'too many login attempts — try in 15 min', retryAfter: Math.max(ttl, 1) })
  }
}
export async function clearLoginRateLimit(req) {
  if (req._rateKey) await redis.del(req._rateKey)
}
