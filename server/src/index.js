import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config()

import { ensureBucket } from './s3.js'
import { pool } from './db.js'
import bcrypt from 'bcryptjs'
import mediaRoutes from './routes/media.js'
import feedRoutes from './routes/feed.js'
import pendingRoutes from './routes/pending.js'
import chatRoutes from './routes/chat.js'
import usersRoutes from './routes/users.js'
import givingRoutes from './routes/giving.js'
import { attachRealtime } from './realtime/io.js'

const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === 'dev-jwt-secret-change-in-prod') {
  throw new Error('JWT_SECRET is required and must be at least 32 random characters')
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PIN_HASHES) {
  throw new Error('ADMIN_PIN_HASHES is required in production')
}
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
  throw new Error('CORS_ORIGINS is required in production')
}

const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY === 'true' })
const allowedOrigins = String(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)
await app.register(cors, {
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: true,
})

import { makeAuthenticate, isAdminPin, isValidMemberPin, loginRateLimit, clearLoginRateLimit } from './middleware/auth.js'
const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
app.addHook('onRequest', authenticate)

app.post('/api/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
  const { pin, username } = req.body || {}
  const p = String(pin || '').trim()
  const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
  const adminCredential = p ? await isAdminPin(p) : false
  const memberPinOk = p ? isValidMemberPin(p) : false

  if (p && !memberPinOk && !adminCredential) {
    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
    return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
  }

  if (!uname) {
    await clearLoginRateLimit(req)
    return reply.code(401).send({ error: 'username and PIN are required' })
  }

  const r = await pool.query('SELECT id, username, role, group_name, constituency, faith, verified, pin_hash FROM users WHERE username=$1', [uname])
  const user = r.rows[0] || null
  if (!user) {
    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(() => {})
    return reply.code(401).send({ error: 'invalid username or PIN' })
  }

  let role = user.role
  if (!['member', 'admin'].includes(user.role)) {
    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(() => {})
    return reply.code(403).send({ error: 'account role is invalid' })
  }

  if (user.role === 'admin') {
    if (!adminCredential) {
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(() => {})
      return reply.code(401).send({ error: 'admin PIN incorrect' })
    }
    if (!user.pin_hash) {
      const hash = await bcrypt.hash(p, 12)
      await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1', [user.id, hash])
    }
  } else {
    if (!memberPinOk || !user.pin_hash) {
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(() => {})
      return reply.code(401).send({ error: 'invalid username or PIN' })
    }
    const ok = await bcrypt.compare(p, user.pin_hash).catch(() => false)
    if (!ok) {
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(() => {})
      return reply.code(401).send({ error: 'invalid username or PIN' })
    }
  }

  await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(() => {})
  await clearLoginRateLimit(req)
  const expiresIn = role === 'member' ? '24h' : '7d'
  const token = jwt.sign({ id: user.id, username: user.username, role, group_name: user.group_name, constituency: user.constituency, faith: user.faith, verified: Boolean(user.verified) }, JWT_SECRET, { expiresIn, algorithm: 'HS256' })
  return reply.send({ token, role, username: user.username, verified: Boolean(user.verified), expiresIn })
})

app.get('/health', async (req, reply) => {
  const pg = await pool.query('SELECT 1').then(() => 'ok').catch(e => e.message)
  if (pg !== 'ok') return reply.code(503).send({ status: 'degraded', pg })
  return { status: 'ok', pg, uptime: process.uptime(), bucket: process.env.MINIO_BUCKET || 'harvest-media' }
})

await app.register(mediaRoutes)
await app.register(feedRoutes)
await app.register(pendingRoutes)
await app.register(chatRoutes)
await app.register(usersRoutes)
await app.register(givingRoutes)

const port = parseInt(process.env.PORT || '3000', 10)
await ensureBucket().catch(e => {
  app.log.error({ err: e }, '[s3] ensureBucket failed')
  if (process.env.NODE_ENV === 'production') throw e
})
await app.listen({ port, host: '0.0.0.0' })
console.log(`[api] listening :${port}`)
await attachRealtime(app.server)
console.log(`[realtime] socket.io attached :${port}  (coturn 3478 separate)`)
