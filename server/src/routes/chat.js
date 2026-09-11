import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'

const MAX_MESSAGE_LENGTH = 4000

function cleanText(value) {
  return String(value ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
}

function cleanUsername(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
}

async function getConversation(me, peer, group) {
  if (group) {
    const slug = String(group).trim().slice(0, 80)
    const g = await query('SELECT id, slug FROM groups WHERE slug=$1', [slug])
    if (!g.rows[0]) return { error: 'group not found', code: 404 }
    const membership = await query(
      'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',
      [g.rows[0].id, me.id],
    )
    if (!membership.rows[0] && me.role !== 'admin') return { error: 'group membership required', code: 403 }
    return { kind: 'group', key: `group:${g.rows[0].slug}`, groupId: g.rows[0].id, groupSlug: g.rows[0].slug }
  }

  const other = cleanUsername(peer)
  if (!other || other === me.username) return { error: 'invalid peer', code: 400 }
  const target = await query('SELECT id, username FROM users WHERE username=$1', [other])
  if (!target.rows[0]) return { error: 'user not found', code: 404 }
  return {
    kind: 'dm',
    key: `harvest:chat:${[me.username, target.rows[0].username].sort().join(':')}`,
    recipientId: target.rows[0].id,
    recipientUsername: target.rows[0].username,
  }
}

function messageSelect() {
  return `SELECT id, kind, conversation_key, sender_username AS "from", recipient_username AS "to",
                 body AS text, status, created_at, to_char(created_at,'HH24:MI') AS at
          FROM messages`
}

export default async function chatRoutes(app) {
  // Netlify Functions are request/response based, so realtime chat uses short polling
  // instead of a persistent Socket.IO/WebSocket server.
  app.get('/api/chat/history', { preHandler: [requireMember] }, async (req, reply) => {
    const { peer, group, limit = '50', before } = req.query || {}
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
    const conv = await getConversation(req.user, peer, group)
    if (conv.error) return reply.code(conv.code).send({ error: conv.error })

    const beforeDate = before ? new Date(String(before)) : null
    if (before && Number.isNaN(beforeDate.getTime())) return reply.code(400).send({ error: 'invalid before timestamp' })
    const sql = `${messageSelect()} WHERE conversation_key=$1 ${before ? 'AND created_at < $3' : ''} ORDER BY created_at DESC LIMIT $2`
    const params = before ? [conv.key, lim, beforeDate.toISOString()] : [conv.key, lim]
    const { rows } = await query(sql, params)
    return reply.send({ messages: rows.reverse(), conversation_key: conv.key })
  })

  // Incremental polling endpoint: send the last message timestamp as `after`.
  app.get('/api/chat/updates', { preHandler: [requireMember] }, async (req, reply) => {
    const { peer, group, after, limit = '50' } = req.query || {}
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
    const afterDate = new Date(String(after || ''))
    if (!after || Number.isNaN(afterDate.getTime())) return reply.code(400).send({ error: 'valid after timestamp required' })

    const conv = await getConversation(req.user, peer, group)
    if (conv.error) return reply.code(conv.code).send({ error: conv.error })
    const { rows } = await query(
      `${messageSelect()} WHERE conversation_key=$1 AND created_at > $2 ORDER BY created_at ASC LIMIT $3`,
      [conv.key, afterDate.toISOString(), lim],
    )
    return reply.send({ messages: rows, conversation_key: conv.key, server_time: new Date().toISOString() })
  })

  app.post('/api/chat/messages', { preHandler: [requireMember] }, async (req, reply) => {
    const { peer, group, body } = req.body || {}
    const text = cleanText(body)
    if (!text) return reply.code(400).send({ error: 'message body required' })
    if (String(body).length > MAX_MESSAGE_LENGTH) return reply.code(400).send({ error: 'message too long' })

    const conv = await getConversation(req.user, peer, group)
    if (conv.error) return reply.code(conv.code).send({ error: conv.error })

    const { rows } = await query(
      `INSERT INTO messages
        (kind, conversation_key, sender_id, sender_username, recipient_id, recipient_username, group_id, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, kind, conversation_key, sender_username AS "from", recipient_username AS "to",
                 body AS text, status, created_at, to_char(created_at,'HH24:MI') AS at`,
      [conv.kind, conv.key, req.user.id, req.user.username, conv.recipientId || null,
       conv.recipientUsername || null, conv.groupId || null, text],
    )
    return reply.code(201).send({ message: rows[0] })
  })

  app.post('/api/presence/heartbeat', { preHandler: [requireMember] }, async (req, reply) => {
    await query('UPDATE users SET last_seen=now() WHERE id=$1', [req.user.id])
    return reply.send({ ok: true, server_time: new Date().toISOString() })
  })

  app.get('/api/presence', { preHandler: [requireMember] }, async (_req, reply) => {
    const { rows } = await query(`
      SELECT username, last_seen, verified,
             CASE WHEN last_seen >= now() - interval '90 seconds' THEN true ELSE false END AS online
      FROM users ORDER BY last_seen DESC LIMIT 100
    `)
    return reply.send({ users: rows, server_time: new Date().toISOString() })
  })

  app.post('/api/groups/:slug/invite', { preHandler: [requireMember] }, async (req, reply) => {
    const g = await query('SELECT id FROM groups WHERE slug=$1', [req.params.slug])
    if (!g.rows[0]) return reply.code(404).send({ error: 'group not found' })
    const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [g.rows[0].id, req.user.id, 'admin'])
    if (req.user.role !== 'admin' && !ga.rows[0]) return reply.code(403).send({ error: 'group admin required' })
    const { targetUsername } = req.body || {}
    const targetName = cleanUsername(targetUsername)
    if (!targetName) return reply.code(400).send({ error: 'targetUsername required' })
    const target = await query('SELECT id, username FROM users WHERE username=$1', [targetName])
    if (!target.rows[0]) return reply.code(404).send({ error: 'target user not found' })
    const { rows } = await query(
      `INSERT INTO group_invites (group_id, invited_username, invited_user_id, inviter_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [g.rows[0].id, target.rows[0].username, target.rows[0].id, req.user.id],
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
