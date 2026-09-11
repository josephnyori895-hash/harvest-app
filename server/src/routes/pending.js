import { query } from '../db.js'
import { presignedGetOrNull } from '../s3.js'
import { requireAdmin, requireMember } from '../middleware/auth.js'

export default async function pendingRoutes(app) {
  // GET /api/pending (admin) — replaces localStorage harvest_pending at src/App.jsx:79 / Admin.tsx:4
  // Member view: GET /api/pending/mine returns own pending (for status)
  app.get('/api/pending/mine', { preHandler: [requireMember] }, async (req, reply) => {
    const { rows } = await query(`SELECT q.*, u.username FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.user_id=$1 ORDER BY q.created_at DESC LIMIT 50`, [req.user.id])
    const out = await Promise.all(rows.map(async r=> ({ ...r, thumb_url: await presignedGetOrNull(r.thumb_key||r.original_key, 600) })))
    return reply.send({ pending: out })
  })
  app.get('/api/pending', { preHandler: [requireAdmin] }, async (req, reply) => {
    const status = req.query.status || 'pending'
    const { rows } = await query(`SELECT q.*, u.username, u.name FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.status=$1 ORDER BY q.created_at DESC LIMIT 100`, [status])
    const out = await Promise.all(rows.map(async r=> ({ ...r, thumb_url: await presignedGetOrNull(r.thumb_key||r.original_key, 600) })))
    return reply.send({ pending: out })
  })

  // POST /api/pending/:id/approve — hardened RBAC (Admin 188) + verify snapshot fix 138 vs 564
  app.post('/api/pending/:id/approve', { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = req.params.id
    const { rows } = await query('SELECT * FROM pending_queue WHERE id=$1', [id])
    const item = rows[0]
    if (!item) return reply.code(404).send({ error: 'not found' })
    if (item.status !== 'pending' && item.status!=='transcoding') return reply.code(409).send({ error: `already ${item.status}` })
    // verified snapshot fix 138 vs 564: read live user verified
    const u = await query('SELECT verified, group_name, constituency, faith FROM users WHERE id=$1', [item.user_id])
    const snap = u.rows[0]||{}

    // transaction: move to target table
    const client = await (await import('../db.js')).pool.connect()
    try {
      await client.query('BEGIN')
      if (item.type==='post') {
        await client.query(`INSERT INTO posts (id,user_id,caption,original_key,thumb_key,blurhash,width,height,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
          [item.id, item.user_id, item.caption, item.original_key, item.thumb_key, item.blurhash, item.width, item.height, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (item.type==='story') {
        await client.query(`INSERT INTO stories (id,user_id,original_key,thumb_key,blurhash,expires_at) VALUES ($1,$2,$3,$4,$5, now()+interval '24 hours')`, [item.id, item.user_id, item.original_key, item.thumb_key, item.blurhash])
      } else if (item.type==='reel') {
        await client.query(`INSERT INTO reels (id,user_id,caption,hls_master_key,poster_key,thumb_key,verified_snapshot,group_name,constituency,faith,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
          [item.id, item.user_id, item.caption, item.hls_master_key, item.poster_key, item.thumb_key, snap.verified, snap.group_name, snap.constituency, snap.faith])
      } else if (item.type==='track') {
        await client.query(`INSERT INTO tracks (id,user_id,title,artist,original_key,preview_key) VALUES ($1,$2,$3,$4,$5,$5)`, [item.id, item.user_id, item.caption||'Untitled', '', item.original_key])
      }
      await client.query('DELETE FROM pending_queue WHERE id=$1', [id])
      await client.query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'approve',$2,$3,$4)`, [req.user.id, item.type, item.id, JSON.stringify({ caption: item.caption })])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK'); throw e
    } finally { client.release() }
    return reply.send({ ok: true, id })
  })

  app.post('/api/pending/:id/reject', { preHandler: [requireAdmin] }, async (req, reply) => {
    const id = req.params.id
    const { reason } = req.body||{}
    const { rowCount } = await query(`UPDATE pending_queue SET status='rejected', reviewed_by=$2, reviewed_at=now(), reject_reason=$3 WHERE id=$1 AND status='pending'`, [id, req.user.id, reason||null])
    if (!rowCount) return reply.code(404).send({ error: 'not found or not pending' })
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'reject','pending',$2,$3)`, [req.user.id, id, JSON.stringify({ reason })])
    // optionally keep rejected 7d then GC, or delete immediately
    return reply.send({ ok: true })
  })

  // POST /api/admin/verify/:username {verified} — split-brain fix 138 vs 564:
  // WTO: feed returns COALESCE(users.verified, posts.verified_snapshot) so toggling here reflects live without re-approve.
  // Audit log keeps actor_role for forensics (003_hardening.sql adds column).
  app.post('/api/admin/verify/:username', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { verified } = req.body||{}
    await query('UPDATE users SET verified=$2 WHERE username=$1', [req.params.username, !!verified])
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'verify_toggle','user',$2,$3)`, [req.user.id, req.params.username, JSON.stringify({ verified: !!verified })])
    return reply.send({ ok: true })
  })
}
