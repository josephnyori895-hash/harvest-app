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

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod'
if (!process.env.JWT_SECRET) console.warn('[auth] JWT_SECRET not set — using dev fallback (set openssl rand -hex 32 in prod)')

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })

// --- hardened auth hook ---
import { makeAuthenticate, isAdminPin, isValidMemberPin, loginRateLimit, clearLoginRateLimit } from './middleware/auth.js'
const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
app.addHook('onRequest', authenticate)

// --- hardened PIN login ---
// Security invariant: an admin PIN authenticates an existing DB admin; it can never
// promote an arbitrary member/pastor or create a new admin account. Existing users
// without a pin_hash must be provisioned before they can authenticate with a PIN.
app.post('/api/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
  const { pin, username } = req.body||{}
  const p = String(pin||'').trim()
  const uname = String(username||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,32)
  const adminCredential = p ? await isAdminPin(p) : false
  const memberPinOk = p ? isValidMemberPin(p) : false

  if (p && !memberPinOk && !adminCredential) {
    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
    return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
  }

  let role = 'guest'
  let user = null

  if (uname) {
    const r = await pool.query('SELECT id, username, role, group_name, constituency, faith, verified, pin_hash FROM users WHERE username=$1', [uname])
    user = r.rows[0] || null

    if (!user) {
      // New accounts can self-enroll as members with a valid member PIN.
      // Admin credentials are intentionally excluded from account creation.
      if (adminCredential) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
        return reply.code(403).send({ error: 'admin account must already exist and be provisioned' })
      }
      if (!memberPinOk) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
        return reply.code(400).send({ error: 'member PIN required' })
      }
      const hash = await bcrypt.hash(p, 10)
      const ins = await pool.query('INSERT INTO users (username,name,group_name,role,pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,role,group_name,constituency,faith,verified', [uname, uname, 'Harvest Central', 'member', hash])
      user = ins.rows[0]
      role = user.role
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(()=>{})
    } else {
      // Admin credentials are valid only for an account already carrying the admin role.
      // Never elevate an existing member/pastor during authentication.
      if (adminCredential && user.role !== 'admin') {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
        return reply.code(403).send({ error: 'admin credentials cannot elevate this account' })
      }

      if (user.role === 'admin') {
        if (!adminCredential) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
          return reply.code(401).send({ error: 'admin PIN incorrect' })
        }
        // Bootstrap an existing seeded/provisioned admin by storing the admin PIN hash.
        if (!user.pin_hash) {
          const hash = await bcrypt.hash(p, 10)
          await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1', [user.id, hash])
        }
        role = 'admin'
      } else {
        if (!memberPinOk) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
          return reply.code(401).send({ error: 'PIN required' })
        }
        if (!user.pin_hash) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
          return reply.code(403).send({ error: 'account PIN not enrolled — ask an administrator to provision this account' })
        }
        const ok = await bcrypt.compare(p, user.pin_hash).catch(()=>false)
        if (!ok) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
          return reply.code(401).send({ error: 'PIN incorrect' })
        }
        role = user.role
      }
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(()=>{})
    }
  } else {
    // Anonymous guest token. A PIN without a username is never treated as admin.
    user = { id: '00000000-0000-0000-0000-000000000000', username: 'guest', role: 'guest', group_name: null, constituency: null, faith: null, verified: false }
    if (p) {
      if (adminCredential) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, 'guest']).catch(()=>{})
        return reply.code(400).send({ error: 'username required for admin authentication' })
      }
      if (!memberPinOk) {
        await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, 'guest']).catch(()=>{})
        return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
      }
      role = 'member'
      user.role = role
      user.username = 'guest'
    }
  }

  clearLoginRateLimit(req)
  const expiresIn = role==='guest' ? '2h' : role==='member' ? '24h' : '7d'
  const token = jwt.sign({ id: user.id, username: user.username, role, group_name: user.group_name, constituency: user.constituency, faith: user.faith }, JWT_SECRET, { expiresIn })
  return reply.send({ token, role, username: user.username, expiresIn })
})

app.get('/health', async () => {
  const pg = await pool.query('SELECT 1').then(()=> 'ok').catch(e=> e.message)
  return { status: 'ok', pg, uptime: process.uptime(), bucket: process.env.MINIO_BUCKET||'harvest-media' }
})

await app.register(mediaRoutes)
await app.register(feedRoutes)
await app.register(pendingRoutes)
await app.register(chatRoutes)
await app.register(usersRoutes)

const port = parseInt(process.env.PORT||'3000',10)
await ensureBucket().catch(e=> console.warn('[s3] ensureBucket', e.message))
await app.listen({ port, host: '0.0.0.0' })
console.log(`[api] listening :${port}`)
await attachRealtime(app.server)
console.log(`[realtime] socket.io attached ws://0.0.0.0:${port}  (coturn 3478 separate)`)
