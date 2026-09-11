import { presignedPost, presignedGetOrNull, minio, BUCKET } from '../s3.js'
import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'

export default async function mediaRoutes(app) {
  app.post('/api/media/presign', { preHandler: [requireMember] }, async (req, reply) => {
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'content-type must be application/json' })
    const { type, contentType, bytes, ext } = req.body || {}
    if (!type || !contentType) return reply.code(400).send({ error: 'type and contentType required' })
    const uid = req.user.id
    const now = Date.now()
    const bucket = globalThis.__presignBuckets || (globalThis.__presignBuckets = new Map())
    const rec = bucket.get(uid) || { count: 0, resetAt: now + 60*1000 }
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60*1000 }
    if (rec.count >= 10) return reply.code(429).send({ error: 'presign rate limit 10/min — Sunday burst queued', retryAfter: Math.ceil((rec.resetAt - now)/1000) })
    rec.count++; bucket.set(uid, rec)
    try { return reply.send(await presignedPost({ type, contentType, bytes: Number(bytes)||0, ext })) }
    catch (e) { return reply.code(e.statusCode||400).send({ error: e.message }) }
  })

  app.post('/api/media/confirm', { preHandler: [requireMember] }, async (req, reply) => {
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'content-type must be application/json' })
    const { key, type, caption, title, artist } = req.body || {}
    if (!key || !type) return reply.code(400).send({ error: 'key and type required' })
    if (!key.startsWith(`originals/${type}/`)) return reply.code(400).send({ error: `key must start with originals/${type}/` })
    try { await minio.statObject(BUCKET, key) } catch { return reply.code(404).send({ error: 'original not found — upload to presigned URL first' }) }
    const isAdmin = req.user.role === 'admin'
    const userId = req.user.id
    const u = await query('SELECT group_name, constituency, faith, verified FROM users WHERE id=$1', [userId])
    const snap = u.rows[0] || {}
    if (isAdmin) {
      const id = (await import('uuid')).v4().replace(/-/g,'').slice(0,32)
      if (type==='post') {
        await query(`INSERT INTO posts (id,user_id,caption,original_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id,userId,caption||'',key,snap.verified,snap.group_name,snap.constituency,snap.faith])
        await query(`INSERT INTO pending_queue (id,type,user_id,caption,original_key,status) VALUES ($1,'post',$2,$3,$4,'transcoding')`, [id,userId,caption||'',key])
      } else if (type==='story') {
        await query(`INSERT INTO stories (id,user_id,original_key,expires_at) VALUES ($1,$2,$3,now()+interval '24 hours')`, [id,userId,key])
      } else if (type==='reel') {
        await query(`INSERT INTO reels (id,user_id,caption,hls_master_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id,userId,caption||'',key,snap.verified,snap.group_name,snap.constituency,snap.faith])
        await query(`INSERT INTO pending_queue (id,type,user_id,caption,original_key,status) VALUES ($1,'reel',$2,$3,$4,'transcoding')`, [id,userId,caption||'',key])
      } else if (type==='track') {
        await query(`INSERT INTO tracks (id,user_id,title,artist,original_key) VALUES ($1,$2,$3,$4,$5)`, [id,userId,title||caption||'Untitled',artist||'',key])
      } else return reply.code(400).send({ error: 'unsupported media type' })
      await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'direct_approve',$2,$3,$4)`, [userId,type,id,JSON.stringify({ key, caption })])
      return reply.code(201).send({ id,status:'approved',key })
    }
    const { rows } = await query(`INSERT INTO pending_queue (type,user_id,caption,original_key,status) VALUES ($1,$2,$3,$4,'pending') RETURNING id, created_at`, [type,userId,caption||'',key])
    return reply.code(202).send({ id:rows[0].id,status:'pending',at:rows[0].created_at })
  })

  app.get('/api/media/*', { preHandler: [requireMember] }, async (req, reply) => {
    const key = req.params['*']
    if (!key) return reply.code(400).send({ error: 'key required' })
    const url = await presignedGetOrNull(key, 900)
    if (!url) return reply.code(404).send({ error: 'not found' })
    return reply.redirect(url)
  })
}
