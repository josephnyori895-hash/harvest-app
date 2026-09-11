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
import { makeAuthenticate, isAdminPin, isValidMemberPin, loginRateLimit, clearLoginRateLimit } from './middleware/auth.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('[config] JWT_SECRET must be set and at least 32 characters long')
}

const app = Fastify({ logger: true })

const configuredOrigins = String(process.env.APP_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

await app.register(cors, {
  origin(origin, cb) {
    // Native Capacitor clients and non-browser requests do not send Origin.
    if (!origin) return cb(null, true)
    if (configuredOrigins.includes(origin)) return cb(null, true)
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(?::\d+)?$/.test(origin)) {
      return cb(null, true)
    }
    return cb(null, false)
  },
})

const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
app.addHook('onRequest', authenticate)

// Authentication remains PIN-based for the current VPS deployment, but identity and
// role elevation are always decided by the database. A shared admin PIN can only
// authenticate an account that is already an admin; it can never promote/create one.
app.post('/api/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
  const { pin, username } = req.body || {}
  const p = String(pin || '').trim()
  const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
  const adminPin = p ? await isAdminPin(p) : false

  if (p && !isValidMemberPin(p) && !adminPin) {
    await pool.query(
      'INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)',
      [req.ip, uname || 'guest'],
    ).catch(() => {})
    return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
  }

  if (!uname) {
    clearLoginRateLimit(req)
    return reply.send({
      token: jwt.sign({ id: 'guest', username: 'guest', role: 'guest' }, JWT_SECRET, { expiresIn: '2h' }),
      role: 'guest',
      username: 'guest',
      expiresIn: '2h',
    })
  }

  const result = await pool.query(
    'SELECT id, username, role, group_name, constituency, faith, verified, pin_hash FROM users WHERE username=$1',
    [uname],
  )
  let user = result.rows[0] || null

  if (!user) {
    // Never create an admin from an authentication secret. New accounts are members.
    if (adminPin) {
      await pool.query(
        'INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)',
        [req.ip, uname],
      ).catch(() => {})
      return reply.code(403).send({ error: 'admin account not found' })
    }
    const hash = p ? await bcrypt.hash(p, 10) : null
    const inserted = await pool.query(
      'INSERT INTO users (username,name,group_name,role,pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,role,group_name,constituency,faith,verified',
      [uname, uname, 'Harvest Central', 'member', hash],
    )
    user = inserted.rows[0]
  }

  if (adminPin && user.role !== 'admin') {
    await pool.query(
      'INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)',
      [req.ip, uname],
    ).catch(() => {})
    return reply.code(403).send({ error: 'admin credentials required for an admin account' })
  }

  if (p && user.pin_hash) {
    const ok = await bcrypt.compare(p, user.pin_hash).catch(() => false)
    // Admin accounts still need the configured admin secret; members/pastors need their own PIN.
    if (!ok && !adminPin) {
      await pool.query(
        'INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)',
        [req.ip, uname],
      ).catch(() => {})
      return reply.code(401).send({ error: 'PIN incorrect' })
    }
  } else if (p && !user.pin_hash) {
    const hash = await bcrypt.hash(p, 10)
    await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1', [user.id, hash])
  }

  const role = ['admin', 'pastor', 'member'].includes(user.role) ? user.role : 'member'
  await pool.query(
    'INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)',
    [req.ip, uname],
  ).catch(() => {})
  clearLoginRateLimit(req)

  const expiresIn = role === 'member' ? '24h' : '7d'
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role,
      group_name: user.group_name,
      constituency: user.constituency,
      faith: user.faith,
    },
    JWT_SECRET,
    { expiresIn },
  )
  return reply.send({ token, role, username: user.username, expiresIn })
})

app.get('/health', async () => {
  const pg = await pool.query('SELECT 1').then(() => 'ok').catch(e => e.message)
  return { status: 'ok', pg, uptime: process.uptime(), bucket: process.env.MINIO_BUCKET || 'harvest-media' }
})

await app.register(mediaRoutes)
await app.register(feedRoutes)
await app.register(pendingRoutes)
await app.register(chatRoutes)
await app.register(usersRoutes)

const port = parseInt(process.env.PORT || '3000', 10)
await ensureBucket().catch(e => console.warn('[s3] ensureBucket', e.message))
await app.listen({ port, host: '0.0.0.0' })
console.log(`[api] listening :${port}`)
await attachRealtime(app.server)
console.log(`[realtime] socket.io attached ws://0.0.0.0:${port}  (coturn 3478 separate)`)
