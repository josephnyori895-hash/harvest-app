// Tagged members and @mentions on a new post.
//
// Instagram's post has two related ways to name someone: the "Tag people"
// list and an @handle typed into the caption. Both mean the same thing to the
// member being named, so both resolve to one notification and one stored list.
// Everything here is best-effort — a notification must never fail a publish.
import { query } from './db.js'
import { recordNotificationsSafe } from './notif.js'

const HANDLE = /^[a-z0-9._-]{2,32}$/
const MENTION_RE = /@([a-z0-9._-]{2,32})/gi
const MAX_TAGS = 20

function cleanHandle(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '')
}

/** The stored form: a deduplicated, validated-looking username array. */
export function normaliseTagged(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',')
  const seen = new Set()
  for (const item of list) {
    const handle = cleanHandle(item)
    if (HANDLE.test(handle)) seen.add(handle)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

/** Optional location label. Kept short and plain text — it is shown under the
 *  username exactly like Instagram's location line. */
export function normaliseLocation(raw) {
  const value = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  return value ? value.slice(0, 120) : null
}

/** Every handle named by the post: explicit tags plus caption mentions. */
export function collectHandles(tagged, caption) {
  const handles = new Set(normaliseTagged(tagged))
  for (const match of String(caption || '').matchAll(MENTION_RE)) {
    if (handles.size >= MAX_TAGS) break
    handles.add(cleanHandle(match[1]))
  }
  return [...handles]
}

/** Notify the members named on a published post. `author` is the fresh user
 *  row (id, username, name); self-tags are silently dropped. */
export async function notifyPostTags(env, author, { caption, tagged, postId, kind = 'post' }) {
  try {
    const handles = collectHandles(tagged, caption)
    if (!handles.length || !author?.id) return 0
    const marks = handles.map(() => '?').join(',')
    const { rows } = await query(
      env,
      `SELECT id, username FROM users WHERE username IN (${marks}) AND COALESCE(active,1)=1`,
      handles,
    )
    const recipients = rows.filter(row => row.id && row.id !== author.id)
    if (!recipients.length) return 0
    const who = author.name || `@${author.username}`
    return await recordNotificationsSafe(env, recipients.map(row => ({
      userId: row.id,
      type: 'mention',
      category: 'all',
      title: who,
      body: `${who} tagged you in a ${kind === 'reel' ? 'reel' : 'post'}.`,
      preview: kind === 'reel' ? 'Reel mention' : 'Post mention',
      target: { type: 'mention', scope: kind, id: postId, actor_user_id: author.id },
    })))
  } catch {
    return 0
  }
}
