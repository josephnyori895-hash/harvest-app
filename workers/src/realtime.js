// Realtime Durable Object — port of server/src/realtime/io.js (socket.io → native WebSockets).
// Channels mirror the socket rooms: user:<username>, conversation keys (dm/group).
// Wire protocol: JSON frames {event, data, ackId?} both ways; server replies
// {event:'__ack', ackId, payload} when the client passes an ackId.
//
// Routing: the Worker forwards {event,data,ackId} for connected clients to this DO
// (idFromName('singleton')); the DO broadcasts to its live sockets. Persistence stays
// in D1 — the DO is pure transport. Presence is per-DO-instance in memory.

import { query } from './lib/db.js'
import { jwtVerify } from './lib/crypto.js'

export class Realtime {
  constructor(state, env) {
    this.state = state
    this.env = env
    // username → Set<WebSocket>
    this.sockets = new Map()
    this.typingTimers = new Map()
    this.initialized = false
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      const upgrade = new WebSocketPair()
      const token = url.searchParams.get('token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
      let user = null
      try {
        user = await jwtVerify(token, this.env.JWT_SECRET)
      } catch {
        return new Response('invalid token', { status: 401 })
      }
      // Validate against DB: active member/admin only.
      const { rows } = await query(this.env, 'SELECT id, username, role, active FROM users WHERE id=?', [user.id])
      const dbUser = rows[0]
      if (!dbUser || !dbUser.active || !['admin', 'member'].includes(dbUser.role)) {
        return new Response('account inactive or unauthorized', { status: 403 })
      }
      user = { ...user, username: dbUser.username, role: dbUser.role }

      this.state.acceptWebSocket(upgrade[1])
      const username = user.username
      if (!this.sockets.has(username)) this.sockets.set(username, new Set())
      this.sockets.get(username).add(upgrade[1])
      const sockMeta = { username, userId: user.id }
      upgrade[1].meta = sockMeta

      // presence broadcast
      this.broadcastAll({ event: 'presence:update', data: { username, online: true, lastSeen: new Date().toISOString() } })
      query(this.env, 'UPDATE users SET last_seen=? WHERE id=?', [new Date().toISOString(), user.id]).catch(() => {})
      this.safeSend(upgrade[1], { event: 'presence:snapshot', data: this.presenceSnapshot() })

      return new Response(null, { status: 101, webSocket: upgrade[0] })
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      // Worker → DO: inject a validated event (server-side fan-out helper).
      const frame = await request.json()
      try {
        await this.handleEvent(frame.user, frame.event, frame.data, frame.ackId ?? null, null)
      } catch {}
      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  }

  presenceSnapshot() {
    const out = {}
    for (const [u, set] of this.sockets) out[u] = { online: set.size > 0, lastSeen: new Date().toISOString() }
    return out
  }

  safeSend(ws, frame) {
    try { ws.send(JSON.stringify(frame)) } catch {}
  }

  sendToUser(username, frame) {
    const set = this.sockets.get(username)
    if (!set) return
    for (const ws of set) this.safeSend(ws, frame)
  }

  broadcastAll(frame) {
    for (const [, set] of this.sockets) for (const ws of set) this.safeSend(ws, frame)
  }

  // Conversation fan-out: for DMs, both users' sockets; for groups, all members' sockets.
  async fanoutConversation(conversationKey, frame) {
    if (conversationKey.startsWith('group:') || conversationKey.startsWith('department:')) {
      const isDepartment = conversationKey.startsWith('department:')
      const slug = conversationKey.slice(isDepartment ? 'department:'.length : 'group:'.length)
      const membershipTable = isDepartment ? 'department_members' : 'group_members'
      const idColumn = isDepartment ? 'department_id' : 'group_id'
      const parentTable = isDepartment ? 'departments' : 'groups'
      const parent = await query(this.env, `SELECT id FROM ${parentTable} WHERE slug=?`, [slug])
      if (!parent.rows[0]) return
      const m = await query(this.env, `SELECT user_id FROM ${membershipTable} WHERE ${idColumn}=?`, [parent.rows[0].id])
      const ids = m.rows.map(r => r.user_id)
      if (ids.length) {
        const ph = ids.map(() => '?').join(',')
        const us = await query(this.env, `SELECT username FROM users WHERE id IN (${ph})`, ids)
        for (const u of us.rows) this.sendToUser(u.username, frame)
      }
      return
    }
    const names = conversationKey.replace(/^harvest:chat:/, '').split(':')
    for (const n of names) this.sendToUser(n, frame)
  }

  async handleEvent(user, event, data, ackId, fromWs) {
    const ack = payload => {
      if (ackId == null) return
      if (fromWs) this.safeSend(fromWs, { event: '__ack', ackId, payload })
    }
    const fresh = async () => {
      const { rows } = await query(this.env, 'SELECT id, username, role, active FROM users WHERE id=?', [user.id])
      const u = rows[0]
      if (!u || !u.active || !['admin', 'member'].includes(u.role)) return null
      return u
    }

    const me = await fresh()
    if (!me) { ack({ error: 'session expired' }); return }

    const canUseConversation = async conversationKey => {
      const key = String(conversationKey || '')
      if (!key) return false
      if (key.startsWith('harvest:chat:')) {
        const names = key.slice('harvest:chat:'.length).split(':')
        if (names.length !== 2 || !names[0] || !names[1]) return false
        return names.includes(me.username)
      }
      if (key.startsWith('group:')) {
        const slug = key.slice('group:'.length)
        const g = await query(this.env, 'SELECT id FROM groups WHERE slug=?', [slug])
        if (!g.rows[0]) return false
        if (me.role === 'admin') return true
        const m = await query(this.env, 'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [g.rows[0].id, me.id])
        return !!m.rows[0]
      }
      if (key.startsWith('department:')) {
        const slug = key.slice('department:'.length)
        const d = await query(this.env, 'SELECT id FROM departments WHERE slug=?', [slug])
        if (!d.rows[0]) return false
        if (me.role === 'admin') return true
        const m = await query(this.env, 'SELECT 1 FROM department_members WHERE department_id=? AND user_id=?', [d.rows[0].id, me.id])
        return !!m.rows[0]
      }
      return false
    }

    switch (event) {
      case 'chat:send': {
        if (!data || typeof data !== 'object') return ack({ error: 'bad payload' })
        const text = String(data.body || '').trim()
        if (!text || text.length > 4000) return ack({ error: 'body 1..4000 chars required' })
        const now = new Date()
        const nowIso = now.toISOString()

        if (data.kind === 'group' && data.department) {
          const slug = String(data.department || data.departmentSlug || '').trim()
          const d = await query(this.env, 'SELECT id, slug FROM departments WHERE slug=?', [slug])
          if (!d.rows[0]) return ack({ error: 'department not found' })
          const mem = await query(this.env, 'SELECT 1 FROM department_members WHERE department_id=? AND user_id=?', [d.rows[0].id, me.id])
          if (!mem.rows[0] && me.role !== 'admin') return ack({ error: 'department membership required' })
          const conv = `department:${d.rows[0].slug}`
          const id = crypto.randomUUID()
          await query(
            this.env,
            `INSERT INTO messages (id, kind, conversation_key, sender_id, sender_username, group_id, body, status, created_at) VALUES (?, 'group', ?, ?, ?, NULL, ?, 'sent', ?)`,
            [id, conv, me.id, me.username, text, nowIso],
          )
          const msg = { id, kind: 'group', conversation_key: conv, from: me.username, departmentSlug: slug, text, at: nowIso.slice(11, 16), status: 'sent', created_at: nowIso }
          await this.fanoutConversation(conv, { event: 'chat:message', data: msg })
          return ack({ ok: true, id, serverId: id, at: msg.at, status: 'sent' })
        }

        if (data.kind === 'group') {
          const slug = String(data.groupSlug || '').trim()
          const g = await query(this.env, 'SELECT id FROM groups WHERE slug=?', [slug])
          if (!g.rows[0]) return ack({ error: 'group not found' })
          const mem = await query(this.env, 'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [g.rows[0].id, me.id])
          if (!mem.rows[0] && me.role !== 'admin') return ack({ error: 'not a member' })
          const conv = `group:${slug}`
          const id = crypto.randomUUID()
          await query(
            this.env,
            `INSERT INTO messages (id, kind, conversation_key, sender_id, sender_username, group_id, body, status, created_at) VALUES (?, 'group', ?, ?, ?, ?, ?, 'sent', ?)`,
            [id, conv, me.id, me.username, g.rows[0].id, text, nowIso],
          )
          const msg = { id, kind: 'group', conversation_key: conv, from: me.username, groupSlug: slug, text, at: nowIso.slice(11, 16), status: 'sent', created_at: nowIso }
          await this.fanoutConversation(conv, { event: 'chat:message', data: msg })
          return ack({ ok: true, id, serverId: id, at: msg.at, status: 'sent' })
        }

        const targetUsername = String(data.to || '').trim()
        if (!targetUsername || targetUsername === me.username) return ack({ error: 'invalid recipient' })
        const recipient = await query(this.env, `SELECT id, username FROM users WHERE username=? AND role IN ('member','admin') AND (active IS NULL OR active=1)`, [targetUsername])
        if (!recipient.rows[0]) return ack({ error: 'user not found' })
        const conv = `harvest:chat:${[me.username, targetUsername].sort().join(':')}`
        const id = crypto.randomUUID()
        await query(
          this.env,
          `INSERT INTO messages (id, kind, conversation_key, sender_id, sender_username, recipient_id, recipient_username, body, status, created_at) VALUES (?, 'dm', ?, ?, ?, ?, ?, ?, 'sent', ?)`,
          [id, conv, me.id, me.username, recipient.rows[0].id, targetUsername, text, nowIso],
        )
        const payload = { id, tempId: data.tempId, kind: 'dm', conversation_key: conv, from: me.username, to: targetUsername, text, at: nowIso.slice(11, 16), status: 'sent', created_at: nowIso }
        await this.fanoutConversation(conv, { event: 'chat:message', data: payload })
        this.sendToUser(targetUsername, { event: 'chat:message', data: payload })
        return ack({ ok: true, id, serverId: id, at: payload.at, status: 'sent' })
      }

      case 'chat:join': {
        // Informational in DO transport (fanout is by username); validate peer exists.
        const other = String(data?.peer || '').trim()
        if (!other || other === me.username) return ack({ error: 'invalid peer' })
        const t = await query(this.env, `SELECT id FROM users WHERE username=? AND role IN ('member','admin') AND (active IS NULL OR active=1)`, [other])
        if (!t.rows[0]) return ack({ error: 'user not found' })
        return ack({ ok: true, conversation_key: `harvest:chat:${[me.username, other].sort().join(':')}` })
      }

      case 'group:join': {
        const slug = String(data?.slug || '').trim()
        const g = await query(this.env, 'SELECT id FROM groups WHERE slug=?', [slug])
        if (!g.rows[0]) return ack({ error: 'group not found' })
        const m = await query(this.env, 'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [g.rows[0].id, me.id])
        if (!m.rows[0] && me.role !== 'admin') return ack({ error: 'group membership required' })
        return ack({ ok: true })
      }

      case 'message:delivered': {
        const { id, conversation_key } = data || {}
        if (!id || !conversation_key) return ack({ error: 'id and conversation_key required' })
        const res = await query(
          this.env,
          `UPDATE messages SET status='delivered' WHERE id=? AND status='sent' AND recipient_id=? AND conversation_key=?`,
          [id, me.id, conversation_key],
        )
        if (res.meta?.changes) {
          await this.fanoutConversation(conversation_key, { event: 'message:delivered', data: { id, conversation_key, status: 'delivered' } })
        }
        return ack({ ok: true, updated: !!res.meta?.changes })
      }

      case 'message:seen': {
        const { conversation_key } = data || {}
        if (!conversation_key || !(await canUseConversation(conversation_key))) return ack({ error: 'conversation access denied' })
        await query(
          this.env,
          `UPDATE messages SET status='seen' WHERE conversation_key=? AND recipient_id=? AND status IN ('sent','delivered')`,
          [conversation_key, me.id],
        )
        await this.fanoutConversation(conversation_key, { event: 'message:seen', data: { conversation_key, by: me.username, at: new Date().toISOString() } })
        return ack({ ok: true })
      }

      case 'typing:start':
      case 'typing:stop': {
        const { conversation_key } = data || {}
        if (!conversation_key || !(await canUseConversation(conversation_key))) return
        const typing = event === 'typing:start'
        await this.fanoutConversation(conversation_key, { event: 'typing', data: { conversation_key, username: me.username, typing } })
        if (typing) {
          const k = `${conversation_key}:${me.username}`
          if (this.typingTimers.has(k)) clearTimeout(this.typingTimers.get(k))
          this.typingTimers.set(k, setTimeout(() => {
            this.typingTimers.delete(k)
            this.fanoutConversation(conversation_key, { event: 'typing', data: { conversation_key, username: me.username, typing: false } })
          }, 3000))
        }
        return
      }

      case 'call:offer':
      case 'call:answer':
      case 'call:ice':
      case 'call:end':
      case 'call:decline': {
        const to = String(data?.to || '').trim()
        if (!to) return ack({ error: 'call target unavailable' })
        const t = await query(this.env, `SELECT id FROM users WHERE username=? AND role IN ('member','admin') AND (active IS NULL OR active=1)`, [to])
        if (!t.rows[0] || t.rows[0].id === me.id) return ack({ error: 'call target unavailable' })
        const { to: _omit, ...rest } = data
        this.sendToUser(to, { event, data: { ...rest, from: me.username } })
        return ack({ ok: true })
      }

      case 'group:invite': {
        const { slug, targetUsername } = data || {}
        if (!slug || !targetUsername) return ack({ error: 'slug and targetUsername required' })
        const g = await query(this.env, 'SELECT id, slug FROM groups WHERE slug=?', [slug])
        if (!g.rows[0]) return ack({ error: 'group not found' })
        const ga = await query(this.env, `SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'`, [g.rows[0].id, me.id])
        if (me.role !== 'admin' && !ga.rows[0]) return ack({ error: 'group admin required' })
        const target = await query(this.env, `SELECT id, username FROM users WHERE username=? AND role IN ('member','admin') AND (active IS NULL OR active=1)`, [String(targetUsername).trim()])
        if (!target.rows[0]) return ack({ error: 'target user not found' })
        const id = crypto.randomUUID()
        await query(
          this.env,
          `INSERT INTO group_invites (id, group_id, invited_username, invited_user_id, inviter_id, status, created_at) VALUES (?,?,?,?,?,'pending',?)`,
          [id, g.rows[0].id, target.rows[0].username, target.rows[0].id, me.id, new Date().toISOString()],
        )
        this.sendToUser(target.rows[0].username, { event: 'group:invite:pending', data: { id, slug, invitedBy: me.username } })
        return ack({ ok: true, id })
      }

      case 'group:invite:approve': {
        const { inviteId, approve = true } = data || {}
        if (!inviteId) return ack({ error: 'inviteId required' })
        const inv = await query(this.env, `SELECT * FROM group_invites WHERE id=? AND status='pending'`, [inviteId])
        if (!inv.rows[0]) return ack({ error: 'invite not found or not pending' })
        const ga = await query(this.env, `SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'`, [inv.rows[0].group_id, me.id])
        if (me.role !== 'admin' && !ga.rows[0]) return ack({ error: 'group admin required' })
        const status = approve ? 'approved' : 'rejected'
        await query(this.env, `UPDATE group_invites SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`, [status, me.id, new Date().toISOString(), inviteId])
        if (approve && inv.rows[0].invited_user_id) {
          await query(this.env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,'member') ON CONFLICT DO NOTHING`, [inv.rows[0].group_id, inv.rows[0].invited_user_id])
          const g = await query(this.env, 'SELECT slug FROM groups WHERE id=?', [inv.rows[0].group_id])
          this.sendToUser(inv.rows[0].invited_username, { event: 'group:invite:result', data: { id: inviteId, slug: g.rows[0]?.slug, status } })
        } else {
          this.sendToUser(inv.rows[0].invited_username, { event: 'group:invite:result', data: { id: inviteId, status } })
        }
        return ack({ ok: true, status })
      }

      default:
        return ack({ error: `unknown event: ${event}` })
    }
  }

  // Hibernation-aware WebSocket close handler.
  async webSocketMessage(ws, message) {
    let frame
    try { frame = JSON.parse(String(message)) } catch { return }
    if (frame?.event === '__pong' || frame?.event === 'ping') return
    if (!frame?.event) return
    const meta = ws.meta
    if (!meta) return
    try {
      await this.handleEvent({ id: meta.userId, username: meta.username }, frame.event, frame.data, frame.ackId, ws)
    } catch {}
  }

  async webSocketClose(ws) {
    const meta = ws.meta
    if (!meta) return
    const set = this.sockets.get(meta.username)
    if (set) {
      set.delete(ws)
      if (set.size === 0) {
        this.sockets.delete(meta.username)
        this.broadcastAll({ event: 'presence:update', data: { username: meta.username, online: false, lastSeen: new Date().toISOString() } })
        query(this.env, 'UPDATE users SET last_seen=? WHERE id=?', [new Date().toISOString(), meta.userId]).catch(() => {})
      }
    }
  }
}
