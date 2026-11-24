// In-app notification records for the bell panel (device push lives in fcm.js).
// One insert per recipient per event. Never throws — notifications are
// best-effort and must not break the caller's main flow (send, join, publish).
import { query, nowIso } from './db.js'

// 9 bound parameters per row; D1 rejects very large parameter lists, and a
// church-wide fan-out can address hundreds of members in one call.
const INSERT_CHUNK = 25
// Chat is a conversation, not an event feed: one unread bell row per
// conversation, replaced as messages arrive, instead of one row per message.
// Read history is left alone — opening the inbox still shows what happened.
const CHAT_TYPES = new Set(['chat', 'group_chat', 'department_chat'])

export function notificationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function chatConversation(record) {
  if (!CHAT_TYPES.has(String(record.type || ''))) return null
  const key = record.target?.conversation_key
  return key ? String(key) : null
}

// The conversation key is embedded in the JSON we store; LIKE wildcards inside
// the key itself must be escaped or a username could widen the match.
function targetLike(key) {
  const escaped = String(key).replace(/[\\%_]/g, ch => `\\${ch}`)
  return `%"conversation_key":"${escaped}"%`
}

async function replaceUnreadChatRow(env, record) {
  const key = chatConversation(record)
  if (!key) return
  await query(
    env,
    `DELETE FROM notifications
      WHERE user_id=? AND type=? AND read_at IS NULL AND target LIKE ? ESCAPE '\\'`,
    [String(record.userId), String(record.type), targetLike(key)],
  )
}

// records: [{ userId, type, category, title, body, preview, target }]
export async function recordNotifications(env, records, { live = true } = {}) {
  if (!Array.isArray(records) || !records.length) return 0
  // Several messages for the same conversation can land in one batch (a burst
  // replay, an announcement loop): keep the newest and collapse the rest.
  const lastChatRow = new Map()
  records.forEach((r, i) => {
    const key = r && r.userId ? chatConversation(r) : null
    if (key) lastChatRow.set(`${r.userId}|${r.type}|${key}`, i)
  })
  const list = records.filter((r, i) => {
    if (!r || !r.userId) return false
    const key = chatConversation(r)
    return !key || lastChatRow.get(`${r.userId}|${r.type}|${key}`) === i
  })
  if (!list.length) return 0

  const collapsed = new Set()
  for (const record of list) {
    const key = chatConversation(record)
    if (!key) continue
    const uniq = `${record.userId}|${record.type}|${key}`
    if (collapsed.has(uniq)) continue
    collapsed.add(uniq)
    try { await replaceUnreadChatRow(env, record) } catch { /* insert still tries */ }
  }

  const rows = list.map(r => [
    r.id || notificationId(),
    String(r.userId),
    String(r.category || 'all').slice(0, 32),
    String(r.type || 'general').slice(0, 32),
    String(r.title || '').slice(0, 140),
    String(r.body || '').slice(0, 400),
    r.preview ? String(r.preview).slice(0, 200) : null,
    r.target ? JSON.stringify(r.target).slice(0, 1000) : null,
    nowIso(),
  ])
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    await query(env,
      `INSERT INTO notifications (id, user_id, category, type, title, body, preview, target, created_at)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?)').join(', ')}`,
      chunk.flat(),
    )
    inserted += chunk.length
  }
  // Wake the recipient's open app so the bell badge updates immediately;
  // polling stays as the fallback when no socket is connected.
  if (live) await Promise.all(list.map(record => publishLive(env, record)))
  return inserted
}

async function publishLive(env, record) {
  if (!env?.REALTIME) return
  try {
    const stub = env.REALTIME.get(env.REALTIME.idFromName('singleton'))
    await stub.fetch('https://realtime.internal/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: record.userId, type: record.type, title: record.title, body: record.body }),
    })
  } catch { /* notification row is still saved; the client poll catches up */ }
}

// Tidy error text: notifications never break the main flow.
// `live=false` is used from inside the Realtime DO itself (chat notifications):
// that socket already receives the chat frame, and a nested fetch to the same
// Durable Object would be wasteful.
export async function recordNotificationsSafe(env, records, live = true) {
  try { return await recordNotifications(env, records, { live }) } catch { return 0 }
}
