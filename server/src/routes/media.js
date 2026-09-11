import { presignedPost, presignedGetOrNull, minio, mediaStore, BUCKET, validatePresign } from '../s3.js'
import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'

export default async function mediaRoutes(app) {
  app.post('/api/media/presign', { preHandler: [requireMember] }, async (req, reply) => {
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'content-type must be application/json' })
    const { type, contentType, bytes, ext } = req.body || {}
    if (!type || !contentType) return reply.code(400).send({ error: 'type and contentType required' })
    try {
      const uid = req.user.id
      const now = Date.now()
      const bucket = globalThis.__presignBuckets || (globalThis.__presignBuckets = new Map())
      const rec = bucket.get(uid) || { count: 0, resetAt: now + 60 * 1000 }
      if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60 * 1000 }
      if (rec.count >= 10) return reply.code(429).send({ error: 'presign rate limit 10/min', retryAfter: Math.ceil((rec.resetAt - now) / 1000) })
      rec.count++
      bucket.set(uid, rec)
      return reply.send(await presignedPost({ type, contentType, bytes: Number(bytes) || 0, ext }))
    } catch (e) {
      return reply.code(e.statusCode || 400).send({ error: e.message })
    }
  })

  // Netlify Functions have a request-size ceiling, so this native-only path is
  // deliberately capped at 5 MB. Larger media needs client-side compression or
  // a future Netlify-supported direct-upload mechanism.
  app.post('/api/media/upload', { preHandler: [requireMember] }, async (req, reply) => {
    try {
      const parts = req.parts()
      let filePart = null
      let key = ''
      let expectedContentType = ''
      for await (const part of parts) {
        if (part.type === 'file') {
          if (filePart) return reply.code(400).send({ error: 'only one file is allowed' })
          filePart = part
        } else if (part.fieldname === 'key') key = String(part.value || '')
        else if (part.fieldname === 'contentType') expectedContentType = String(part.value || '')
      }
      if (!filePart || !key) return reply.code(400).send({ error: 'key and file are required' })
      if (!key.startsWith('originals/')) return reply.code(400).send({ error: 'invalid media key' })
      const type = key.split('/')[1]
      validatePresign({ type, contentType: filePart.mimetype, bytes: Number(filePart.file.bytesRead || 0) })
      if (expectedContentType && expectedContentType !== filePart.mimetype) return reply.code(400).send({ error: 'content type mismatch' })
      const data = await filePart.toBuffer()
      await mediaStore.set(key, data, { metadata: { contentType: filePart.mimetype, ownerId: String(req.user.id), uploadedAt: new Date().toISOString() } })
      return reply.code(201).send({ ok: true, key })
    } catch (e) {
      return reply.code(e.statusCode || 400).send({ error: e.message || 'media upload failed' })
    }
  })

  app.post('/api/media/confirm', { preHandler: [requireMember] }, async (req, reply) => {
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'content-type must be application/json' })
    const { key, type, caption, title, artist } = req.body || {}
    if (!key || !type) return reply.code(400).send({ error: 'key and type required' })
    if (!key.startsWith(`originals/${type}/`)) return reply.code(400).send({ error: `key must start with originals/${type}/` })
    try { await minio.statObject(BUCKET, key) } catch { return reply.code(404).send({ error: 'original not found — upload to Netlify Blobs first' }) }
    const userId = req.user.id
    const u = await query('SELECT group_name, constituency, faith, verified FROM users WHERE id=$1', [userId])
    const snap = u.rows[0] || {}
    const isAdmin = req.user.role === 'admin'

    if (type === 'story') {
      const { v4: uuid } = await import('uuid')
      const id = uuid()
      await query(`INSERT INTO stories (id,user_id,original_key,expires_at) VALUES ($1,$2,$3,now()+interval '24 hours')`, [id, userId, key])
      await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'direct_publish','story',$2,$3)`, [userId, id, JSON.stringify({ key, caption })])
      return reply.code(201).send({ id, status: 'published', key })
    }

    if (isAdmin) {
      const { v4: uuid } = await import('uuid')
      const id = uuid()
      if (type === 'post') {
        await query(`INSERT INTO posts (id,user_id,caption,original_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, userId, caption || '', key, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (type === 'reel') {
        await query(`INSERT INTO reels (id,user_id,caption,hls_master_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, userId, caption || '', key, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (type === 'track') {
        await query(`INSERT INTO tracks (id,user_id,title,artist,original_key,preview_key) VALUES ($1,$2,$3,$4,$5,$5)`, [id, userId, title || caption || 'Untitled', artist || '', key])
      } else return reply.code(400).send({ error: 'unsupported media type' })
      await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'direct_publish',$2,$3,$4)`, [userId, type, id, JSON.stringify({ key, caption })])
      return reply.code(201).send({ id, status: 'approved', key })
    }

    const { rows } = await query(`INSERT INTO pending_queue (type,user_id,caption,original_key,status) VALUES ($1,$2,$3,$4,'pending') RETURNING id,created_at`, [type, userId, caption || '', key])
    return reply.code(202).send({ id: rows[0].id, status: 'pending', at: rows[0].created_at })
  })

  app.get('/api/media/*', { preHandler: [requireMember] }, async (req, reply) => {
    const key = req.params['*']
    if (!key) return reply.code(400).send({ error: 'key required' })
    const entry = await mediaStore.getWithMetadata(key, { type: 'arrayBuffer' })
    if (!entry?.data) return reply.code(404).send({ error: 'not found' })
    return reply
      .header('Content-Type', entry.metadata?.contentType || 'application/octet-stream')
      .header('Cache-Control', 'private, max-age=300')
      .send(Buffer.from(entry.data))
  })
}
