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
              p.caption, p.music_track_id, p.thumb_key, p.blurhash, p.original_key, p.likes, p.comments, p.created_at,
              p.is_pinned, p.group_name, p.constituency, p.faith, 'post' AS kind
         FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.approved_at IS NOT NULL`,
    )
    const reels = await query(
      env,
      `SELECT r.id, r.user_id, u.username, u.name, COALESCE(u.verified, r.verified_snapshot, 0) AS verified,
              r.caption, r.music_track_id, r.poster_key AS thumb_key, NULL AS blurhash, r.hls_master_key AS original_key,
              r.likes, r.comments, r.created_at, r.is_pinned, r.group_name, r.constituency, r.faith, 'reel' AS kind
         FROM reels r JOIN users u ON u.id = r.user_id
        WHERE r.approved_at IS NOT NULL`,
    )
    const items = await Promise.all([...posts.rows, ...reels.rows].map(async r => {
      const normalized = bool(r, 'verified', 'is_pinned')
      const liked = user?.id
        ? Boolean((await query(env, 'SELECT 1 FROM post_likes WHERE user_id=? AND scope=? AND post_id=?', [user.id, r.kind, r.id])).rows[0])
        : false
      return { ...normalized, liked }
    }))
    const maxEngRaw = Math.max(...items.map(i => Math.log(1 + (i.likes || 0) + (i.comments || 0) * 3)), 0)
    const ranked = items
      .map(i => ({ ...i, rank_score: scoreOne(i, viewer, maxEngRaw) }))
      .sort((a, b) => b.rank_score - a.rank_score || new Date(b.created_at) - new Date(a.created_at))
      .slice(offset, offset + limit)

    const enriched = await Promise.all(ranked.map(async r => ({
      ...r,
      // Reels: thumb_url must be a POSTER image, never the video itself —
      // falling back to original_key gave clients a video URL as "thumbnail",
      // which rendered broken <img> tiles or WebView's giant play glyph.
      thumb_url: r.kind === 'reel'
        ? await mediaUrlOrNull(env, r.thumb_key, 900)
        : await mediaUrlOrNull(env, r.thumb_key || r.original_key, 900),
      hls_url: r.kind === 'reel' ? await mediaUrlOrNull(env, r.original_key, 900) : null,
      music: r.music_track_id ? await (async () => { const t = await query(env, 'SELECT id,title,artist,original_key,cover_thumb_key FROM tracks WHERE id=?',[r.music_track_id]); const x=t.rows[0]; return x ? { id:x.id,title:x.title,artist:x.artist,url:await mediaUrlOrNull(env,x.original_key,3600),cover_url:await mediaUrlOrNull(env,x.cover_thumb_key,3600) } : null })() : null,
    })))

    // stories top strip
    let stories = []
    try {
      const s = await query(
        env,
        `SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.original_key, s.expires_at, s.caption, s.music_track_id, COALESCE(s.media_type, 'image') AS media_type, s.created_at,
                  CASE WHEN ? IS NOT NULL AND EXISTS (
                    SELECT 1 FROM story_views sv
                     WHERE sv.story_id = s.id
                       AND (sv.viewer_user_id = ? OR (sv.viewer_user_id IS NULL AND sv.viewer_username = u2.username))
                  ) THEN 1 ELSE 0 END AS viewed
           FROM stories s JOIN users u ON u.id = s.user_id
          LEFT JOIN users u2 ON u2.id = ?
          WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 30`,
        [user?.id || null, user?.id || null, user?.id || null, new Date().toISOString()],
      )
      stories = await Promise.all(s.rows.map(async x => ({ ...x, music: x.music_track_id ? await (async () => { const t=await query(env,'SELECT id,title,artist,original_key,cover_thumb_key FROM tracks WHERE id=?',[x.music_track_id]); const z=t.rows[0]; return z ? {id:z.id,title:z.title,artist:z.artist,url:await mediaUrlOrNull(env,z.original_key,3600),cover_url:await mediaUrlOrNull(env,z.cover_thumb_key,3600)} : null })() : null, thumb_url: await mediaUrlOrNull(env, x.thumb_key || (String(x.media_type) === 'video' ? null : x.original_key), 600), video_url: await mediaUrlOrNull(env, x.original_key, 1800) })))
    } catch {}
    const nextOffset = offset + limit
    return jsonResponse({ posts: enriched, stories, nextOffset, hasMore: enriched.length === limit })
  }

  // GET /api/stories
  if (path === '/api/stories' && request.method === 'GET') {
    const { rows } = await query(
      env,
      `SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.original_key, s.expires_at, s.caption, s.music_track_id, COALESCE(s.media_type, 'image') AS media_type,
                CASE WHEN ? IS NOT NULL AND EXISTS (
                  SELECT 1 FROM story_views sv
                   WHERE sv.story_id = s.id
                     AND (sv.viewer_user_id = ? OR (sv.viewer_user_id IS NULL AND sv.viewer_username = u2.username))
                ) THEN 1 ELSE 0 END AS viewed
         FROM stories s JOIN users u ON u.id = s.user_id
         LEFT JOIN users u2 ON u2.id = ?
        WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 50`,
      [user?.id || null, user?.id || null, user?.id || null, new Date().toISOString()],
    )
    const out = await Promise.all(rows.map(async r => ({ ...r,
      thumb_url: await mediaUrlOrNull(env, r.thumb_key || (String(r.media_type) === 'video' ? null : r.original_key), 600),
      video_url: String(r.media_type) === 'video' ? await mediaUrlOrNull(env, r.original_key, 1800) : null,
    })))
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
      // Never expose the poster image as a video URL. If transcoding has
      // not produced an HLS key yet, the client should show the poster/fallback
      // instead of trying to decode an image as video.
      hls_url: r.hls_master_key ? await mediaUrlOrNull(env, r.hls_master_key, 900) : null,
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

  // ── Persistent likes ─────────────────────────────────────
  // GET /api/likes?scope=post|reel&id=<id>
  if (path === '/api/likes' && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const scope = qp.scope === 'reel' ? 'reel' : 'post'
    const id = String(qp.id || '').slice(0, 64)
    if (!id) return errorResponse('id required', 400)
    const table = scope === 'reel' ? 'reels' : 'posts'
    const target = await query(env, `SELECT id, likes FROM ${table} WHERE id=? AND approved_at IS NOT NULL`, [id])
    if (!target.rows[0]) return errorResponse('post not found', 404)
    const mine = await query(env, 'SELECT 1 FROM post_likes WHERE user_id=? AND scope=? AND post_id=?', [fresh.id, scope, id])
    return jsonResponse({ id, scope, likes: Number(target.rows[0].likes) || 0, liked: !!mine.rows[0] })
  }

  // POST /api/likes { scope, id } — toggles the current member's like.
  if (path === '/api/likes' && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const scope = body.scope === 'reel' ? 'reel' : 'post'
    const id = String(body.id || '').slice(0, 64)
    if (!id) return errorResponse('id required', 400)
    const table = scope === 'reel' ? 'reels' : 'posts'
    const target = await query(env, `SELECT id FROM ${table} WHERE id=? AND approved_at IS NOT NULL`, [id])
    if (!target.rows[0]) return errorResponse('post not found', 404)
    const existing = await query(env, 'SELECT 1 FROM post_likes WHERE user_id=? AND scope=? AND post_id=?', [fresh.id, scope, id])
    let liked
    if (existing.rows[0]) {
      await query(env, 'DELETE FROM post_likes WHERE user_id=? AND scope=? AND post_id=?', [fresh.id, scope, id])
      await query(env, `UPDATE ${table} SET likes=MAX(likes-1,0) WHERE id=?`, [id])
      liked = false
    } else {
      await query(env, 'INSERT INTO post_likes (user_id, scope, post_id) VALUES (?,?,?)', [fresh.id, scope, id])
      await query(env, `UPDATE ${table} SET likes=likes+1 WHERE id=?`, [id])
      liked = true
    }
    const current = await query(env, `SELECT likes FROM ${table} WHERE id=?`, [id])
    return jsonResponse({ id, scope, liked, likes: Number(current.rows[0]?.likes) || 0 })
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
    if (!target.rows[0]) return errorResponse(scope === 'reel' ? 'reel not found' : 'post not found', 404)
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
    const c = await query(env, 'SELECT id, user_id, username, post_id, scope FROM post_comments WHERE id=?', [cid])
    if (!c.rows[0]) return errorResponse('not found', 404)
    const ownsComment = c.rows[0].user_id ? c.rows[0].user_id === fresh.id : c.rows[0].username === fresh.username
    if (!ownsComment && fresh.role !== 'admin') return errorResponse('forbidden', 403)
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
    const viewedAt = new Date().toISOString()
    await query(env, `INSERT INTO story_views (story_id, viewer_username, viewer_user_id, viewed_at)
                     VALUES (?,?,?,?)
                     ON CONFLICT(viewer_user_id, story_id) DO UPDATE SET
                       viewer_username=excluded.viewer_username,
                       viewed_at=excluded.viewed_at`, [sid, fresh.username, fresh.id, viewedAt])
    return jsonResponse({ ok: true, storyId: sid, viewed: true, viewedAt })
  }

  // ── Self-delete (Instagram-style) ─────────────────────────
  // DELETE /api/posts/:id | /api/reels/:id | /api/stories/:id — the author or an
  // admin removes their own content. Cleans R2 objects + dependent rows (likes
  // counters, comments) that have no FK to these tables.
  const delMatch = path.match(/^\/api\/(posts|reels|stories)\/([0-9a-f-]+)$/i)
  if (delMatch && request.method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const kind = delMatch[1].toLowerCase()
    const id = delMatch[2]
    const table = kind // 'posts' | 'reels' | 'stories' — matches table names
    const keyCols = {
      posts: ['original_key', 'thumb_key'],
      reels: ['hls_master_key', 'poster_key', 'thumb_key'],
      stories: ['original_key', 'thumb_key'],
    }
    const row = await query(env, `SELECT * FROM ${table} WHERE id=?`, [id])
    if (!row.rows[0]) return errorResponse('not found', 404)
    const isOwner = row.rows[0].user_id === fresh.id
    if (!isOwner && fresh.role !== 'admin') return errorResponse('you can only delete your own posts', 403)
    // R2 objects first (best-effort), then dependent rows, then the row itself.
    for (const col of keyCols[kind]) {
      const key = row.rows[0][col]
      if (key && typeof key === 'string') { try { await env.MEDIA.delete(key) } catch {} }
    }
    // post_comments has no FK — clean up explicitly. likes has no FK to posts either.
    await query(env, 'DELETE FROM post_comments WHERE scope=? AND post_id=?', [kind === 'reels' ? 'reel' : 'post', id])
    await query(env, 'DELETE FROM post_likes WHERE post_id=? AND scope=?', [id, kind === 'reels' ? 'reel' : 'post'])
    await query(env, 'DELETE FROM story_views WHERE story_id=?', [id])
    await query(env, `DELETE FROM ${table} WHERE id=?`, [id])
    return jsonResponse({ ok: true, deleted: id, kind })
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
