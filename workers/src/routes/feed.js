// Port of server/src/routes/feed.js (pg → D1).
// The SQL rank expression is preserved; eng_max is computed in JS (same math as rank.js).
import { query, bool } from '../lib/db.js'
import { jsonResponse, searchParams, errorResponse, readJson } from '../lib/http.js'
import { requireMember } from '../lib/auth.js'
import { mediaUrlOrNull } from '../lib/media.js'

// SQL scoring mirror (score = 0.45*exp(-h/72) + 0.25*engNorm + 0.20*affinity + 0.10*verified + pinned)
function scoreOne({ created_at, likes = 0, comments = 0, group_name, constituency, faith, verified, is_pinned }, viewer, maxEngRaw) {
  const h = (Date.now() - new Date(created_at).getTime()) / 3600000
  const recency = Math.exp(-h / 72)
  const engRaw = Math.log(1 + (likes || 0) + (comments || 0) * 3)
  const engNorm = maxEngRaw > 0 ? engRaw / maxEngRaw : 0
  const affinity = group_name && viewer?.group_name && group_name === viewer.group_name ? 0.5
    : constituency && viewer?.constituency && constituency === viewer.constituency ? 0.3
    : faith && viewer?.faith && faith === viewer.faith ? 0.2 : 0
  const pinnedBoost = is_pinned ? 1000 : 0
  return 0.45 * recency + 0.25 * engNorm + 0.20 * affinity + 0.10 * (verified ? 1 : 0) + pinnedBoost
}

export async function handleFeed(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const qp = searchParams(url)
  const user = ctx.user

  // GET /api/feed?offset=&limit=
  if (path === '/api/feed' && request.method === 'GET') {
    const limit = Math.min(parseInt(qp.limit || '20', 10), 50)
    const offset = parseInt(qp.offset || '0', 10)
    let viewer = null
    if (user?.id) {
      const r = await query(env, 'SELECT group_name, constituency, faith FROM users WHERE id=?', [user.id])
      viewer = r.rows[0] || null
    }
    // Union posts + reels (approved), rank in JS (identical math to the pg SQL version).
    const posts = await query(
      env,
      `SELECT p.id, p.user_id, u.username, u.name, COALESCE(u.verified, p.verified_snapshot, 0) AS verified,
              p.caption, p.thumb_key, p.blurhash, p.original_key, p.likes, p.comments, p.created_at,
              p.is_pinned, p.group_name, p.constituency, p.faith, 'post' AS kind
         FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.approved_at IS NOT NULL`,
    )
    const reels = await query(
      env,
      `SELECT r.id, r.user_id, u.username, u.name, COALESCE(u.verified, r.verified_snapshot, 0) AS verified,
              r.caption, r.poster_key AS thumb_key, NULL AS blurhash, r.hls_master_key AS original_key,
              r.likes, r.comments, r.created_at, r.is_pinned, r.group_name, r.constituency, r.faith, 'reel' AS kind
         FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.approved_at IS NOT NULL`,
    )
    const items = [...posts.rows, ...reels.rows].map(r => bool(r, 'verified', 'is_pinned'))
    const maxEngRaw = Math.max(...items.map(i => Math.log(1 + (i.likes || 0) + (i.comments || 0) * 3)), 0)
    const ranked = items
      .map(i => ({ ...i, rank_score: scoreOne(i, viewer, maxEngRaw) }))
      .sort((a, b) => b.rank_score - a.rank_score || new Date(b.created_at) - new Date(a.created_at))
      .slice(offset, offset + limit)

    const enriched = await Promise.all(ranked.map(async r => ({
      ...r,
      thumb_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 900),
      hls_url: r.kind === 'reel' ? await mediaUrlOrNull(env, r.original_key, 900) : null,
    })))

    // stories top strip
    let stories = []
    try {
      const s = await query(
        env,
        `SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.original_key, s.expires_at, COALESCE(s.media_type, 'image') AS media_type, s.created_at
           FROM stories s JOIN users u ON u.id = s.user_id
          WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 30`,
        [new Date().toISOString()],
      )
      stories = await Promise.all(s.rows.map(async x => ({ ...x, thumb_url: await mediaUrlOrNull(env, x.thumb_key || x.original_key, 600), video_url: await mediaUrlOrNull(env, x.original_key, 1800) })))
    } catch {}
    const nextOffset = offset + limit
    return jsonResponse({ posts: enriched, stories, nextOffset, hasMore: enriched.length === limit })
  }

  // GET /api/stories
  if (path === '/api/stories' && request.method === 'GET') {
    const { rows } = await query(
      env,
      `SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.original_key, s.expires_at, COALESCE(s.media_type, 'image') AS media_type
         FROM stories s JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 50`,
      [new Date().toISOString()],
    )
    const out = await Promise.all(rows.map(async r => ({ ...r, thumb_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 600) })))
    return jsonResponse({ stories: out })
  }

  // GET /api/reels?offset=&limit=
  if (path === '/api/reels' && request.method === 'GET') {
    const limit = Math.min(parseInt(qp.limit || '20', 10), 50)
    const offset = parseInt(qp.offset || '0', 10)
    const { rows } = await query(
      env,
      `SELECT r.*, u.username, u.verified FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.approved_at IS NOT NULL ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    )
    const out = await Promise.all(rows.map(async r => ({
      ...bool(r, 'verified', 'is_pinned'),
      hls_url: await mediaUrlOrNull(env, r.hls_master_key || r.poster_key, 900),
      poster_url: await mediaUrlOrNull(env, r.poster_key, 900),
    })))
    return jsonResponse({ reels: out, nextOffset: offset + limit })
  }

  // GET /api/music
  if (path === '/api/music' && request.method === 'GET') {
    const limit = Math.min(parseInt(qp.limit || '50', 10), 100)
    try {
      const { rows } = await query(
        env,
        `SELECT t.id, t.user_id, u.username AS uploaded_by, u.verified, t.title, t.artist, t.original_key, t.cover_thumb_key, t.created_at
           FROM tracks t JOIN users u ON u.id = t.user_id
          ORDER BY t.created_at DESC LIMIT ?`,
        [limit],
      )
      const out = await Promise.all(rows.map(async r => ({
        id: r.id,
        title: r.title,
        artist: r.artist || r.uploaded_by || 'Harvest Worship',
        uploaded_by: r.uploaded_by,
        verified: !!r.verified,
        type: 'worship',
        url: await mediaUrlOrNull(env, r.original_key, 3600),
        cover_url: await mediaUrlOrNull(env, r.cover_thumb_key, 3600),
        created_at: r.created_at,
      })))
      return jsonResponse({ tracks: out })
    } catch {
      return jsonResponse({ tracks: [] })
    }
  }

  // ── Comments ──────────────────────────────────────────────
  // GET /api/comments?scope=post|reel&id=<id> — newest last.
  if (path === '/api/comments' && request.method === 'GET') {
    await requireMember(env, user)
    const scope = qp.scope === 'reel' ? 'reel' : 'post'
    const id = String(qp.id || '').slice(0, 64)
    if (!id) return errorResponse('id required', 400)
    const { rows } = await query(
      env,
      `SELECT c.id, c.username, c.body, c.created_at, u.verified
         FROM post_comments c LEFT JOIN users u ON u.username = c.username
        WHERE c.scope=? AND c.post_id=? ORDER BY c.created_at ASC LIMIT 200`,
      [scope, id],
    )
    rows.forEach(r => { r.verified = !!r.verified })
    return jsonResponse({ comments: rows })
  }

  // POST /api/comments { scope, id, body }
  if (path === '/api/comments' && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const scope = body.scope === 'reel' ? 'reel' : 'post'
    const targetId = String(body.id || '').slice(0, 64)
    const text = String(body.body || '').trim().slice(0, 1000)
    if (!targetId || !text) return errorResponse('id and body required', 400)
    const target = scope === 'reel'
      ? await query(env, 'SELECT id FROM reels WHERE id=? AND approved_at IS NOT NULL', [targetId])
      : await query(env, 'SELECT id FROM posts WHERE id=? AND approved_at IS NOT NULL', [targetId])
    if (!target.rows[0]) return errorResponse('post not found', 404)
    const cid = crypto.randomUUID()
    await query(
      env,
      `INSERT INTO post_comments (id, post_id, scope, user_id, username, body) VALUES (?,?,?,?,?,?)`,
      [cid, targetId, scope, fresh.id, fresh.username, text],
    )
    const col = scope === 'reel' ? 'reels' : 'posts'
    await query(env, `UPDATE ${col} SET comments = comments + 1 WHERE id=?`, [targetId])
    return jsonResponse({ comment: { id: cid, username: fresh.username, body: text, created_at: new Date().toISOString(), verified: !!fresh.verified } }, 201)
  }

  // DELETE /api/comments/:id — author or admin.
  if (/^\/api\/comments\/[^/]+$/.test(path) && request.method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const cid = path.split('/')[3]
    const c = await query(env, 'SELECT id, username, post_id, scope FROM post_comments WHERE id=?', [cid])
    if (!c.rows[0]) return errorResponse('not found', 404)
    if (c.rows[0].username !== fresh.username && fresh.role !== 'admin') return errorResponse('forbidden', 403)
    await query(env, 'DELETE FROM post_comments WHERE id=?', [cid])
    const col = c.rows[0].scope === 'reel' ? 'reels' : 'posts'
    await query(env, `UPDATE ${col} SET comments = MAX(comments - 1, 0) WHERE id=?`, [c.rows[0].post_id])
    return jsonResponse({ ok: true })
  }

  // ── Story views (Instagram-style) ─────────────────────────
  // POST /api/stories/:id/view — record a view (fire-and-forget from client).
  if (/^\/api\/stories\/[^/]+\/view$/.test(path) && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const sid = path.split('/')[3]
    const exists = await query(env, 'SELECT 1 FROM stories WHERE id=?', [sid])
    if (!exists.rows[0]) return errorResponse('story not found', 404)
    await query(env, 'INSERT OR IGNORE INTO story_views (story_id, viewer_username) VALUES (?,?)', [sid, fresh.username])
    return jsonResponse({ ok: true })
  }

  // GET /api/stories/:id/views — owner or admin sees the viewer list.
  if (/^\/api\/stories\/[^/]+\/views$/.test(path) && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const sid = path.split('/')[3]
    const s = await query(env, 'SELECT user_id FROM stories WHERE id=?', [sid])
    if (!s.rows[0]) return errorResponse('not found', 404)
    const owner = await query(env, 'SELECT username, role FROM users WHERE id=?', [s.rows[0].user_id])
    if (owner.rows[0]?.username !== fresh.username && fresh.role !== 'admin') return errorResponse('forbidden', 403)
    const { rows } = await query(
      env,
      `SELECT v.viewer_username AS username, u.name, u.verified, v.viewed_at
         FROM story_views v LEFT JOIN users u ON u.username = v.viewer_username
        WHERE v.story_id=? ORDER BY v.viewed_at DESC LIMIT 200`,
      [sid],
    )
    rows.forEach(r => { r.verified = !!r.verified })
    return jsonResponse({ views: rows, count: rows.length })
  }

  return null
}
