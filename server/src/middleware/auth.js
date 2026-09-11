import jwt from 'jsonwebtoken'
import { query } from '../db.js'

function canonicalUsername(value, max = 32) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, max)
}

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

    const { rows } = await query('SELECT id, username, role, verified FROM users WHERE id=$1', [req.user.id])
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
  const uname = canonicalUsername(req.body?.username) || 'guest'
  const result = await query(
    `SELECT COUNT(*)::int AS count
       FROM login_attempts
      WHERE ip=$1 AND username=$2 AND success=false
        AND created_at > now() - interval '15 minutes'`,
    [ip, uname],
  )
  const count = Number(result.rows[0]?.count || 0)
  req._rateIdentity = { ip, username: uname }
  if (count >= 5) {
    return reply.code(429).send({ error: 'too many login attempts — try in 15 min', retryAfter: 900 })
  }
}

export async function clearLoginRateLimit(req) {
  const identity = req._rateIdentity
  if (!identity) return
  await query(
    `DELETE FROM login_attempts
      WHERE ip=$1 AND username=$2 AND success=false
        AND created_at > now() - interval '15 minutes'`,
    [identity.ip, identity.username],
  ).catch(() => {})
}
