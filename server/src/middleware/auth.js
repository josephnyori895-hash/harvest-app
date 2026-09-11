import jwt from 'jsonwebtoken'
import { pool } from '../db.js'

/**
 * Hardened auth middleware — Harvest has three user types:
 * normal member, verified member (represented by users.verified), and admin.
 * `verified` is a trust/publishing attribute, never an authorization role.
 */
export function makeAuthenticate({ jwtSecret }) {
  if (!jwtSecret || jwtSecret === 'dev-jwt-secret-change-in-prod') console.warn('[auth] JWT_SECRET is default — set JWT_SECRET env in prod')
  return async function authenticate(req, reply) {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) { req.user = null; return }
    const token = h.slice(7).trim()
    if (!token) { req.user = null; return }
    try {
      const payload = jwt.verify(token, jwtSecret)
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
    if (req.user.id === '00000000-0000-0000-0000-000000000000') return reply.code(403).send({ error: 'account authentication required' })

    const { rows } = await pool.query('SELECT id, username, role, verified FROM users WHERE id=$1', [req.user.id])
    const current = rows[0]
    if (!current) { req.user = null; return reply.code(401).send({ error: 'account no longer exists' }) }
    if (!['admin', 'member', 'guest'].includes(current.role)) return reply.code(403).send({ error: 'account role is invalid' })

    req.user = { ...req.user, id: current.id, username: current.username, role: current.role, verified: Boolean(current.verified) }
    const role = current.role
    if (role === 'admin') return
    if (set.has(role)) return
    const needRank = Math.min(...[...set].map(r => RANK[r] ?? 99))
    if ((RANK[role] ?? -1) >= needRank && needRank <= 1) return
    return reply.code(403).send({ error: `role ${role} not allowed — need ${[...set].join('|')}` })
  }
}

export const requireAdmin = requireRole('admin')
// Kept as a compatibility export while pastor/leader roles are removed from the product model.
export const requirePastor = requireAdmin
export const requireMember = requireRole('member', 'admin')

import bcrypt from 'bcryptjs'
export function getAdminPinHashes() {
  try { const raw = process.env.ADMIN_PIN_HASHES; if (!raw) return null; const arr = JSON.parse(raw); return Array.isArray(arr) && arr.length ? arr : null } catch { return null }
}
export async function isAdminPin(pin) {
  const p = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(p) && p !== '7C3AED') return false
  const hashes = getAdminPinHashes()
  if (hashes) { for (const h of hashes) { try { if (await bcrypt.compare(p, h)) return true } catch {} } return false }
  if (process.env.NODE_ENV === 'production') { console.warn('[auth] ADMIN_PIN_HASHES not set in production — admin login disabled'); return false }
  return ['7777', '0000', '7C3AED'].includes(p)
}
export function isValidMemberPin(pin) { return /^\d{4,6}$/.test(String(pin || '').trim()) }

const buckets = new Map()
export async function loginRateLimit(req, reply) {
  const ip = req.ip
  const uname = String(req.body?.username || '').toLowerCase()
  const key = `${ip}:${uname || 'guest'}`
  const now = Date.now()
  const rec = buckets.get(key)
  if (rec && now > rec.resetAt) buckets.delete(key)
  const cur = buckets.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 }
  if (cur.count >= 5) return reply.code(429).send({ error: 'too many login attempts — try in 15 min', retryAfter: Math.ceil((cur.resetAt - now) / 1000) })
  cur.count++
  buckets.set(key, cur)
  req._rateKey = key
}
export function clearLoginRateLimit(req) { if (req._rateKey) buckets.delete(req._rateKey) }
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k) }, 30 * 60 * 1000).unref?.()
