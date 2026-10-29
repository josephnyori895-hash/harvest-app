// Port of server/src/routes/feed.js (pg → D1).
// The SQL rank expression is preserved; eng_max is computed in JS (same math as rank.js).
import { query, bool } from '../lib/db.js'
import { jsonResponse, searchParams, errorResponse, readJson } from '../lib/http.js'
import { requireMember } from '../lib/auth.js'
import { hasCap } from '../lib/capabilities.js'
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
  // Members-only: this endpoint carries member names + captions; the app has
  // no guest mode, so anonymous reads here are pure data exposure.
  if (path === '/api/feed' && request.method === 'GET') {
    await requireMember(env, user)
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
    const projectRows = await query(env, `SELECT p.id,p.name,p.description,p.goal_kes,p.deadline,p.status,p.icon,p.created_at,
      COALESCE((SELECT SUM(pc.amount_kes) FROM project_contributions pc WHERE pc.project_id=p.id),0) AS raised_kes,
      COALESCE((SELECT SUM(pp.commitment_kes) FROM project_participants pp WHERE pp.project_id=p.id),0) AS committed_kes,
      (SELECT COUNT(*) FROM project_participants pp WHERE pp.project_id=p.id) AS participants
      FROM projects p
      WHERE p.status='active' AND p.auto_advertise=1
        AND (p.advertise_from IS NULL OR p.advertise_from <= ?)
        AND (p.advertise_until IS NULL OR p.advertise_until >= ?)
      ORDER BY p.updated_at DESC LIMIT 3`, [new Date().toISOString(), new Date().toISOString()])

    // Saved set for the bookmark toggles — one query, Set lookup per item.
    const savedSet = user?.id
      ? new Set((await query(env, 'SELECT post_id FROM saved_posts WHERE user_id=?', [user.id])).rows.map(x => String(x.post_id)))
      : new Set()
    const items = await Promise.all([...posts.rows, ...reels.rows].map(async r => {
      const normalized = bool(r, 'verified', 'is_pinned')
      const liked = user?.id
        ? Boolean((await query(env, 'SELECT 1 FROM post_likes WHERE user_id=? AND scope=? AND post_id=?', [user.id, r.kind, r.id])).rows[0])
        : false
      return { ...normalized, liked, saved: savedSet.has(String(r.id)) }
    }))
    const projects = projectRows.rows.map(p => ({
      id: p.id, kind: 'project', username: 'harvest_family', name: p.name, verified: true,
      caption: p.description || 'Give with purpose and help us complete this project.',
      created_at: p.created_at, likes: 0, comments: 0, group_name: 'Harvest Family Church',
      project: { id:p.id, name:p.name, description:p.description || '', goal_kes:Number(p.goal_kes)||0, raised_kes:Number(p.raised_kes)||0, committed_kes:Number(p.committed_kes)||0, participants:Number(p.participants)||0, deadline:p.deadline, status:p.status, icon:p.icon || '🤲' }
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
    // Sponsored adverts: server-side interleaving + per-member daily caps.
    // Adverts are counted as SERVED at feed render — the two-appearance cap
    // (advert_settings.daily_cap) is enforced here, so refreshes or extra
    // devices cannot extract more appearances than the cap allows.
    let contentRows = []
    try { contentRows = (await query(env, "SELECT key, value FROM site_content WHERE key IN ('sponsor_adverts','advert_settings')")).rows } catch {}
    const contentMap = new Map(contentRows.map(r => [String(r.key), String(r.value ?? '')]))
    const parseJsonSafe = (raw, fallback) => { try { const v = JSON.parse(raw); return v ?? fallback } catch { return fallback } }
    const settings = parseJsonSafe(contentMap.get('advert_settings'), null) || {}
    const placement = String(settings.placement || 'feed')
    const interval = Number.isInteger(Number(settings.interval)) ? Number(settings.interval) : 6
    const dailyCap = Number.isInteger(Number(settings.daily_cap)) ? Number(settings.daily_cap) : 2
    const allAdverts = placement !== 'none' && interval >= 1 ? parseJsonSafe(contentMap.get('sponsor_adverts'), []) : []
    const eligibleRaw = (Array.isArray(allAdverts) ? allAdverts : []).filter(ad =>
      ad && ad.enabled !== false && typeof ad.title === 'string' && ad.title.trim()
      && (String(ad.audience || 'all') !== 'members' || Boolean(user?.id)))
    let eligible = eligibleRaw
    let servedCounter = null
    if (user?.id) {
      const day = new Date().toISOString().slice(0, 10)
      const counts = (await query(env, 'SELECT advert_id, impressions FROM advert_impressions WHERE member_id=? AND day=?', [user.id, day])).rows
      const shown = new Map(counts.map(r => [String(r.advert_id), Number(r.impressions) || 0]))
      eligible = eligibleRaw.filter(ad => (shown.get(String(ad.id)) || 0) < dailyCap)
      servedCounter = { user: user.id, day, shown }
    }
    // Page build: organic posts keep their order; a sponsored advert slots in
    // after every `interval` organic items, members' caps willing.
    let ai = 0
    const pagePosts = []
    let organicSinceAd = 0
    for (const item of enriched) {
      pagePosts.push(item)
      organicSinceAd += 1
      if (organicSinceAd % interval === 0 && ai < eligible.length) {
        const ad = eligible[ai++]
        pagePosts.push({
          id: `advert_${ad.id}`, kind: 'advert', advert_id: ad.id,
          name: 'Harvest Family', verified: true,
          caption: ad.body || ad.title, title: ad.title, body: ad.body || '',
          cta_url: ad.cta_url || null, image_url: ad.image_url || null,
        })
      }
    }
    if (servedCounter && ai > 0) {
      const day = servedCounter.day
      for (const ad of eligible.slice(0, ai)) {
        await query(
          env,
          `INSERT INTO advert_impressions (advert_id, member_id, day, impressions, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(advert_id, member_id, day) DO UPDATE SET impressions = impressions + 1, updated_at = excluded.updated_at`,
          [String(ad.id), servedCounter.user, day, 1, new Date().toISOString()],
        )
      }
    }

    const nextOffset = offset + limit
    return jsonResponse({ posts: pagePosts, projects, stories, nextOffset, hasMore: enriched.length === limit })
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
      music: r.music_track_id ? await (async () => {
        const t = await query(env, 'SELECT id,title,artist,original_key,cover_thumb_key FROM tracks WHERE id=?', [r.music_track_id])
        const x = t.rows[0]
        return x ? { id: x.id, title: x.title, artist: x.artist, url: await mediaUrlOrNull(env, x.original_key, 3600), cover_url: await mediaUrlOrNull(env, x.cover_thumb_key, 3600) } : null
      })() : null,
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
      music: r.music_track_id ? await (async () => {
        const t = await query(env, 'SELECT id,title,artist,cover_thumb_key FROM tracks WHERE id=?', [r.music_track_id])
        const x = t.rows[0]
        return x ? {
          id: x.id,
          title: x.title,
          artist: x.artist || 'Harvest Worship',
          cover_url: await mediaUrlOrNull(env, x.cover_thumb_key, 3600),
        } : null
      })() : null,
    })))
    return jsonResponse({ reels: out, nextOffset: offset + rows.length, hasMore: rows.length === limit })
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
  // GET /api/comments?scope=post|reel&id=<id> — parents NEWEST FIRST (IG-style
  // ordering) with their replies nested right after. Per-viewer likes come
  // from comment_likes.
  if (path === '/api/comments' && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const scope = qp.scope === 'reel' ? 'reel' : 'post'
    const id = String(qp.id || '').slice(0, 64)
    if (!id) return errorResponse('id required', 400)
    const target = scope === 'reel'
      ? await query(env, 'SELECT id FROM reels WHERE id=? AND approved_at IS NOT NULL', [id])
      : await query(env, 'SELECT id FROM posts WHERE id=? AND approved_at IS NOT NULL', [id])
    if (!target.rows[0]) return errorResponse(scope === 'reel' ? 'reel not found' : 'post not found', 404)
    const { rows } = await query(
      env,
      `SELECT c.id, c.username, c.body, c.created_at, c.parent_id,
              (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
              EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked,
              u.verified
         FROM post_comments c LEFT JOIN users u ON u.username = c.username
        WHERE c.scope=? AND c.post_id=? ORDER BY c.created_at DESC LIMIT 300`,
      [fresh.id, scope, id],
    )
    rows.forEach(r => { r.verified = !!r.verified; r.likes = Number(r.likes) || 0; r.liked = !!r.liked })
    return jsonResponse({ comments: rows })
  }

  // POST /api/comments { scope, id, body, parent_id? } — replies nest one level.
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
    let parentId = null
    if (body.parent_id) {
      const p = await query(env, 'SELECT id, post_id, scope, parent_id FROM post_comments WHERE id=?', [String(body.parent_id).slice(0, 64)])
      const prow = p.rows[0]
      if (!prow || prow.post_id !== targetId || prow.scope !== scope || prow.parent_id) return errorResponse('invalid parent comment', 400)
      parentId = prow.id
    }
    const cid = crypto.randomUUID()
    await query(
      env,
      `INSERT INTO post_comments (id, post_id, scope, user_id, username, body, parent_id) VALUES (?,?,?,?,?,?,?)`,
      [cid, targetId, scope, fresh.id, fresh.username, text, parentId],
    )
    const col = scope === 'reel' ? 'reels' : 'posts'
    await query(env, `UPDATE ${col} SET comments = comments + 1 WHERE id=?`, [targetId])
    return jsonResponse({ comment: { id: cid, username: fresh.username, body: text, created_at: new Date().toISOString(), verified: !!fresh.verified, likes: 0, liked: false, parent_id: parentId } }, 201)
  }

  // POST /api/comments/:id/like — toggle; returns the fresh state.
  if (/^\/api\/comments\/[^/]+\/like$/.test(path) && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const cid = path.split('/')[3]
    const c = await query(env, 'SELECT id FROM post_comments WHERE id=?', [cid])
    if (!c.rows[0]) return errorResponse('not found', 404)
    const existing = await query(env, 'SELECT 1 AS one FROM comment_likes WHERE comment_id=? AND user_id=?', [cid, fresh.id])
    if (existing.rows[0]) {
      await query(env, 'DELETE FROM comment_likes WHERE comment_id=? AND user_id=?', [cid, fresh.id])
    } else {
      await query(env, 'INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?,?)', [cid, fresh.id])
    }
    const total = await query(env, 'SELECT COUNT(*) AS likes FROM comment_likes WHERE comment_id=?', [cid])
    return jsonResponse({ liked: !existing.rows[0], likes: Number(total.rows[0]?.likes) || 0 })
  }

  // DELETE /api/comments/:id — author, content author or admin. Replies go with
  // the parent; like rows are swept too, and the post counter follows the total.
  if (/^\/api\/comments\/[^/]+$/.test(path) && request.method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const cid = path.split('/')[3]
    const c = await query(env, 'SELECT id, user_id, username, post_id, scope FROM post_comments WHERE id=?', [cid])
    if (!c.rows[0]) return errorResponse('not found', 404)
    const ownsComment = c.rows[0].user_id ? c.rows[0].user_id === fresh.id : c.rows[0].username === fresh.username
    const contentTable = c.rows[0].scope === 'reel' ? 'reels' : 'posts'
    const content = await query(env, `SELECT user_id FROM ${contentTable} WHERE id=?`, [c.rows[0].post_id])
    const isContentAuthor = content.rows[0]?.user_id === fresh.id
    if (!ownsComment && !isContentAuthor && fresh.role !== 'admin') return errorResponse('forbidden', 403)
    const replies = await query(env, 'SELECT id FROM post_comments WHERE parent_id=?', [cid])
    for (const r of replies.rows) await query(env, 'DELETE FROM comment_likes WHERE comment_id=?', [r.id])
    await query(env, 'DELETE FROM comment_likes WHERE comment_id=?', [cid])
    await query(env, 'DELETE FROM post_comments WHERE id=? OR parent_id=?', [cid, cid])
    const col = c.rows[0].scope === 'reel' ? 'reels' : 'posts'
    await query(env, `UPDATE ${col} SET comments = MAX(comments - ?, 0) WHERE id=?`, [1 + (replies.rows.length || 0), c.rows[0].post_id])
    return jsonResponse({ ok: true })
  }

  // ── Story views (Instagram-style) ─────────────────────────
  // POST /api/stories/:id/view — record a view (fire-and-forget from client).
  if (/^\/api\/stories\/[^/]+\/view$/.test(path) && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const sid = path.split('/')[3]
    const exists = await query(env, 'SELECT 1 FROM stories WHERE id=? AND expires_at>?', [sid, new Date().toISOString()])
    if (!exists.rows[0]) return errorResponse('story not found', 404)
    const viewedAt = new Date().toISOString()
    await query(env, `INSERT INTO story_views (story_id, viewer_username, viewer_user_id, viewed_at)
                     VALUES (?,?,?,?)
                     ON CONFLICT(viewer_user_id, story_id) DO UPDATE SET
                       viewer_username=excluded.viewer_username,
                       viewed_at=excluded.viewed_at`, [sid, fresh.username, fresh.id, viewedAt])
    return jsonResponse({ ok: true, storyId: sid, viewed: true, viewedAt })
  }

  // ── Saved posts shelf ─────────────────────────────────────
  // POST/DELETE /api/posts/:id/save — bookmark toggle (mirrors /api/reels/:id/save).
  const saveMatch = path.match(/^\/api\/posts\/([^/]+)\/save$/)
  if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
    const fresh = await requireMember(env, user)
    const postId = saveMatch[1]
    if (request.method === 'POST') {
      const post = await query(env, 'SELECT id FROM posts WHERE id=? AND approved_at IS NOT NULL', [postId])
      if (!post.rows[0]) return errorResponse('post not found', 404)
      await query(env, 'INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?,?)', [fresh.id, postId])
      return jsonResponse({ ok: true, saved: true, post_id: postId })
    }
    await query(env, 'DELETE FROM saved_posts WHERE user_id=? AND post_id=?', [fresh.id, postId])
    return jsonResponse({ ok: true, saved: false, post_id: postId })
  }

  // GET /api/posts/saved — the member's saved shelf, newest save first.
  if (path === '/api/posts/saved' && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const limit = Math.min(Math.max(parseInt(qp.limit || '50', 10) || 50, 1), 100)
    const offset = Math.max(parseInt(qp.offset || '0', 10) || 0, 0)
    const { rows } = await query(
      env,
      `SELECT p.id, p.user_id, u.username, u.name, COALESCE(u.verified, p.verified_snapshot, 0) AS verified,
              p.caption, p.thumb_key, p.blurhash, p.original_key, p.likes, p.comments, p.created_at,
              p.music_track_id, sp.created_at AS saved_at
         FROM saved_posts sp
         JOIN posts p ON p.id = sp.post_id
         JOIN users u ON u.id = p.user_id
        WHERE sp.user_id=? AND p.approved_at IS NOT NULL
        ORDER BY sp.created_at DESC LIMIT ? OFFSET ?`,
      [fresh.id, limit, offset],
    )
    const out = await Promise.all(rows.map(async r => ({
      id: r.id, username: r.username, name: r.name, verified: !!r.verified,
      caption: r.caption || '', likes: Number(r.likes) || 0, comments: Number(r.comments) || 0,
      kind: 'post', created_at: r.created_at, saved_at: r.saved_at,
      thumb_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 900),
      music: r.music_track_id ? await (async () => {
        const t = await query(env, 'SELECT id,title,artist,original_key,cover_thumb_key FROM tracks WHERE id=?', [r.music_track_id])
        const x = t.rows[0]
        return x ? { id: x.id, title: x.title, artist: x.artist, url: await mediaUrlOrNull(env, x.original_key, 3600), cover_url: await mediaUrlOrNull(env, x.cover_thumb_key, 3600) } : null
      })() : null,
    })))
    return jsonResponse({ posts: out, nextOffset: offset + rows.length, hasMore: rows.length === limit })
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
    if (!isOwner && fresh.role !== 'admin' && !hasCap(fresh, 'delete_media')) return errorResponse('you can only delete your own posts', 403)
    // R2 objects first (best-effort), then dependent rows, then the row itself.
    for (const col of keyCols[kind]) {
      const key = row.rows[0][col]
      if (key && typeof key === 'string') { try { await env.MEDIA.delete(key) } catch {} }
    }
    // post_comments has no FK — clean up explicitly. likes has no FK to posts either.
    await query(env, 'DELETE FROM post_comments WHERE scope=? AND post_id=?', [kind === 'reels' ? 'reel' : 'post', id])
    await query(env, 'DELETE FROM post_likes WHERE post_id=? AND scope=?', [id, kind === 'reels' ? 'reel' : 'post'])
    await query(env, 'DELETE FROM saved_posts WHERE post_id=?', [id])
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
    const owner = await query(env, 'SELECT id, username, role FROM users WHERE id=?', [s.rows[0].user_id])
    if (owner.rows[0]?.id !== fresh.id && fresh.role !== 'admin') return errorResponse('forbidden', 403)
    const { rows } = await query(
      env,
      `SELECT COALESCE(u.username, v.viewer_username) AS username,
              u.name, u.verified, v.viewed_at
         FROM story_views v
         LEFT JOIN users u ON u.id = v.viewer_user_id
        WHERE v.story_id=?
        ORDER BY v.viewed_at DESC LIMIT 200`,
      [sid],
    )
    const total = await query(env, 'SELECT COUNT(*) AS count FROM story_views WHERE story_id=?', [sid])
    rows.forEach(r => { r.verified = !!r.verified })
    return jsonResponse({ views: rows, count: Number(total.rows[0]?.count) || 0 })
  }

  return null
}
