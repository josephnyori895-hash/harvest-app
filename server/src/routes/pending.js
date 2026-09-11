import { query, pool } from '../db.js'
import { presignedGetOrNull, removeObjectOrIgnore } from '../s3.js'
import { requireAdmin, requireMember } from '../middleware/auth.js'

const STALE_PENDING_MS = 24 * 60 * 60 * 1000
const REJECTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function mediaKeys(item) {
  return [item.original_key, item.thumb_key, item.hls_master_key, item.poster_key].filter(Boolean)
}

export async function cleanupOrphanedUploads() {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS)
  const rejectedCutoff = new Date(Date.now() - REJECTED_RETENTION_MS)
  const { rows } = await query(`
    SELECT id, type, status, original_key, thumb_key, hls_master_key, poster_key
    FROM pending_queue
    WHERE (status IN ('pending','transcoding') AND created_at < $1)
       OR (status='rejected' AND reviewed_at < $2)
    ORDER BY created_at ASC
    LIMIT 200
  `, [cutoff, rejectedCutoff])
  let removed = 0
  for (const item of rows) {
    for (const key of mediaKeys(item)) if (await removeObjectOrIgnore(key)) removed++
    await query(`DELETE FROM pending_queue WHERE id=$1`, [item.id])
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES (NULL,'cleanup','pending',$1,$2)`, [item.id, JSON.stringify({ type: item.type, status: item.status })])
  }
  return { rows: rows.length, objects: removed }
}

export default async function pendingRoutes(app) {
  app.get('/api/pending/mine', { preHandler: [requireMember] }, async (req, reply) => {
    const { rows } = await query(`SELECT q.*, u.username FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.user_id=$1 ORDER BY q.created_at DESC LIMIT 50`, [req.user.id])
    const out = await Promise.all(rows.map(async r => ({ ...r, thumb_url: await presignedGetOrNull(r.thumb_key||r.original_key, 600) })))
    return reply.send({ pending: out })
  })

  app.get('/api/pending', { preHandler: [requireAdmin] }, async (req, reply) => {
    const status = ['pending','rejected','transcoding'].includes(req.query.status) ? req.query.status : 'pending'
    const { rows } = await query(`SELECT q.*, u.username, u.name FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.status=$1 ORDER BY q.created_at DESC LIMIT 100`, [status])
    const out = await Promise.all(rows.map(async r => ({ ...r, thumb_url: await presignedGetOrNull(r.thumb_key||r.original_key, 600) })))
    return reply.send({ pending: out })
  })

  app.post('/api/pending/:id/approve', { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = req.params.id
    const { rows } = await query('SELECT * FROM pending_queue WHERE id=$1 FOR UPDATE', [id])
    const item = rows[0]
    if (!item) return reply.code(404).send({ error: 'not found' })
    if (item.status !== 'pending' && item.status !== 'transcoding') return reply.code(409).send({ error: `already ${item.status}` })
    const u = await query('SELECT verified, group_name, constituency, faith FROM users WHERE id=$1', [item.user_id])
    const snap = u.rows[0] || {}
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (item.type === 'post') {
        await client.query(`INSERT INTO posts (id,user_id,caption,original_key,thumb_key,blurhash,width,height,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`, [item.id,item.user_id,item.caption,item.original_key,item.thumb_key,item.blurhash,item.width,item.height,snap.verified,snap.group_name,snap.constituency,snap.faith])
      } else if (item.type === 'story') {
        await client.query(`INSERT INTO stories (id,user_id,original_key,thumb_key,blurhash,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '24 hours')`, [item.id,item.user_id,item.original_key,item.thumb_key,item.blurhash])
      } else if (item.type === 'reel') {
        await client.query(`INSERT INTO reels (id,user_id,caption,hls_master_key,poster_key,thumb_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [item.id,item.user_id,item.caption,item.hls_master_key||item.original_key,item.poster_key,item.thumb_key,snap.verified,snap.group_name,snap.constituency,snap.faith])
      } else if (item.type === 'track') {
        await client.query(`INSERT INTO tracks (id,user_id,title,artist,original_key,preview_key) VALUES ($1,$2,$3,$4,$5,$5)`, [item.id,item.user_id,item.caption||'Untitled','',item.original_key])
      }
      await client.query('DELETE FROM pending_queue WHERE id=$1', [id])
      await client.query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'approve',$2,$3,$4)`, [req.user.id,item.type,item.id,JSON.stringify({ caption:item.caption })])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally { client.release() }
    return reply.send({ ok:true, id, status:'approved' })
  })

  app.post('/api/pending/:id/reject', { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = req.params.id
    const { reason } = req.body || {}
    const { rows } = await query(`UPDATE pending_queue SET status='rejected', reviewed_by=$2, reviewed_at=now(), reject_reason=$3 WHERE id=$1 AND status='pending' RETURNING *`, [id,req.user.id,reason||null])
    if (!rows[0]) return reply.code(404).send({ error:'not found or not pending' })
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'reject','pending',$2,$3)`, [req.user.id,id,JSON.stringify({ reason })])
    return reply.send({ ok:true, id, status:'rejected' })
  })

  app.post('/api/pending/cleanup', { preHandler: [requireAdmin] }, async (_req, reply) => {
    return reply.send(await cleanupOrphanedUploads())
  })

  app.post('/api/admin/verify/:username', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { verified } = req.body || {}
    await query('UPDATE users SET verified=$2 WHERE username=$1', [req.params.username,!!verified])
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'verify_toggle','user',$2,$3)`, [req.user.id,req.params.username,JSON.stringify({ verified:!!verified })])
    return reply.send({ ok:true })
  })
}
