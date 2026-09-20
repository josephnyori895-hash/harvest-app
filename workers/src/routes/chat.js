// Port of server/src/routes/chat.js (pg → D1). All timestamps ISO strings.
import { query } from '../lib/db.js'
import { requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, searchParams, httpError } from '../lib/http.js'
import { mediaUrlOrNull } from '../lib/media.js'
import { hasCap } from '../lib/capabilities.js'

const MAX_MESSAGE_LENGTH = 4000

function cleanText(value) {
  return String(value ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
}

function hasChatModeration(fresh) { return fresh?.role === 'admin' || hasCap(fresh, 'moderate_chat') }

function cleanUsername(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
}

async function getConversation(env, me, peer, group, department) {
  if (group) {
    const slug = String(group).trim().slice(0, 80)
    const g = await query(env, 'SELECT id, slug FROM groups WHERE slug=?', [slug])
    if (!g.rows[0]) return { error: 'group not found', code: 404 }
    const membership = await query(env, 'SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', [g.rows[0].id, me.id])
    if (!membership.rows[0] && me.role !== 'admin') return { error: 'group membership required', code: 403 }
    return { kind: 'group', key: `group:${g.rows[0].slug}`, groupId: g.rows[0].id, groupSlug: g.rows[0].slug }
  }

  // Department team chat — departments work like groups (client's request):
  // every member of the department can read and write; others get 403.
  // NOTE: no groupId here — messages.group_id has a FK to groups(id), and
  // department ids would violate it. The conversation_key scopes everything.
  if (department) {
    const slug = String(department).trim().slice(0, 80)
    const d = await query(env, 'SELECT id, slug FROM departments WHERE slug=?', [slug])
    if (!d.rows[0]) return { error: 'department not found', code: 404 }
    const membership = await query(env, 'SELECT 1 FROM department_members WHERE department_id=? AND user_id=?', [d.rows[0].id, me.id])
    if (!membership.rows[0] && me.role !== 'admin') return { error: 'department membership required', code: 403 }
    return { kind: 'group', key: `department:${d.rows[0].slug}`, groupSlug: d.rows[0].slug }
  }

  const other = cleanUsername(peer)
  if (!other || other === me.username) return { error: 'invalid peer', code: 400 }
  const target = await query(env, 'SELECT id, username FROM users WHERE username=?', [other])
  if (!target.rows[0]) return { error: 'user not found', code: 404 }
  return {
    kind: 'dm',
    key: `harvest:chat:${[me.username, target.rows[0].username].sort().join(':')}`,
    recipientId: target.rows[0].id,
    recipientUsername: target.rows[0].username,
  }
}

async function canAccessConversation(env, me, conversationKey) {
  const key = String(conversationKey || '')
  if (key.startsWith('harvest:chat:')) return key.split(':').includes(me.username)
  if (key.startsWith('group:')) {
    const slug = key.slice('group:'.length)
    const r = await query(env, `SELECT 1 FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE g.slug=? AND gm.user_id=?`, [slug, me.id])
    return me.role === 'admin' || !!r.rows[0]
  }
  if (key.startsWith('department:')) {
    const slug = key.slice('department:'.length)
    const r = await query(env, `SELECT 1 FROM departments d JOIN department_members dm ON dm.department_id=d.id WHERE d.slug=? AND dm.user_id=?`, [slug, me.id])
    return me.role === 'admin' || !!r.rows[0]
  }
  return false
}

function messageSelect() {
  return `SELECT id, kind, conversation_key, sender_username AS "from", recipient_username AS "to",
                 CASE WHEN deleted_at IS NOT NULL THEN 'This message was deleted' ELSE body END AS text, status, created_at, deleted_at, deleted_by,
                 reply_to_id, reply_preview, media_key, media_type, reaction,
                 substr(created_at, 12, 5) AS at
          FROM messages`
}

export async function handleChat(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const user = ctx.user
  const method = request.method
  const qp = searchParams(url)

  // GET /api/chat/history
  if (path === '/api/chat/history' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { peer, group, department, limit = '50', before } = qp
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
    const conv = await getConversation(env, fresh, peer, group, department)
    if (conv.error) return errorResponse(conv.error, conv.code)
    if (before && Number.isNaN(new Date(String(before)).getTime())) return errorResponse('invalid before timestamp', 400)
    const sql = `${messageSelect()} WHERE conversation_key=? ${before ? 'AND created_at < ?' : ''} ORDER BY created_at DESC LIMIT ?`
    const params = before ? [conv.key, String(before), lim] : [conv.key, lim]
    const { rows } = await query(env, sql, params)
    return jsonResponse({ messages: rows.reverse(), conversation_key: conv.key })
  }

  // GET /api/chat/updates — incremental polling (`after` timestamp).
  if (path === '/api/chat/updates' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { peer, group, department, after, limit = '50' } = qp
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
    if (!after || Number.isNaN(new Date(String(after)).getTime())) return errorResponse('valid after timestamp required', 400)
    const conv = await getConversation(env, fresh, peer, group, department)
    if (conv.error) return errorResponse(conv.error, conv.code)
    const { rows } = await query(
      env,
      `${messageSelect()} WHERE conversation_key=? AND created_at > ? ORDER BY created_at ASC LIMIT ?`,
      [conv.key, String(after), lim],
    )
    return jsonResponse({ messages: rows, conversation_key: conv.key, server_time: new Date().toISOString() })
  }

  // POST /api/chat/messages — text, replies, and image messages in one endpoint.
  if (path === '/api/chat/messages' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const text = cleanText(body.body)
    const mediaKey = String(body.media_key || '').trim().slice(0, 300) || null
    const mediaType = mediaKey ? (String(body.media_type || 'image').trim().slice(0, 20)) : null
    if (!text && !mediaKey) return errorResponse('message body or media required', 400)
    if (String(body.body || '').length > MAX_MESSAGE_LENGTH) return errorResponse('message too long', 400)
    const conv = await getConversation(env, fresh, body.peer, body.group, body.department)
    if (conv.error) return errorResponse(conv.error, conv.code)
    if (conv.groupId) {
      const permission = await query(env, `SELECT g.allow_member_send, gm.role FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE g.id=? AND gm.user_id=?`, [conv.groupId, fresh.id])
      const row = permission.rows[0]
      if (!row) return errorResponse('group membership required', 403)
      if (fresh.role !== 'admin' && row.role !== 'admin' && !row.allow_member_send) return errorResponse('only group admins can send messages in this group', 403)
    }
    // Reply support: verify the referenced message belongs to this conversation.
    let replyToId = null, replyPreview = null
    if (body.reply_to_id) {
      const ref = await query(env, 'SELECT id, sender_username, body, media_type FROM messages WHERE id=? AND conversation_key=?', [String(body.reply_to_id).slice(0, 64), conv.key])
      if (ref.rows[0]) {
        replyToId = ref.rows[0].id
        const previewBody = ref.rows[0].media_type && !ref.rows[0].body ? `📷 ${ref.rows[0].media_type === 'image' ? 'Photo' : 'Media'}` : String(ref.rows[0].body || '').slice(0, 80)
        replyPreview = `${ref.rows[0].sender_username}: ${previewBody}`
      }
    }
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await query(
      env,
      `INSERT INTO messages (id, kind, conversation_key, sender_id, sender_username, recipient_id, recipient_username, group_id, body, status, created_at, reply_to_id, reply_preview, media_key, media_type)
       VALUES (?,?,?,?,?,?,?,?,?, 'sent', ?,?,?,?,?)`,
      [id, conv.kind, conv.key, fresh.id, fresh.username, conv.recipientId || null, conv.recipientUsername || null, conv.groupId || null, text || (mediaType === 'image' ? '📷' : ''), now, replyToId, replyPreview, mediaKey, mediaType],
    )
    return jsonResponse(
      { message: { id, kind: conv.kind, conversation_key: conv.key, from: fresh.username, to: conv.recipientUsername || null, text: text || (mediaType === 'image' ? '📷' : ''), status: 'sent', created_at: now, at: now.slice(11, 16), reply_to_id: replyToId, reply_preview: replyPreview, media_key: mediaKey, media_type: mediaType, reaction: null } },
      201,
    )
  }

  // POST /api/chat/messages/:id/react — Instagram-style quick reaction.
  if (/^\/api\/chat\/messages\/[^/]+\/react$/.test(path) && method === 'POST') {
    const fresh = await requireMember(env, user)
    const msgId = path.split('/')[4]
    const body = await readJson(request)
    const allowed = ['❤️', '😂', '😮', '😢', '🙏', '🔥', '']
    const rx = allowed.includes(body.reaction) ? body.reaction : ''
    const m = await query(env, 'SELECT id, conversation_key, sender_username FROM messages WHERE id=?', [msgId])
    if (!m.rows[0]) return errorResponse('message not found', 404)
    // DM keys are harvest:chat:<userA>:<userB> (sorted); the reactor must be one of them.
    // Team keys (group:<slug> / department:<slug>) were membership-checked at
    // history load — the client can only reach this route with a valid token.
    if (!(await canAccessConversation(env, fresh, m.rows[0].conversation_key))) return errorResponse('forbidden', 403)
    await query(env, 'UPDATE messages SET reaction=? WHERE id=?', [rx || null, msgId])
    return jsonResponse({ ok: true, reaction: rx || null })
  }

  // DELETE /api/chat/messages/:id — admin/delegated moderation soft-deletes a message.
  // Keep the row for audit/history integrity; clients receive a neutral tombstone.
  if (/^\\/api\\/chat\\/messages\\/[^/]+$/.test(path) && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const msgId = path.split('/')[4]
    const m = await query(env, 'SELECT id, conversation_key, sender_username, deleted_at FROM messages WHERE id=?', [msgId])
    if (!m.rows[0]) return errorResponse('message not found', 404)
    if (m.rows[0].deleted_at) return jsonResponse({ ok: true, deleted: true, id: msgId })
    if (!hasChatModeration(fresh)) return errorResponse('chat moderation is reserved for the admin or members granted moderate_chat', 403)
    if (!(await canAccessConversation(env, fresh, m.rows[0].conversation_key))) return errorResponse('forbidden', 403)
    const now = new Date().toISOString()
    await query(env, 'UPDATE messages SET deleted_at=?, deleted_by=? WHERE id=? AND deleted_at IS NULL', [now, fresh.id, msgId])
    return jsonResponse({ ok: true, deleted: true, id: msgId, deleted_at: now })
  }

  // GET /api/chat/conversations — inbox + authorized team chats with unread counts.
  if (path === '/api/chat/conversations' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT m.conversation_key,
              MAX(m.created_at) AS last_at,
              (SELECT body FROM messages b WHERE b.conversation_key = m.conversation_key ORDER BY b.created_at DESC LIMIT 1) AS last_text,
              (SELECT sender_username FROM messages b WHERE b.conversation_key = m.conversation_key ORDER BY b.created_at DESC LIMIT 1) AS last_from,
              SUM(CASE WHEN m.sender_username != ? AND mr.message_id IS NULL THEN 1 ELSE 0 END) AS unread,
              COUNT(*) AS total
         FROM messages m
        LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = ?
        WHERE m.conversation_key LIKE 'harvest:chat:%' AND (m.conversation_key LIKE ? OR m.conversation_key LIKE ?)
        GROUP BY m.conversation_key
        ORDER BY last_at DESC LIMIT 50`,
      [fresh.username, fresh.id, `harvest:chat:${fresh.username}:%`, `harvest:chat:%:${fresh.username}`],
    )
    const out = []
    for (const r of rows) {
      const parts = r.conversation_key.replace('harvest:chat:', '').split(':')
      const peer = parts.find(p => p !== fresh.username) || fresh.username
      const u = await query(env, 'SELECT name, verified FROM users WHERE username=?', [peer])
      out.push({ conversation_key: r.conversation_key, peer, peer_name: u.rows[0]?.name || peer, peer_verified: !!u.rows[0]?.verified, last_text: r.last_text, last_from: r.last_from, unread: Number(r.unread) || 0, last_at: r.last_at })
    }

    // Team conversations use the same unread calculation as personal chats.
    // Membership is enforced here so Departments/Chats cannot expose another
    // department or group just by knowing its conversation key.
    const teamResult = await query(
      env,
      `WITH authorized AS (
         SELECT 'department:' || d.slug AS conversation_key, 'department' AS kind, d.slug AS slug, d.name AS name
           FROM departments d
           JOIN department_members dm ON dm.department_id = d.id
          WHERE dm.user_id = ? OR ? = 'admin'
         UNION
         SELECT 'group:' || g.slug AS conversation_key, 'group' AS kind, g.slug AS slug, g.name AS name
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE gm.user_id = ? OR ? = 'admin'
       )
       SELECT a.conversation_key, a.kind, a.slug, a.name,
              MAX(m.created_at) AS last_at,
              (SELECT body FROM messages b WHERE b.conversation_key = a.conversation_key ORDER BY b.created_at DESC LIMIT 1) AS last_text,
              (SELECT sender_username FROM messages b WHERE b.conversation_key = a.conversation_key ORDER BY b.created_at DESC LIMIT 1) AS last_from,
              COALESCE(SUM(CASE WHEN m.sender_username != ? AND mr.message_id IS NULL THEN 1 ELSE 0 END), 0) AS unread,
              COUNT(m.id) AS total
         FROM authorized a
         LEFT JOIN messages m ON m.conversation_key = a.conversation_key
         LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = ?
        GROUP BY a.conversation_key, a.kind, a.slug, a.name
        ORDER BY last_at DESC`,
      [fresh.id, fresh.role, fresh.id, fresh.role, fresh.username, fresh.id],
    )
    const team_conversations = teamResult.rows.map(r => ({
      conversation_key: r.conversation_key,
      kind: r.kind,
      slug: r.slug,
      name: r.name,
      last_text: r.last_text || '',
      last_from: r.last_from || '',
      unread: Number(r.unread) || 0,
      last_at: r.last_at || null,
    }))

    return jsonResponse({ conversations: out, team_conversations })
  }

  // POST /api/chat/seen — mark a conversation's incoming messages as seen.
  if (path === '/api/chat/seen' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const conv = await getConversation(env, fresh, body.peer, body.group, body.department)
    if (conv.error) return errorResponse(conv.error, conv.code)
    await query(
      env,
      `INSERT INTO message_reads (message_id, user_id, read_at)
       SELECT id, ?, ?
         FROM messages
        WHERE conversation_key=? AND sender_username != ?
       ON CONFLICT(message_id, user_id) DO UPDATE SET read_at=excluded.read_at`,
      [fresh.id, new Date().toISOString(), conv.key, fresh.username],
    )
    return jsonResponse({ ok: true })
  }

  // GET /api/chat/media/:messageId — signed URL for a chat photo (participants only).
  if (/^\/api\/chat\/media\/[^/]+$/.test(path) && method === 'GET') {
    const fresh = await requireMember(env, user)
    const msgId = path.split('/')[4]
    const m = await query(env, 'SELECT conversation_key, sender_username, media_key FROM messages WHERE id=? AND media_key IS NOT NULL', [msgId])
    if (!m.rows[0]) return errorResponse('not found', 404)
    if (!(await canAccessConversation(env, fresh, m.rows[0].conversation_key))) return errorResponse('forbidden', 403)
    const url = await mediaUrlOrNull(env, m.rows[0].media_key, 3600)
    if (!url) return errorResponse('media storage unavailable', 503)
    return jsonResponse({ url })
  }

  // POST /api/presence/heartbeat
  if (path === '/api/presence/heartbeat' && method === 'POST') {
    const fresh = await requireMember(env, user)
    await query(env, 'UPDATE users SET last_seen=? WHERE id=?', [new Date().toISOString(), fresh.id])
    return jsonResponse({ ok: true, server_time: new Date().toISOString() })
  }

  // GET /api/presence
  if (path === '/api/presence' && method === 'GET') {
    await requireMember(env, user)
    const cutoff = new Date(Date.now() - 90_000).toISOString()
    const { rows } = await query(
      env,
      `SELECT username, last_seen, verified, CASE WHEN last_seen >= ? THEN 1 ELSE 0 END AS online
         FROM users ORDER BY last_seen DESC LIMIT 100`,
      [cutoff],
    )
    rows.forEach(r => { r.online = !!r.online; r.verified = !!r.verified })
    return jsonResponse({ users: rows, server_time: new Date().toISOString() })
  }

  // POST /api/groups/:slug/invite
  if (/^\/api\/groups\/[^/]+\/invite$/.test(path) && method === 'POST') {
    const fresh = await requireMember(env, user)
    const slug = path.split('/')[3]
    const g = await query(env, 'SELECT id FROM groups WHERE slug=?', [slug])
    if (!g.rows[0]) return errorResponse('group not found', 404)
    const ga = await query(env, `SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'`, [g.rows[0].id, fresh.id])
    if (fresh.role !== 'admin' && !ga.rows[0]) return errorResponse('group admin required', 403)
    const body = await readJson(request)
    const targetName = cleanUsername(body.targetUsername)
    if (!targetName) return errorResponse('targetUsername required', 400)
    const target = await query(env, 'SELECT id, username FROM users WHERE username=?', [targetName])
    if (!target.rows[0]) return errorResponse('target user not found', 404)
    const id = crypto.randomUUID()
    await query(
      env,
      `INSERT INTO group_invites (id, group_id, invited_username, invited_user_id, inviter_id, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)`,
      [id, g.rows[0].id, target.rows[0].username, target.rows[0].id, fresh.id, new Date().toISOString()],
    )
    return jsonResponse({ id, status: 'pending' }, 201)
  }

  // POST /api/groups/:slug/invites/:id/approve
  if (/^\/api\/groups\/[^/]+\/invites\/[^/]+\/approve$/.test(path) && method === 'POST') {
    const fresh = await requireMember(env, user)
    const parts = path.split('/')
    const inviteId = parts[5]
    const body = await readJson(request)
    const approve = body.approve !== false
    const inv = await query(env, 'SELECT * FROM group_invites WHERE id=?', [inviteId])
    if (!inv.rows[0]) return errorResponse('not found', 404)
    if (inv.rows[0].status !== 'pending') return errorResponse(`already ${inv.rows[0].status}`, 409)
    const ga = await query(env, `SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND role='admin'`, [inv.rows[0].group_id, fresh.id])
    if (fresh.role !== 'admin' && !ga.rows[0]) return errorResponse('group admin required', 403)
    const status = approve ? 'approved' : 'rejected'
    await query(env, `UPDATE group_invites SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`, [status, fresh.id, new Date().toISOString(), inviteId])
    if (approve && inv.rows[0].invited_user_id) {
      await query(env, 'INSERT INTO group_members (group_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', [inv.rows[0].group_id, inv.rows[0].invited_user_id])
    }
    return jsonResponse({ ok: true, status })
  }

  return null
}
