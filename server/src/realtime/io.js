import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'

// VPS-only realtime: single instance → Memory adapter is fine for 500 users.
// If REDIS_URL is set, use the Redis adapter for horizontal scaling.
export async function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
  })

  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter')
      const { createClient } = await import('redis')
      const pub = createClient({ url: process.env.REDIS_URL })
      const sub = pub.duplicate()
      await Promise.all([pub.connect(), sub.connect()])
      io.adapter(createAdapter(pub, sub))
      console.log('[realtime] redis adapter enabled')
    } catch (e) {
      console.warn('[realtime] redis adapter failed, falling back to memory:', e.message)
    }
  } else {
    console.log('[realtime] memory adapter (single VPS instance)')
  }

  function keyFor(a, b) {
    return `harvest:chat:${[a, b].sort().join(':')}`
  }
  function groupKey(slug) {
    return `group:${slug}`
  }
  function safeAck(ack, payload) {
    if (typeof ack === 'function') ack(payload)
  }

  // Re-read the account before accepting a privileged/action event. JWT is only
  // the session proof; PostgreSQL remains the authority for identity and role.
  async function refreshSocketUser(socket) {
    const id = socket.user?.id
    if (!id) return null
    const { rows } = await query('SELECT id, username, role, group_name FROM users WHERE id=$1', [id])
    const user = rows[0]
    if (!user || !['admin', 'pastor', 'member'].includes(user.role)) return null
    socket.user = user
    return user
  }

  async function requireFreshUser(socket, ack) {
    try {
      const user = await refreshSocketUser(socket)
      if (!user) {
        safeAck(ack, { error: 'session expired' })
        socket.disconnect(true)
        return null
      }
      return user
    } catch (e) {
      safeAck(ack, { error: 'authorization unavailable' })
      return null
    }
  }

  async function canUseConversation(userId, conversationKey) {
    if (!conversationKey) return false
    const prefix = 'harvest:chat:'
    if (!conversationKey.startsWith(prefix)) return false
    const names = conversationKey.slice(prefix.length).split(':')
    if (names.length !== 2 || !names[0] || !names[1]) return false
    const { rows } = await query(
      'SELECT 1 FROM users WHERE id=$1 AND username=$2 AND EXISTS (SELECT 1 FROM users WHERE username=$3)',
      [userId, names[0] === names[1] ? names[0] : names[0], names[1]]
    )
    if (!rows[0]) {
      const me = await query('SELECT username FROM users WHERE id=$1', [userId])
      return !!me.rows[0] && (me.rows[0].username === names[0] || me.rows[0].username === names[1])
    }
    return true
  }

  async function canCallTarget(userId, username) {
    if (!username) return false
    const { rows } = await query('SELECT id FROM users WHERE username=$1 AND role IN (\'member\',\'pastor\',\'admin\')', [username])
    if (!rows[0]) return false
    return rows[0].id !== userId
  }

  const presence = new Map()
  const typingTimers = new Map()

  function setPresence(username, online) {
    const rec = presence.get(username) || { online: false, lastSeen: new Date().toISOString(), socketIds: new Set() }
    rec.online = online
    rec.lastSeen = new Date().toISOString()
    presence.set(username, rec)
    query('UPDATE users SET last_seen=now() WHERE username=$1', [username]).catch(() => {})
    io.emit('presence:update', { username, online, lastSeen: rec.lastSeen })
  }

  // JWT proves possession of a session token. Do not trust its role claim.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return next(new Error('auth required: send {auth:{token}}'))
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod')
      socket.user = payload
      const user = await refreshSocketUser(socket)
      if (!user) return next(new Error('account inactive or unauthorized'))
      return next()
    } catch (e) {
      return next(new Error('invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const username = socket.user.username
    const userId = socket.user.id
    console.log(`[realtime] connect ${username} ${socket.id}`)

    socket.join(`user:${username}`)

    const rec = presence.get(username)
    if (!rec) presence.set(username, { online: true, lastSeen: new Date().toISOString(), socketIds: new Set([socket.id]) })
    else { rec.socketIds.add(socket.id); rec.online = true }
    setPresence(username, true)

    socket.emit('presence:snapshot', Object.fromEntries([...presence.entries()].map(([u, v]) => [u, { online: v.online, lastSeen: v.lastSeen }])))

    socket.on('chat:join', async ({ peer } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user) return
      const other = String(peer || '').trim()
      if (!other || other === user.username) return safeAck(ack, { error: 'invalid peer' })
      const target = await query('SELECT id FROM users WHERE username=$1 AND role IN (\'member\',\'pastor\',\'admin\')', [other])
      if (!target.rows[0]) return safeAck(ack, { error: 'user not found' })
      socket.join(keyFor(user.username, other))
      safeAck(ack, { ok: true, conversation_key: keyFor(user.username, other) })
    })

    socket.on('group:join', async ({ slug } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user) return
      const groupSlug = String(slug || '').trim()
      if (!groupSlug) return safeAck(ack, { error: 'slug required' })
      try {
        const g = await query('SELECT id, invite_only FROM groups WHERE slug=$1', [groupSlug])
        if (!g.rows[0]) return safeAck(ack, { error: 'group not found' })
        const m = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, user.id])
        if (!m.rows[0] && user.role !== 'admin') return safeAck(ack, { error: 'group membership required' })
        socket.join(groupKey(groupSlug))
        safeAck(ack, { ok: true })
      } catch (e) {
        safeAck(ack, { error: 'group authorization failed' })
      }
    })

    socket.on('chat:send', async ({ to, body, tempId, kind = 'dm', groupSlug } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user) return
      const text = String(body || '').trim()
      if (!text || text.length > 4000) return safeAck(ack, { error: 'body 1..4000 chars required' })
      const now = new Date()

      try {
        if (kind === 'group') {
          const slug = String(groupSlug || '').trim()
          if (!slug) return safeAck(ack, { error: 'groupSlug required' })
          const g = await query('SELECT id FROM groups WHERE slug=$1', [slug])
          if (!g.rows[0]) return safeAck(ack, { error: 'group not found' })
          const mem = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, user.id])
          if (!mem.rows[0] && user.role !== 'admin') return safeAck(ack, { error: 'not a member' })

          const conv = groupKey(slug)
          const { rows } = await query(
            `INSERT INTO messages (kind, conversation_key, sender_id, sender_username, group_id, body, status) VALUES ('group',$1,$2,$3,$4,$5,'sent') RETURNING id, created_at`,
            [conv, user.id, user.username, g.rows[0].id, text]
          )
          const msg = { id: rows[0].id, kind: 'group', conversation_key: conv, from: user.username, groupSlug: slug, text, at: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), status: 'sent', created_at: rows[0].created_at }
          io.to(conv).emit('chat:message', msg)
          safeAck(ack, { ok: true, id: msg.id, serverId: msg.id, at: msg.at, status: 'sent' })
          return
        }

        const targetUsername = String(to || '').trim()
        if (!targetUsername || targetUsername === user.username) return safeAck(ack, { error: 'invalid recipient' })
        const recipient = await query('SELECT id, username FROM users WHERE username=$1 AND role IN (\'member\',\'pastor\',\'admin\')', [targetUsername])
        if (!recipient.rows[0]) return safeAck(ack, { error: 'user not found' })
        const recipientId = recipient.rows[0].id
        const conv = keyFor(user.username, targetUsername)

        const { rows } = await query(
          `INSERT INTO messages (kind, conversation_key, sender_id, sender_username, recipient_id, recipient_username, body, status) VALUES ('dm',$1,$2,$3,$4,$5,$6,'sent') RETURNING id, created_at`,
          [conv, user.id, user.username, recipientId, targetUsername, text]
        )
        const msgId = rows[0].id
        const at = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const payload = { id: msgId, tempId, kind: 'dm', conversation_key: conv, from: user.username, to: targetUsername, text, at, status: 'sent', created_at: rows[0].created_at }
        io.to(conv).emit('chat:message', payload)
        io.to(`user:${targetUsername}`).emit('chat:message', payload)
        safeAck(ack, { ok: true, id: msgId, serverId: msgId, at, status: 'sent' })

        const recPresence = presence.get(targetUsername)
        if (recPresence?.online) {
          await query(`UPDATE messages SET status='delivered' WHERE id=$1 AND status='sent'`, [msgId])
          const upd = { id: msgId, conversation_key: conv, status: 'delivered' }
          io.to(conv).emit('message:delivered', upd)
          io.to(`user:${user.username}`).emit('message:delivered', upd)
        }
      } catch (e) {
        safeAck(ack, { error: 'message could not be sent' })
      }
    })

    socket.on('message:delivered', async ({ id, conversation_key } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !id || !conversation_key) return
      const { rowCount } = await query(
        `UPDATE messages SET status='delivered' WHERE id=$1 AND status='sent' AND recipient_id=$2 AND conversation_key=$3`,
        [id, user.id, conversation_key]
      )
      if (rowCount) io.to(conversation_key).emit('message:delivered', { id, conversation_key, status: 'delivered' })
      safeAck(ack, { ok: true, updated: !!rowCount })
    })

    socket.on('message:seen', async ({ conversation_key } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !conversation_key) return
      const allowed = await canUseConversation(user.id, conversation_key)
      if (!allowed) return safeAck(ack, { error: 'conversation access denied' })
      await query(`UPDATE messages SET status='seen' WHERE conversation_key=$1 AND recipient_id=$2 AND status IN ('sent','delivered')`, [conversation_key, user.id])
      io.to(conversation_key).emit('message:seen', { conversation_key, by: user.username, at: new Date().toISOString() })
      safeAck(ack, { ok: true })
    })

    socket.on('typing:start', async ({ conversation_key } = {}) => {
      const user = await requireFreshUser(socket)
      if (!user || !(await canUseConversation(user.id, conversation_key))) return
      socket.to(conversation_key).emit('typing', { conversation_key, username: user.username, typing: true })
      const k = `${conversation_key}:${user.username}`
      if (typingTimers.has(k)) clearTimeout(typingTimers.get(k))
      const t = setTimeout(() => {
        socket.to(conversation_key).emit('typing', { conversation_key, username: user.username, typing: false })
        typingTimers.delete(k)
      }, 3000)
      typingTimers.set(k, t)
    })

    socket.on('typing:stop', async ({ conversation_key } = {}) => {
      const user = await requireFreshUser(socket)
      if (!user || !(await canUseConversation(user.id, conversation_key))) return
      socket.to(conversation_key).emit('typing', { conversation_key, username: user.username, typing: false })
      const k = `${conversation_key}:${user.username}`
      if (typingTimers.has(k)) { clearTimeout(typingTimers.get(k)); typingTimers.delete(k) }
    })

    socket.on('group:invite', async ({ slug, targetUsername } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user) return
      if (!slug || !targetUsername) return safeAck(ack, { error: 'slug and targetUsername required' })
      const g = await query('SELECT id, slug FROM groups WHERE slug=$1', [slug])
      if (!g.rows[0]) return safeAck(ack, { error: 'group not found' })
      const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [g.rows[0].id, user.id, 'admin'])
      if (user.role !== 'admin' && !ga.rows[0]) return safeAck(ack, { error: 'group admin required' })
      const target = await query('SELECT id, username FROM users WHERE username=$1 AND role IN (\'member\',\'pastor\',\'admin\')', [String(targetUsername).trim()])
      if (!target.rows[0]) return safeAck(ack, { error: 'target user not found' })
      const { rows } = await query(
        `INSERT INTO group_invites (group_id, invited_username, invited_user_id, inviter_id, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
        [g.rows[0].id, target.rows[0].username, target.rows[0].id, user.id]
      )
      io.to(`user:${target.rows[0].username}`).emit('group:invite:pending', { id: rows[0].id, slug, invitedBy: user.username })
      safeAck(ack, { ok: true, id: rows[0].id })
    })

    socket.on('group:invite:approve', async ({ inviteId, approve } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user) return
      if (!inviteId) return safeAck(ack, { error: 'inviteId required' })
      const inv = await query('SELECT * FROM group_invites WHERE id=$1 AND status=$2', [inviteId, 'pending'])
      if (!inv.rows[0]) return safeAck(ack, { error: 'invite not found or not pending' })
      const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [inv.rows[0].group_id, user.id, 'admin'])
      if (user.role !== 'admin' && !ga.rows[0]) return safeAck(ack, { error: 'group admin required' })
      const status = approve ? 'approved' : 'rejected'
      await query(`UPDATE group_invites SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [inviteId, status, user.id])
      if (approve && inv.rows[0].invited_user_id) {
        await query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,\'member\') ON CONFLICT DO NOTHING', [inv.rows[0].group_id, inv.rows[0].invited_user_id])
        const g = await query('SELECT slug FROM groups WHERE id=$1', [inv.rows[0].group_id])
        io.to(`user:${inv.rows[0].invited_username}`).emit('group:invite:result', { id: inviteId, slug: g.rows[0]?.slug, status })
        for (const [, s] of io.sockets.sockets) {
          if (s.user?.username === inv.rows[0].invited_username) s.join(groupKey(g.rows[0].slug))
        }
      } else {
        io.to(`user:${inv.rows[0].invited_username}`).emit('group:invite:result', { id: inviteId, status })
      }
      safeAck(ack, { ok: true, status })
    })

    socket.on('call:offer', async ({ to, sdp, type } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !sdp || !(await canCallTarget(user.id, to))) return safeAck(ack, { error: 'call target unavailable' })
      io.to(`user:${to}`).emit('call:offer', { from: user.username, sdp, type: type || 'voice' })
      safeAck(ack, { ok: true })
    })

    socket.on('call:answer', async ({ to, sdp } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !sdp || !(await canCallTarget(user.id, to))) return safeAck(ack, { error: 'call target unavailable' })
      io.to(`user:${to}`).emit('call:answer', { from: user.username, sdp })
      safeAck(ack, { ok: true })
    })

    socket.on('call:ice', async ({ to, candidate } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !candidate || !(await canCallTarget(user.id, to))) return safeAck(ack, { error: 'call target unavailable' })
      io.to(`user:${to}`).emit('call:ice', { from: user.username, candidate })
      safeAck(ack, { ok: true })
    })

    socket.on('call:end', async ({ to } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !(await canCallTarget(user.id, to))) return safeAck(ack, { error: 'call target unavailable' })
      io.to(`user:${to}`).emit('call:end', { from: user.username })
      safeAck(ack, { ok: true })
    })

    socket.on('call:decline', async ({ to } = {}, ack) => {
      const user = await requireFreshUser(socket, ack)
      if (!user || !(await canCallTarget(user.id, to))) return safeAck(ack, { error: 'call target unavailable' })
      io.to(`user:${to}`).emit('call:decline', { from: user.username })
      safeAck(ack, { ok: true })
    })

    socket.on('disconnect', () => {
      const r = presence.get(username)
      if (r) {
        r.socketIds.delete(socket.id)
        if (r.socketIds.size === 0) {
          r.online = false
          r.lastSeen = new Date().toISOString()
          io.emit('presence:update', { username, online: false, lastSeen: r.lastSeen })
        }
      }
      console.log(`[realtime] disconnect ${username} ${socket.id}`)
    })
  })

  return io
}
