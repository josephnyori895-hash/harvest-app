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
import { attachRealtime } from './realtime/io.js'

const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET || JWT_SECRET === 'dev-jwt-secret-change-in-prod') {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production')
  throw new Error('JWT_SECRET is required; set a local development secret in server/.env')
}

const app = Fastify({ logger: true })
const allowedOrigins = String(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)
await app.register(cors, {
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: true,
})

// --- hardened auth hook ---
import { makeAuthenticate, isAdminPin, isValidMemberPin, loginRateLimit, clearLoginRateLimit } from './middleware/auth.js'
const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
app.addHook('onRequest', authenticate)

// --- hardened PIN login ---
// Security invariant: an admin PIN authenticates an existing DB admin; it can never
// promote an arbitrary member or create a privileged account.
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

  let role = 'guest'
  let user = null

  if (uname) {
    const r = await pool.query('SELECT id, username, role, group_name, constituency, faith, verified, pin_hash FROM users WHERE username=$1', [uname])
    user = r.rows[0] || null

    if (!user) {
      if (adminCredential) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
        return reply.code(403).send({ error: 'admin account must already exist and be provisioned' })
      }
      if (!memberPinOk) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
        return reply.code(400).send({ error: 'member PIN required' })
      }
      const hash = await bcrypt.hash(p, 10)
      const ins = await pool.query('INSERT INTO users (username,name,group_name,role,pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,role,group_name,constituency,faith,verified', [uname, uname, 'Harvest Central', 'member', hash])
      user = ins.rows[0]
      role = user.role
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(() => {})
    } else {
      if (!['member', 'admin'].includes(user.role)) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
        return reply.code(403).send({ error: 'account role is invalid' })
      }
      if (adminCredential && user.role !== 'admin') {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
        return reply.code(403).send({ error: 'admin credentials cannot elevate this account' })
      }

      if (user.role === 'admin') {
        if (!adminCredential) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
          return reply.code(401).send({ error: 'admin PIN incorrect' })
        }
        if (!user.pin_hash) {
          const hash = await bcrypt.hash(p, 10)
          await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1', [user.id, hash])
        }
        role = 'admin'
      } else {
        if (!memberPinOk) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
          return reply.code(401).send({ error: 'PIN required' })
        }
        if (!user.pin_hash) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
          return reply.code(403).send({ error: 'account PIN not enrolled — ask an administrator to provision this account' })
        }
        const ok = await bcrypt.compare(p, user.pin_hash).catch(() => false)
        if (!ok) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname || 'guest']).catch(() => {})
          return reply.code(401).send({ error: 'PIN incorrect' })
        }
        role = 'member'
      }
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(() => {})
    }
  } else {
    // No username means no authenticated product user. Do not mint a privileged or
    // member token from an arbitrary PIN.
    clearLoginRateLimit(req)
    return reply.code(401).send({ error: 'username and PIN are required' })
  }

  clearLoginRateLimit(req)
  const expiresIn = role === 'member' ? '24h' : '7d'
  const token = jwt.sign({ id: user.id, username: user.username, role, group_name: user.group_name, constituency: user.constituency, faith: user.faith, verified: Boolean(user.verified) }, JWT_SECRET, { expiresIn })
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

const port = parseInt(process.env.PORT || '3000', 10)
await ensureBucket().catch(e => {
  app.log.error({ err: e }, '[s3] ensureBucket failed')
  if (process.env.NODE_ENV === 'production') throw e
})
await app.listen({ port, host: '0.0.0.0' })
console.log(`[api] listening :${port}`)
await attachRealtime(app.server)
console.log(`[realtime] socket.io attached :${port}  (coturn 3478 separate)`)
