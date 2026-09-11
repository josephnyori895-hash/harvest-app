import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { pool, query } from '../db.js'

// VPS-only realtime: single instance → Memory adapter is fine for 500 users.
// If REDIS_URL set (same VPS redis:6379), upgrades to @socket.io/redis-adapter for future horizontal scale.
export async function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1MB per message cap
  })

  // Optional Redis adapter — keeps KES 1k same VPS cost (redis on same docker network)
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter')
      const { createClient } = await import('redis')
      const pub = createClient({ url: process.env.REDIS_URL })
      const sub = pub.duplicate()
      await Promise.all([pub.connect(), sub.connect()])
      io.adapter(createAdapter(pub, sub))
      console.log('[realtime] redis adapter enabled', process.env.REDIS_URL.replace(/:[^@]*@/, ':***@'))
    } catch (e) {
      console.warn('[realtime] redis adapter failed, falling back to memory:', e.message)
    }
  } else {
    console.log('[realtime] memory adapter (single VPS instance, 500 users — no Redis needed)')
  }

  // ---- helpers ----
  function keyFor(a, b) {
    return `harvest:chat:${[a, b].sort().join(':')}`
  }
  function groupKey(slug) {
    return `group:${slug}`
  }

  // ephemeral presence (in-memory; Redis alternative would be HSET with TTL)
  const presence = new Map() // username -> { online, lastSeen, socketIds: Set }
  const typingTimers = new Map() // `${room}:${username}` -> timeout

  function setPresence(username, online) {
    const rec = presence.get(username) || { online: false, lastSeen: new Date().toISOString(), socketIds: new Set() }
    rec.online = online
    rec.lastSeen = new Date().toISOString()
    presence.set(username, rec)
    // persist last_seen to PG debounced (don't await)
    query('UPDATE users SET last_seen=now() WHERE username=$1', [username]).catch(() => {})
    io.emit('presence:update', { username, online, lastSeen: rec.lastSeen })
  }

  // ---- auth middleware: Bearer JWT same as REST ----
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '')
    if (!token) return next(new Error('auth required: send {auth:{token}}'))
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod')
      socket.user = payload // {id, username, role, group_name}
      return next()
    } catch (e) {
      return next(new Error('invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const { username, id: userId, role } = socket.user
    console.log(`[realtime] connect ${username} ${socket.id}`)

    // personal room for delivered/seen acks + invites even when not in chat room
    socket.join(`user:${username}`)

    // presence: mark online
    const rec = presence.get(username)
    if (!rec) presence.set(username, { online: true, lastSeen: new Date().toISOString(), socketIds: new Set([socket.id]) })
    else { rec.socketIds.add(socket.id); rec.online = true }
    setPresence(username, true)

    // send initial presence snapshot to newcomer
    socket.emit('presence:snapshot', Object.fromEntries([...presence.entries()].map(([u, v]) => [u, { online: v.online, lastSeen: v.lastSeen }])))

    // ---- room join ----
    // Client must emit `chat:join` with {peer} for 1-1, or `group:join` with {slug}
    socket.on('chat:join', ({ peer }) => {
      if (!peer || peer === username) return
      const room = keyFor(username, peer)
      socket.join(room)
      // Ack: mark any pending delivered for this viewer
      // client will request history via REST; we just ensure room membership
    })

    socket.on('group:join', async ({ slug }) => {
      if (!slug) return
      // check membership (invite-only enforced)
      try {
        const g = await query('SELECT id, invite_only FROM groups WHERE slug=$1', [slug])
        if (!g.rows[0]) return socket.emit('error', { message: `group ${slug} not found` })
        if (g.rows[0].invite_only) {
          const m = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, userId])
          if (!m.rows[0] && role !== 'admin') return socket.emit('error', { message: 'invite-only: admin must approve' })
        }
        socket.join(groupKey(slug))
      } catch (e) {
        socket.emit('error', { message: e.message })
      }
    })

    // ---- DM send: sent → delivered → seen ----
    socket.on('chat:send', async ({ to, body, tempId, kind = 'dm', groupSlug }, ack) => {
      const text = String(body || '').trim()
      if (!text || text.length > 4000) return ack?.({ error: 'body 1..4000 chars required' })
      const now = new Date()

      if (kind === 'group') {
        if (!groupSlug) return ack?.({ error: 'groupSlug required' })
        const g = await query('SELECT id FROM groups WHERE slug=$1', [groupSlug])
        if (!g.rows[0]) return ack?.({ error: 'group not found' })
        const groupId = g.rows[0].id
        // membership check
        const mem = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId])
        if (!mem.rows[0] && role !== 'admin') return ack?.({ error: 'not a member' })

        const conv = groupKey(groupSlug)
        const { rows } = await query(
          `INSERT INTO messages (kind, conversation_key, sender_id, sender_username, group_id, body, status) VALUES ('group',$1,$2,$3,$4,$5,'sent') RETURNING id, created_at`,
          [conv, userId, username, groupId, text]
        )
        const msg = { id: rows[0].id, kind: 'group', conversation_key: conv, from: username, groupSlug, text, at: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), status: 'sent', created_at: rows[0].created_at }
        io.to(conv).emit('chat:message', msg)
        // also notify group members' personal rooms for badge counts
        ack?.({ ok: true, id: msg.id, serverId: msg.id, at: msg.at, status: 'sent' })
        // group delivered is implicit (no per-recipient seen tracking in v1; extension: group_receipts table)
        return
      }

      // DM
      if (!to) return ack?.({ error: 'to required' })
      const recipient = await query('SELECT id, username FROM users WHERE username=$1', [to])
      if (!recipient.rows[0]) return ack?.({ error: `user ${to} not found` })
      const recipientId = recipient.rows[0].id
      const conv = keyFor(username, to)

      const { rows } = await query(
        `INSERT INTO messages (kind, conversation_key, sender_id, sender_username, recipient_id, recipient_username, body, status) VALUES ('dm',$1,$2,$3,$4,$5,$6,'sent') RETURNING id, created_at`,
        [conv, userId, username, recipientId, to, text]
      )
      const msgId = rows[0].id
      const at = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const payload = { id: msgId, tempId, kind: 'dm', conversation_key: conv, from: username, to, text, at, status: 'sent', created_at: rows[0].created_at }

      // emit to room + to recipient personal room (so they get it even if not currently in chat:join)
      io.to(conv).emit('chat:message', payload)
      io.to(`user:${to}`).emit('chat:message', payload)
      ack?.({ ok: true, id: msgId, serverId: msgId, at, status: 'sent' })

      // delivered: if recipient online (has presence), flip to delivered after ack from their client OR immediate if they have any socket
      const recPresence = presence.get(to)
      if (recPresence?.online) {
        await query(`UPDATE messages SET status='delivered' WHERE id=$1 AND status='sent'`, [msgId]).catch(() => {})
        const upd = { id: msgId, conversation_key: conv, status: 'delivered' }
        io.to(conv).emit('message:delivered', upd)
        io.to(`user:${username}`).emit('message:delivered', upd)
      }
    })

    // delivered / seen acks from recipient client
    socket.on('message:delivered', async ({ id, conversation_key }) => {
      if (!id) return
      await query(`UPDATE messages SET status='delivered' WHERE id=$1 AND status='sent'`, [id]).catch(() => {})
      const room = conversation_key || ''
      io.to(room).emit('message:delivered', { id, conversation_key: room, status: 'delivered' })
    })

    socket.on('message:seen', async ({ conversation_key }) => {
      // mark all dm messages to this viewer in that conversation as seen
      if (!conversation_key) return
      await query(`UPDATE messages SET status='seen' WHERE conversation_key=$1 AND recipient_username=$2 AND status IN ('sent','delivered')`, [conversation_key, username]).catch(() => {})
      io.to(conversation_key).emit('message:seen', { conversation_key, by: username, at: new Date().toISOString() })
      // also notify sender personal room
      // fetch distinct senders to notify? For 1-1 just emit to room suffices.
    })

    // ---- typing 3s broadcast ----
    socket.on('typing:start', ({ conversation_key }) => {
      if (!conversation_key) return
      socket.to(conversation_key).emit('typing', { conversation_key, username, typing: true })
      const k = `${conversation_key}:${username}`
      if (typingTimers.has(k)) clearTimeout(typingTimers.get(k))
      const t = setTimeout(() => {
        socket.to(conversation_key).emit('typing', { conversation_key, username, typing: false })
        typingTimers.delete(k)
      }, 3000)
      typingTimers.set(k, t)
    })
    socket.on('typing:stop', ({ conversation_key }) => {
      if (!conversation_key) return
      socket.to(conversation_key).emit('typing', { conversation_key, username, typing: false })
      const k = `${conversation_key}:${username}`
      if (typingTimers.has(k)) { clearTimeout(typingTimers.get(k)); typingTimers.delete(k) }
    })

    // ---- group invite: admin approves (requirement 525) ----
    socket.on('group:invite', async ({ slug, targetUsername }, ack) => {
      if (!slug || !targetUsername) return ack?.({ error: 'slug and targetUsername required' })
      const g = await query('SELECT id, slug FROM groups WHERE slug=$1', [slug])
      if (!g.rows[0]) return ack?.({ error: 'group not found' })
      // only admin or group admin can invite
      const isGroupAdmin = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [g.rows[0].id, userId, 'admin'])
      const canInvite = role === 'admin' || isGroupAdmin.rows[0]
      if (!canInvite) return ack?.({ error: 'only admin can invite' })
      const target = await query('SELECT id FROM users WHERE username=$1', [targetUsername])
      const targetId = target.rows[0]?.id || null
      const { rows } = await query(
        `INSERT INTO group_invites (group_id, invited_username, invited_user_id, inviter_id, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
        [g.rows[0].id, targetUsername, targetId, userId]
      )
      const inviteId = rows[0].id
      io.to(`user:${targetUsername}`).emit('group:invite:pending', { id: inviteId, slug, invitedBy: username })
      ack?.({ ok: true, id: inviteId })
    })

    socket.on('group:invite:approve', async ({ inviteId, approve }, ack) => {
      if (!inviteId) return ack?.({ error: 'inviteId required' })
      // only admin can approve
      if (role !== 'admin') {
        const check = await query('SELECT group_id FROM group_invites WHERE id=$1', [inviteId])
        if (!check.rows[0]) return ack?.({ error: 'invite not found' })
        const ga = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [check.rows[0].group_id, userId, 'admin'])
        if (!ga.rows[0]) return ack?.({ error: 'admin only' })
      }
      const inv = await query('SELECT * FROM group_invites WHERE id=$1 AND status=$2', [inviteId, 'pending'])
      if (!inv.rows[0]) return ack?.({ error: 'invite not pending' })
      const status = approve ? 'approved' : 'rejected'
      await query(`UPDATE group_invites SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [inviteId, status, userId])
      if (approve) {
        // ensure user exists then add membership
        let uid = inv.rows[0].invited_user_id
        if (!uid) {
          const u = await query('SELECT id FROM users WHERE username=$1', [inv.rows[0].invited_username])
          uid = u.rows[0]?.id || null
        }
        if (uid) {
          await query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [inv.rows[0].group_id, uid, 'member'])
          const g = await query('SELECT slug FROM groups WHERE id=$1', [inv.rows[0].group_id])
          io.to(`user:${inv.rows[0].invited_username}`).emit('group:invite:result', { id: inviteId, slug: g.rows[0]?.slug, status: 'approved' })
          // auto-join their sockets if online
          for (const [, s] of io.sockets.sockets) {
            if (s.user?.username === inv.rows[0].invited_username) s.join(groupKey(g.rows[0].slug))
          }
        }
      } else {
        io.to(`user:${inv.rows[0].invited_username}`).emit('group:invite:result', { id: inviteId, status: 'rejected' })
      }
      ack?.({ ok: true, status })
    })

    // ---- WebRTC signaling relay (coturn 3478 handles NAT, 60% Nyeri 3G NAT) ----
    // No media through server — just SDP + ICE relay. Rooms: call:${pair}
    socket.on('call:offer', ({ to, sdp, type }) => {
      if (!to || !sdp) return
      io.to(`user:${to}`).emit('call:offer', { from: username, sdp, type: type || 'voice' })
    })
    socket.on('call:answer', ({ to, sdp }) => {
      io.to(`user:${to}`).emit('call:answer', { from: username, sdp })
    })
    socket.on('call:ice', ({ to, candidate }) => {
      io.to(`user:${to}`).emit('call:ice', { from: username, candidate })
    })
    socket.on('call:end', ({ to }) => {
      if (to) io.to(`user:${to}`).emit('call:end', { from: username })
    })
    socket.on('call:decline', ({ to }) => {
      io.to(`user:${to}`).emit('call:decline', { from: username })
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
