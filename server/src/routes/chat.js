import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'

export default async function chatRoutes(app) {
  app.get('/api/chat/history', { preHandler: [requireMember] }, async (req, reply) => {
    const me = req.user.username
    const { peer, group, limit = '50', before } = req.query || {}
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)

    if (group) {
      const slug = String(group).trim()
      const g = await query('SELECT id FROM groups WHERE slug=$1', [slug])
      if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
      const membership = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, req.user.id])
      if (!membership.rows[0] && req.user.role !== 'admin') return reply.code(403).send({ error: 'group membership required' })
      const conv = `group:${slug}`
      const { rows } = await query(
        `SELECT id, kind, conversation_key, sender_username AS "from", body AS text, status, created_at,
                to_char(created_at,'HH24:MI') AS at
         FROM messages WHERE conversation_key=$1 ${before ? 'AND created_at < $3' : ''} ORDER BY created_at DESC LIMIT $2`,
        before ? [conv, lim, before] : [conv, lim]
      )
      return reply.send({ messages: rows.reverse(), conversation_key: conv })
    }

    if (peer) {
      const other = String(peer).trim()
      if (!other || other === me) return reply.code(400).send({ error: 'invalid peer' })
      const target = await query('SELECT id, username FROM users WHERE username=$1', [other])
      if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
      const conv = `harvest:chat:${[me, target.rows[0].username].sort().join(':')}`
      const { rows } = await query(
        `SELECT id, kind, conversation_key, sender_username AS "from", recipient_username AS "to", body AS text, status, created_at,
                to_char(created_at,'HH24:MI') AS at
         FROM messages
         WHERE conversation_key=$1
           AND (sender_id=$2 OR recipient_id=$2)
           ${before ? 'AND created_at < $4' : ''}
         ORDER BY created_at DESC LIMIT $3`,
        before ? [conv, req.user.id, lim, before] : [conv, req.user.id, lim]
      )
      return reply.send({ messages: rows.reverse(), conversation_key: conv })
    }

    return reply.code(400).send({ error: 'peer or group required' })
  })

  app.get('/api/presence', { preHandler: [requireMember] }, async (req, reply) => {
    const { rows } = await query(`SELECT username, last_seen, verified FROM users ORDER BY last_seen DESC LIMIT 100`)
    return reply.send({ users: rows })
  })

  app.post('/api/groups/:slug/invite', { preHandler: [requireMember] }, async (req, reply) => {
    const g = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug])
    if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
    const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [g.rows[0].id, req.user.id, 'admin'])
    if (req.user.role !== 'admin' && !ga.rows[0]) return reply.code(403).send({ error: 'group admin required' })
    const { targetUsername } = req.body || {}
    if (!targetUsername) return reply.code(400).send({ error: 'targetUsername required' })
    const target = await query('SELECT id, username FROM users WHERE username=$1', [String(targetUsername).trim()])
    if (!target.rows[0]) return reply.code(404).send({ error: 'target user not found' })
    const { rows } = await query(
      `INSERT INTO group_invites (group_id, invited_username, invited_user_id, inviter_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [g.rows[0].id, target.rows[0].username, target.rows[0].id, req.user.id]
    )
    return reply.code(201).send({ id: rows[0].id, status: 'pending' })
  })

  app.post('/api/groups/:slug/invites/:id/approve', { preHandler: [requireMember] }, async (req, reply) => {
    const { approve = true } = req.body || {}
    const inv = await query('SELECT * FROM group_invites WHERE id=$1', [req.params.id])
    if (!inv.rows[0]) return reply.code(404).send({ error: 'not found' })
    if (inv.rows[0].status !== 'pending') return reply.code(409).send({ error: `already ${inv.rows[0].status}` })
    const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [inv.rows[0].group_id, req.user.id, 'admin'])
    if (req.user.role !== 'admin' && !ga.rows[0]) return reply.code(403).send({ error: 'group admin required' })
    const status = approve ? 'approved' : 'rejected'
    await query(`UPDATE group_invites SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [req.params.id, status, req.user.id])
    if (approve && inv.rows[0].invited_user_id) {
      await query('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [inv.rows[0].group_id, inv.rows[0].invited_user_id])
    }
    return reply.send({ ok: true, status })
  })
}
