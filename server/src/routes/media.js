import { presignedPost, minio, mediaStore, BUCKET, validatePresign } from '../s3.js'
import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'
import { v4 as uuid } from 'uuid'

const KEY_RE = /^originals\/(post|story|reel|track)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

export default async function mediaRoutes(app) {
  app.post('/api/media/presign', { preHandler: [requireMember] }, async (req, reply) => {
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) return reply.code(415).send({ error: 'content-type must be application/json' })
    const { type, contentType, bytes, ext } = req.body || {}
    if (!type || !contentType) return reply.code(400).send({ error: 'type and contentType required' })
    try {
      const uid = req.user.id
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM media_upload_attempts WHERE user_id=$1 AND created_at > now() - interval '1 minute'`,
        [uid],
      )
      const count = Number(rows[0]?.count || 0)
      if (count >= 10) return reply.code(429).send({ error: 'presign rate limit 10/min', retryAfter: 60 })
      await query('INSERT INTO media_upload_attempts (user_id) VALUES ($1)', [uid])
      return reply.send(await presignedPost({ type, contentType, bytes: Number(bytes) || 0, ext }))
    } catch (e) {
      return reply.code(e.statusCode || 400).send({ error: e.message })
    }
  })

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
      if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'invalid media key' })
      const data = await filePart.toBuffer()
      const type = key.split('/')[1]
      validatePresign({ type, contentType: filePart.mimetype, bytes: data.length })
      if (expectedContentType && expectedContentType !== filePart.mimetype) return reply.code(400).send({ error: 'content type mismatch' })
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
    if (!KEY_RE.test(key) || !key.startsWith(`originals/${type}/`)) return reply.code(400).send({ error: 'invalid media key' })
    try {
      const entry = await mediaStore.getWithMetadata(key)
      if (!entry) return reply.code(404).send({ error: 'original not found — upload to Netlify Blobs first' })
      const ownerId = String(entry.metadata?.ownerId || '')
      if (ownerId !== String(req.user.id) && req.user.role !== 'admin') {
        return reply.code(403).send({ error: 'media does not belong to this account' })
      }
    } catch {
      return reply.code(404).send({ error: 'original not found — upload to Netlify Blobs first' })
    }

    const userId = req.user.id
    const u = await query('SELECT group_name, constituency, faith, verified FROM users WHERE id=$1', [userId])
    const snap = u.rows[0] || {}
    const isAdmin = req.user.role === 'admin'

    if (type === 'story') {
      const id = uuid()
      await query(`INSERT INTO stories (id,user_id,original_key,expires_at) VALUES ($1,$2,$3,now()+interval '24 hours')`, [id, userId, key])
      await query(`INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES ($1,$2,'direct_publish','story',$3,$4)`, [userId, req.user.role, id, JSON.stringify({ key, caption })])
      return reply.code(201).send({ id, status: 'published', key })
    }

    if (isAdmin) {
      const id = uuid()
      if (type === 'post') {
        await query(`INSERT INTO posts (id,user_id,caption,original_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, userId, caption || '', key, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (type === 'reel') {
        await query(`INSERT INTO reels (id,user_id,caption,hls_master_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [id, userId, caption || '', key, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (type === 'track') {
        await query(`INSERT INTO tracks (id,user_id,title,artist,original_key,preview_key) VALUES ($1,$2,$3,$4,$5,$5)`, [id, userId, title || caption || 'Untitled', artist || '', key])
      } else return reply.code(400).send({ error: 'unsupported media type' })
      await query(`INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES ($1,$2,'direct_publish',$3,$4,$5)`, [userId, req.user.role, type, id, JSON.stringify({ key, caption })])
      return reply.code(201).send({ id, status: 'approved', key })
    }

    const { rows } = await query(`INSERT INTO pending_queue (type,user_id,caption,original_key,status) VALUES ($1,$2,$3,$4,'pending') RETURNING id,created_at`, [type, userId, caption || '', key])
    return reply.code(202).send({ id: rows[0].id, status: 'pending', at: rows[0].created_at })
  })

  app.get('/api/media/*', { preHandler: [requireMember] }, async (req, reply) => {
    const key = req.params['*']
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'invalid media key' })
    const entry = await mediaStore.getWithMetadata(key, { type: 'arrayBuffer' })
    if (!entry?.data) return reply.code(404).send({ error: 'not found' })
    return reply
      .header('Content-Type', entry.metadata?.contentType || 'application/octet-stream')
      .header('Cache-Control', 'private, max-age=300')
      .send(Buffer.from(entry.data))
  })
}
