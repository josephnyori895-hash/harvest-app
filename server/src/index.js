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

// --- hardened auth hook (replaces inline silent catch at :20) ---
import { makeAuthenticate, isAdminPin, isValidMemberPin, loginRateLimit, clearLoginRateLimit, requireMember } from './middleware/auth.js'
const authenticate = makeAuthenticate({ jwtSecret: JWT_SECRET })
app.addHook('onRequest', authenticate)

// --- hardening: PIN kept (4-6 digits), no OTP, VPS-only, 500 users ---
// Admin PIN bcrypt kept via middleware/auth.js isAdminPin (ADMIN_PIN_HASHES JSON); pastor is DB role, not PIN
app.post('/api/auth/login', { preHandler: [loginRateLimit] }, async (req, reply) => {
  const { pin, username } = req.body||{}
  const p = String(pin||'').trim()
  const uname = String(username||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,32)
  // validate PIN shape kept: 4-6 digits or legacy 7C3AED for admin compat
  const admin = p ? await isAdminPin(p) : false
  const memberPinOk = p ? isValidMemberPin(p) || admin : false
  if (p && !memberPinOk && !admin) {
    await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname||'guest']).catch(()=>{})
    return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
  }
  // derive role: admin > pastor (DB) > member > guest. Pastor not via PIN — promoted in DB.
  let role = 'guest'
  if (admin) role = 'admin'
  else if (p) role = 'member'
  // lookup or create user
  let user = null
  if (uname) {
    const r = await pool.query('SELECT id, username, role, group_name, constituency, faith, verified, pin_hash FROM users WHERE username=$1', [uname])
    user = r.rows[0] || null
    if (!user) {
      // new member: store bcrypt hash of PIN (cost 10 — VPS 1 vCPU keeps 15ms, not 200ms at 12)
      const hash = p ? await bcrypt.hash(p, 10) : null
      // new users default member; admin pin promotes to admin; pastor must be set manually in DB
      const initRole = admin ? 'admin' : role
      const ins = await pool.query('INSERT INTO users (username,name,group_name,role,pin_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,role,group_name,constituency,faith,verified', [uname, uname, 'Harvest Central', initRole, hash])
      user = ins.rows[0]
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(()=>{})
    } else {
      // existing: verify pin_hash if present (bcrypt), else upgrade
      if (p && user.pin_hash) {
        const ok = await bcrypt.compare(p, user.pin_hash).catch(()=>false)
        if (!ok && !admin) {
          await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,false)`, [req.ip, uname]).catch(()=>{})
          return reply.code(401).send({ error: 'PIN incorrect' })
        }
        // rehash if needed (e.g., cost upgrade) — keep 10 for VPS
      } else if (p && !user.pin_hash) {
        const hash = await bcrypt.hash(p, 10)
        await pool.query('UPDATE users SET pin_hash=$2 WHERE id=$1', [user.id, hash])
      }
      // role promotion: admin pin elevates to admin; never demote pastor/admin via login
      if (admin && user.role!=='admin') {
        await pool.query('UPDATE users SET role=$2 WHERE id=$1', [user.id, 'admin']); user.role='admin'
      }
      // if DB says pastor, keep pastor even if pin is member — pastor is DB-promoted
      if (user.role==='pastor' && admin) { /* admin pin overrides pastor to admin intentionally */ }
      else if (user.role==='pastor') role = 'pastor'
      else role = user.role
      await pool.query(`INSERT INTO login_attempts (ip, username, success) VALUES ($1,$2,true)`, [req.ip, uname]).catch(()=>{})
    }
  } else {
    // guest: no username -> ephemeral JWT (no DB row), role guest
    user = { id: '00000000-0000-0000-0000-000000000000', username: 'guest', role: 'guest', group_name: null, constituency: null, faith: null, verified: false }
    if (p) {
      // guest with PIN but no username: treat as member guest token (no DB)
      role = admin ? 'admin' : 'member'
      user.role = role
      user.username = 'guest'
    }
  }
  clearLoginRateLimit(req)
  // JWT: 24h for member, 7d for pastor/admin, 2h for guest — pastor/member no OTP, short enough for church 500 users
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
// Attach socket.io realtime on same VPS process (KES 1k — no extra infra)
await attachRealtime(app.server)
console.log(`[realtime] socket.io attached ws://0.0.0.0:${port}  (coturn 3478 separate)`)
