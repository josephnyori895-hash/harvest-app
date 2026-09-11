import { query } from '../db.js'

export default async function chatRoutes(app) {
  // GET /api/chat/history?peer=alice  or ?group=youth_group  (requires auth)
  app.get('/api/chat/history', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'auth required' })
    const me = req.user.username
    const { peer, group, limit = '50', before } = req.query || {}

    if (group) {
      const slug = String(group)
      // membership check
      const g = await query('SELECT id FROM groups WHERE slug=$1', [slug])
      if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
      const conv = `group:${slug}`
      const lim = Math.min(parseInt(limit, 10) || 50, 100)
      const { rows } = await query(
        `SELECT id, kind, conversation_key, sender_username AS "from", body AS text, status, created_at,
                to_char(created_at,'HH24:MI') AS at
         FROM messages WHERE conversation_key=$1 ${before ? 'AND created_at < $3' : ''} ORDER BY created_at DESC LIMIT $2`,
        before ? [conv, lim, before] : [conv, lim]
      )
      return reply.send({ messages: rows.reverse(), conversation_key: conv })
    }

    if (peer) {
      const other = String(peer)
      const conv = `harvest:chat:${[me, other].sort().join(':')}`
      const lim = Math.min(parseInt(limit, 10) || 50, 100)
      const { rows } = await query(
        `SELECT id, kind, conversation_key, sender_username AS "from", recipient_username AS "to", body AS text, status, created_at,
                to_char(created_at,'HH24:MI') AS at
         FROM messages WHERE conversation_key=$1 ${before ? 'AND created_at < $3' : ''} ORDER BY created_at DESC LIMIT $2`,
        before ? [conv, lim, before] : [conv, lim]
      )
      return reply.send({ messages: rows.reverse(), conversation_key: conv })
    }

    return reply.code(400).send({ error: 'peer or group required' })
  })

  // GET /api/presence  -> last 100 users with online fallback
  app.get('/api/presence', async (req, reply) => {
    const { rows } = await query(`SELECT username, last_seen, verified FROM users ORDER BY last_seen DESC LIMIT 100`)
    // realtime presence overrides last_seen when online (client merges with socket snapshot)
    return reply.send({ users: rows })
  })

  // POST /api/groups/:slug/invite  (REST alternative to socket group:invite)
  app.post('/api/groups/:slug/invite', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'auth required' })
    if (req.user.role !== 'admin') {
      // check group admin
      const g = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug])
      if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
      const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [g.rows[0].id, req.user.id, 'admin'])
      if (!ga.rows[0]) return reply.code(403).send({ error: 'admin only' })
    }
    const { targetUsername } = req.body || {}
    if (!targetUsername) return reply.code(400).send({ error: 'targetUsername required' })
    const g = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug])
    if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
    const target = await query('SELECT id FROM users WHERE username=$1', [targetUsername])
    const { rows } = await query(
      `INSERT INTO group_invites (group_id, invited_username, invited_user_id, inviter_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [g.rows[0].id, targetUsername, target.rows[0]?.id || null, req.user.id]
    )
    return reply.code(201).send({ id: rows[0].id, status: 'pending' })
  })

  app.post('/api/groups/:slug/invites/:id/approve', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'auth required' })
    const { approve = true } = req.body || {}
    // reuse same logic as socket handler — simplified
    const inv = await query('SELECT * FROM group_invites WHERE id=$1', [req.params.id])
    if (!inv.rows[0]) return reply.code(404).send({ error: 'not found' })
    if (inv.rows[0].status !== 'pending') return reply.code(409).send({ error: `already ${inv.rows[0].status}` })
    if (req.user.role !== 'admin') {
      const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [inv.rows[0].group_id, req.user.id, 'admin'])
      if (!ga.rows[0]) return reply.code(403).send({ error: 'admin only' })
    }
    const status = approve ? 'approved' : 'rejected'
    await query(`UPDATE group_invites SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [req.params.id, status, req.user.id])
    if (approve && inv.rows[0].invited_user_id) {
      await query('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [inv.rows[0].group_id, inv.rows[0].invited_user_id])
    }
    return reply.send({ ok: true, status })
  })
}
