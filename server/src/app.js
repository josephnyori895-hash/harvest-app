import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'

import { pool } from './db.js'
import mediaRoutes from './routes/media.js'
import feedRoutes from './routes/feed.js'
import pendingRoutes from './routes/pending.js'
import chatRoutes from './routes/chat.js'
import usersRoutes from './routes/users.js'
import givingRoutes from './routes/giving.js'
import {
  makeAuthenticate,
  isAdminPin,
  isValidMemberPin,
  loginRateLimit,
  clearLoginRateLimit,
} from './middleware/auth.js'

dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is required and must be at least 32 random characters')
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PIN_HASHES) {
  console.warn('[boot] ADMIN_PIN_HASHES not set — bootstrap claim disabled (admins come from the seed migration or existing admins)')
}
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
  console.warn('[boot] CORS_ORIGINS not set — set it to "https://localhost,<your-netlify-url>" so the Android APK can call the API')
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: 1024 * 1024,
  })

  const allowedOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)

  await app.register(cors, {
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: false,
  })

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  })

  // API-wide browser hardening. Authentication is bearer-token based, so the API
  // does not need credentialed CORS or cookie-based CSRF allowances.
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'geolocation=(), payment=()')
    // Routes may set a narrower value (e.g. signed media is privately cacheable).
    if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
  })

  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, 'unhandled API error')
    if (reply.sent) return
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message || 'request failed' })
    }
    return reply.code(500).send({ error: 'internal server error' })
  })

  const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
  app.addHook('onRequest', authenticate)

  // Kenyan mobile normalization: 07xx/01xx/+2547xx/+2541xx -> +2547xxxxxxxx
  const normalizePhone = raw => {
    const digits = String(raw || '').replace(/[^\d+]/g, '')
    const m = digits.match(/^(?:\+?254|0)?([17]\d{8})$/)
    return m ? `+254${m[1]}` : null
  }

  const RESERVED_USERNAMES = new Set(['allan', 'admin', 'administrator', 'harvest', 'harvestfamily', 'harvestfamilychurch', 'support', 'help', 'root', 'moderator', 'pst.simon', 'youth_harvest', 'worship_team'])
  const REG_GROUPS = new Set(['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'])

  // Public self-registration: username + full name + phone + password.
  // Members always register as role='member', verified=FALSE. Admin accounts are
  // provisioned exclusively by the migration seed (allan) or by an existing admin.
  app.post('/api/auth/register', { preHandler: [loginRateLimit] }, async (req, reply) => {
    const { username, name, phone, password, group_name: groupName } = req.body || {}
    const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    const fullName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    const normPhone = normalizePhone(phone)
    const pass = String(password || '')

    if (!uname || uname.length < 3) return reply.code(400).send({ error: 'username must be at least 3 characters (letters, numbers, dots, dashes)' })
    if (RESERVED_USERNAMES.has(uname)) return reply.code(409).send({ error: 'that username is reserved — please choose another' })
    if (!fullName || fullName.length < 2) return reply.code(400).send({ error: 'your full name is required' })
    if (!normPhone) return reply.code(400).send({ error: 'enter a valid Safaricom/Airtel number, e.g. 0712 345 678' })
    if (pass.length < 8) return reply.code(400).send({ error: 'password must be at least 8 characters' })
    const group = REG_GROUPS.has(groupName) ? groupName : 'Harvest Central'

    const dup = await pool.query('SELECT username, phone_normalized FROM users WHERE username=$1 OR phone_normalized=$2 LIMIT 2', [uname, normPhone])
    if (dup.rows.some(row => row.username === uname)) return reply.code(409).send({ error: 'that username is already taken' })
    if (dup.rows.some(row => row.phone_normalized === normPhone)) return reply.code(409).send({ error: 'this phone number already has an account — sign in instead' })

    const hash = await bcrypt.hash(pass, 12)
    const inserted = await pool.query(
      `INSERT INTO users (username, name, phone, phone_normalized, group_name, role, verified, password_hash)
       VALUES ($1,$2,$3,$4,$5,'member',FALSE,$6)
       RETURNING id, username, name, group_name, role, verified`,
      [uname, fullName, String(phone || '').trim().slice(0, 32), normPhone, group, hash],
    )
    const user = inserted.rows[0]
    await pool.query(
      `INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES ($1,'member','self_register','user',$2,$3)`,
      [user.id, user.id, JSON.stringify({ username: uname, group })],
    ).catch(() => {})

    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'member', group_name: user.group_name, verified: false },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' },
    )
    return reply.code(201).send({ token, role: 'member', username: user.username, verified: false, expiresIn: '24h' })
  })

  app.post('/api/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
    const { pin, password, username } = req.body || {}
    const p = String(password ?? pin ?? '').trim()
    const identifier = String(username || '').trim().toLowerCase()
    const uname = identifier.replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    const phoneNorm = normalizePhone(identifier)
    const adminCredential = p ? await isAdminPin(p) : false
    const memberPinOk = p ? isValidMemberPin(p) : false
    const denied = async (code, message) => {
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
      return reply.code(code).send({ error: message })
    }

    if (!p || (!uname && !phoneNorm)) {
      if (!p) await clearLoginRateLimit(req)
      return reply.code(401).send({ error: 'username/phone and password are required' })
    }

    const r = await pool.query(
      'SELECT id, username, role, group_name, constituency, faith, verified, active, pin_hash, password_hash FROM users WHERE username=$1 OR ($2::text IS NOT NULL AND phone_normalized=$2)',
      [uname, phoneNorm],
    )
    const user = r.rows[0] || null
    if (!user) return denied(401, 'invalid username/phone or password')
    if (user.active === false) return denied(403, 'this account has been deactivated — contact the admin')

    const role = user.role
    if (!['member', 'admin'].includes(role)) return denied(403, 'account role is invalid')

    // Password (any printable secret) or legacy 4-6 digit PIN both authenticate.
    let ok = false
    if (user.password_hash) ok = await bcrypt.compare(p, user.password_hash).catch(() => false)
    if (!ok && memberPinOk && user.pin_hash) ok = await bcrypt.compare(p, user.pin_hash).catch(() => false)

    if (role === 'admin' && !ok) {
      // Admin accounts are bound to their own credential once provisioned. ADMIN_PIN_HASHES
      // is a bootstrap credential only: it can claim an account that has no pin_hash yet.
      if (adminCredential && !user.pin_hash) {
        const hash = await bcrypt.hash(p, 12)
        await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1 AND pin_hash IS NULL', [user.id, hash])
        ok = true
      }
    }
    if (!ok) return denied(401, 'invalid username/phone or password')

    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname || user.username]).catch(() => {})
    await clearLoginRateLimit(req)
    const expiresIn = role === 'member' ? '24h' : '7d'
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role,
        group_name: user.group_name,
        constituency: user.constituency,
        faith: user.faith,
        verified: Boolean(user.verified),
      },
      JWT_SECRET,
      { expiresIn, algorithm: 'HS256' },
    )

    return reply.send({ token, role, username: user.username, verified: Boolean(user.verified), expiresIn })
  })

  app.get('/health', async (_req, reply) => {
    const pg = await pool.query('SELECT 1').then(() => 'ok').catch(e => e.message)
    if (pg !== 'ok') return reply.code(503).send({ status: 'degraded', pg })
    return { status: 'ok', pg, storage: 'netlify-blobs', database: 'netlify-database' }
  })

  await app.register(mediaRoutes)
  await app.register(feedRoutes)
  await app.register(pendingRoutes)
  await app.register(chatRoutes)
  await app.register(usersRoutes)
  await app.register(givingRoutes)

  return app
}
