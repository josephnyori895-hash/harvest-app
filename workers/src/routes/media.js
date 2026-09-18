// Port of server/src/routes/media.js (pg/Blobs → D1/R2).
import { query, uuid } from '../lib/db.js'
import { requireMember, requireAdmin } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, httpError } from '../lib/http.js'
import { presignedPost, validatePresign, isReadableKey, handleMediaRead, mediaUrlOrNull } from '../lib/media.js'
import { hasCap } from '../lib/capabilities.js'
const CAP_DELETE = 'delete_media'

const KEY_RE = /^originals\/(post|story|reel|track)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

async function audit(env, actor, action, targetType, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,?,?,?,?)`,
    [actor.id, actor.role, action, targetType, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

export async function handleMedia(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const user = ctx.user
  const method = request.method

  // GET|HEAD /api/media/* — signed-URL or member-authenticated reads from R2.
  // (img/video tags cannot send bearer tokens; the signed URL is the only way
  // thumbnails and posters render. See lib/media.js handleMediaRead.)
  if (path.startsWith('/api/media/') && (method === 'GET' || method === 'HEAD')) {
    try {
      return await handleMediaRead(request, env, ctx)
    } catch (e) {
      // Media reads fail silently in browsers (<img> just shows nothing), so
      // surface the reason in the response body + logs instead of a bare 500.
      console.error('media read failed', path, e?.message, e?.stack)
      return errorResponse(`media read failed: ${e?.message || 'unknown'}`, 500)
    }
  }

  // POST /api/media/presign — rate-limited 10/min per user.
  // Members may only upload stories; posts/reels/tracks are admin uploads.
  if (path === '/api/media/presign' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return errorResponse('content-type must be application/json', 415)
    const body = await readJson(request)
    const { type, contentType, bytes, ext } = body
    if (!type || !contentType) return errorResponse('type and contentType required', 400)
    // Upload policy: stories are open to every signed-in member (they expire in 24h).
    // All other media (posts, reels, tracks) requires a verified account or admin.
    if (type !== 'story' && fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !fresh.verified) {
      return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
    }
    try {
      const uid = fresh.id
      const { rows } = await query(
        env,
        `SELECT COUNT(*) AS count FROM media_upload_attempts WHERE user_id=? AND created_at > ?`,
        [uid, new Date(Date.now() - 60_000).toISOString()],
      )
      if (Number(rows[0]?.count || 0) >= 10) return errorResponse('presign rate limit 10/min', 429)
      await query(env, 'INSERT INTO media_upload_attempts (user_id, created_at) VALUES (?,?)', [uid, new Date().toISOString()])
      return jsonResponse(await presignedPost(env, { type, contentType, bytes: Number(bytes) || 0, ext }))
    } catch (e) {
      return errorResponse(e.message, e.status || 400)
    }
  }

  // POST /api/media/upload — proxy fallback (used when R2 presign creds are not configured).
  if (path === '/api/media/upload' && method === 'POST') {
    const fresh = await requireMember(env, user)
    try {
      const form = await request.formData()
      const file = form.get('file')
      const key = String(form.get('key') || '')
      const expectedContentType = String(form.get('contentType') || '')
      if (!(file instanceof File) || !key) return errorResponse('key and file are required', 400)
      if (!KEY_RE.test(key)) return errorResponse('invalid media key', 400)
      const buf = await file.arrayBuffer()
      const type = key.split('/')[1]
      validatePresign({ type, contentType: file.type, bytes: buf.byteLength })
      if (expectedContentType && expectedContentType !== file.type) return errorResponse('content type mismatch', 400)
      await env.MEDIA.put(key, buf, {
        httpMetadata: { contentType: file.type },
        customMetadata: { ownerId: String(fresh.id), uploadedAt: new Date().toISOString() },
      })
      return jsonResponse({ ok: true, key }, 201)
    } catch (e) {
      return errorResponse(e.message || 'media upload failed', e.status || 400)
    }
  }

  // POST /api/media/confirm — DB registration after upload.
  if (path === '/api/media/confirm' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return errorResponse('content-type must be application/json', 415)
    const { key, type, caption, title, artist, cover_key: coverKeyRaw } = await readJson(request)
    if (!key || !type) return errorResponse('key and type required', 400)
    if (!KEY_RE.test(key) || !key.startsWith(`originals/${type}/`)) return errorResponse('invalid media key', 400)

    const obj = await env.MEDIA.head(key)
    if (!obj) return errorResponse('original not found — upload to R2 first', 404)
    const ownerId = String(obj.customMetadata?.ownerId || '')
    if (ownerId !== String(fresh.id) && fresh.role !== 'admin') {
      return errorResponse('media does not belong to this account', 403)
    }

    const userId = fresh.id
    const u = await query(env, 'SELECT group_name, constituency, faith, verified FROM users WHERE id=?', [userId])
    const snap = u.rows[0] || {}
    const isAdmin = fresh.role === 'admin'
    const now = new Date().toISOString()

    // Upload policy: stories are open to every signed-in member (24h expiry).
    // Posts, reels and music tracks require a verified account or admin.
    if (type !== 'story' && !isAdmin && !fresh.verified && !hasCap(fresh, 'post_media')) {
      return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
    }

    if (type === 'story') {
      const id = uuid()
      await query(env, `INSERT INTO stories (id, user_id, original_key, expires_at) VALUES (?,?,?,?)`, [id, userId, key, new Date(Date.now() + 24 * 3600_000).toISOString()])
      await audit(env, fresh, 'direct_publish', 'story', id, { key, caption })
      return jsonResponse({ id, status: 'published', key }, 201)
    }

    if (isAdmin) {
      const id = uuid()
      if (type === 'post') {
        await query(
          env,
          `INSERT INTO posts (id, user_id, caption, original_key, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, userId, caption || '', key, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
        )
      } else if (type === 'reel') {
        await query(
          env,
          `INSERT INTO reels (id, user_id, caption, hls_master_key, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, userId, caption || '', key, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
        )
      } else if (type === 'track') {
        // Optional cover art: uploaded as an image (originals/post/…) and linked here.
        let coverKey = null
        const ck = String(coverKeyRaw || '')
        if (ck) {
          if (!/^originals\/post\/\d{4}\/\d{2}\/[0-9a-f-]+\.(jpg|jpeg|png|webp)$/i.test(ck)) return errorResponse('invalid cover key', 400)
          const cobj = await env.MEDIA.head(ck)
          if (!cobj) return errorResponse('cover not found in storage', 404)
          coverKey = ck
        }
        await query(env, `INSERT INTO tracks (id, user_id, title, artist, original_key, preview_key, cover_thumb_key) VALUES (?,?,?,?,?,?,?)`, [id, userId, title || caption || 'Untitled', artist || '', key, key, coverKey])
      } else return errorResponse('unsupported media type', 400)
      await audit(env, fresh, 'direct_publish', type, id, { key, caption })
      return jsonResponse({ id, status: 'approved', key }, 201)
    }

    const id = uuid()
    await query(
      env,
      `INSERT INTO pending_queue (id, type, user_id, caption, original_key, status) VALUES (?,?,?,?,?,'pending')`,
      [id, type, userId, caption || '', key],
    )
    return jsonResponse({ id, status: 'pending', at: now }, 202)
  }

  // POST /api/admin/publish — text-only announcements (no media needed).
  // Same policy as media: verified members or admin only.
  if (path === '/api/admin/publish' && method === 'POST') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !fresh.verified && !hasCap(fresh, 'post_media')) return errorResponse('posting is for verified members — ask an admin to verify your account', 403)
    const body = await readJson(request)
    const caption = String(body.caption || '').trim().slice(0, 2000)
    if (!caption) return errorResponse('announcement text required', 400)
    const u = await query(env, 'SELECT group_name, constituency, faith FROM users WHERE id=?', [fresh.id])
    const snap = u.rows[0] || {}
    const id = uuid()
    await query(
      env,
      `INSERT INTO posts (id, user_id, caption, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,1,?,?,?,?)`,
      [id, fresh.id, caption, snap.group_name || null, snap.constituency || null, snap.faith || null, new Date().toISOString()],
    )
    await audit(env, fresh, 'announcement_published', id, { caption: caption.slice(0, 80) })
    return jsonResponse({ id, status: 'published' }, 201)
  }

  // ── ADMIN MEDIA CONSOLE ────────────────────────────────────────
  // GET /api/admin/media — list everything with signed preview URLs.
  if (path === '/api/admin/media' && method === 'GET') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !hasCap(fresh, CAP_DELETE)) return errorResponse('not permitted', 403)
    const kind = String(new URL(request.url).searchParams.get('kind') || 'all')
    const out = { posts: [], reels: [], tracks: [], stories: [] }
    const include = k => kind === 'all' || kind === k
    if (include('posts')) {
      const { rows } = await query(env, `SELECT p.id, p.caption, p.thumb_key, p.original_key, p.likes, p.comments, p.is_pinned, p.created_at, u.username
        FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200`)
      out.posts = await Promise.all(rows.map(async r => ({ ...r, is_pinned: !!r.is_pinned, preview_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 1800) })))
    }
    if (include('reels')) {
      const { rows } = await query(env, `SELECT r.id, r.caption, r.poster_key, r.hls_master_key, r.views, r.likes, r.is_pinned, r.created_at, u.username
        FROM reels r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 200`)
      out.reels = await Promise.all(rows.map(async r => ({ ...r, is_pinned: !!r.is_pinned, preview_url: await mediaUrlOrNull(env, r.poster_key || r.hls_master_key, 1800) })))
    }
    if (include('tracks')) {
      const { rows } = await query(env, `SELECT t.id, t.title, t.artist, t.original_key, t.cover_thumb_key, t.created_at, u.username
        FROM tracks t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 200`)
      out.tracks = await Promise.all(rows.map(async r => ({ ...r, preview_url: await mediaUrlOrNull(env, r.original_key, 1800), cover_url: await mediaUrlOrNull(env, r.cover_thumb_key, 1800) })))
    }
    if (include('stories')) {
      const { rows } = await query(env, `SELECT s.id, s.original_key, s.expires_at, s.created_at, u.username
        FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 100`, [new Date().toISOString()])
      out.stories = await Promise.all(rows.map(async r => ({ ...r, preview_url: await mediaUrlOrNull(env, r.original_key, 1800) })))
    }
    return jsonResponse(out)
  }

  // PATCH /api/admin/media/posts/:id — edit caption / toggle pin.
  if (/^\/api\/admin\/media\/posts\/[0-9a-f-]+$/i.test(path) && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'post_media')) return errorResponse('not permitted — needs post_media', 403)
    const id = path.split('/')[4]
    const body = await readJson(request)
    const sets = [], vals = []
    if (body.caption !== undefined) { sets.push('caption=?'); vals.push(String(body.caption || '').slice(0, 500)) }
    if (body.is_pinned !== undefined) { sets.push('is_pinned=?'); vals.push(body.is_pinned ? 1 : 0) }
    if (!sets.length) return errorResponse('nothing to update', 400)
    vals.push(id)
    const r = await query(env, `UPDATE posts SET ${sets.join(', ')} WHERE id=?`, vals)
    await audit(env, fresh, 'post_edited', id, body)
    return jsonResponse({ ok: true, updated: r.meta?.changes ?? 1 })
  }

  // PATCH /api/admin/media/reels/:id — edit caption / toggle pin.
  if (/^\/api\/admin\/media\/reels\/[0-9a-f-]+$/i.test(path) && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'post_media')) return errorResponse('not permitted — needs post_media', 403)
    const id = path.split('/')[4]
    const body = await readJson(request)
    const sets = [], vals = []
    if (body.caption !== undefined) { sets.push('caption=?'); vals.push(String(body.caption || '').slice(0, 500)) }
    if (body.is_pinned !== undefined) { sets.push('is_pinned=?'); vals.push(body.is_pinned ? 1 : 0) }
    if (!sets.length) return errorResponse('nothing to update', 400)
    vals.push(id)
    const r = await query(env, `UPDATE reels SET ${sets.join(', ')} WHERE id=?`, vals)
    await audit(env, fresh, 'reel_edited', id, body)
    return jsonResponse({ ok: true, updated: r.meta?.changes ?? 1 })
  }

  // PATCH /api/admin/media/tracks/:id — edit title / artist.
  if (/^\/api\/admin\/media\/tracks\/[0-9a-f-]+$/i.test(path) && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'post_media')) return errorResponse('not permitted — needs post_media', 403)
    const id = path.split('/')[4]
    const body = await readJson(request)
    const sets = [], vals = []
    if (body.title !== undefined) { sets.push('title=?'); vals.push(String(body.title || '').slice(0, 120)) }
    if (body.artist !== undefined) { sets.push('artist=?'); vals.push(String(body.artist || '').slice(0, 120)) }
    if (body.cover_key !== undefined) {
      const ck = String(body.cover_key || '')
      if (ck && !/^originals\/post\/\d{4}\/\d{2}\/[0-9a-f-]+\.(jpg|jpeg|png|webp)$/i.test(ck)) return errorResponse('invalid cover key', 400)
      if (ck) {
        const cobj = await env.MEDIA.head(ck)
        if (!cobj) return errorResponse('cover not found in storage', 404)
      }
      sets.push('cover_thumb_key=?'); vals.push(ck || null)
    }
    if (!sets.length) return errorResponse('nothing to update', 400)
    vals.push(id)
    const r = await query(env, `UPDATE tracks SET ${sets.join(', ')} WHERE id=?`, vals)
    await audit(env, fresh, 'track_edited', id, body)
    return jsonResponse({ ok: true, updated: r.meta?.changes ?? 1 })
  }

  // DELETE /api/admin/media/:kind/:id — remove from DB + R2 (post/reel/track/story).
  if (/^\/api\/admin\/media\/(posts|reels|tracks|stories)\/[0-9a-f-]+$/i.test(path) && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, CAP_DELETE)) return errorResponse('not permitted — needs delete_media', 403)
    const [, , , , kindRaw, id] = path.split('/')
    const kind = kindRaw.toLowerCase()
    const table = { posts: 'posts', reels: 'reels', tracks: 'tracks', stories: 'stories' }[kind]
    if (!table) return errorResponse('unknown media kind', 400)
    const keyCols = { posts: ['original_key', 'thumb_key'], reels: ['hls_master_key', 'poster_key', 'thumb_key'], tracks: ['original_key', 'preview_key', 'cover_thumb_key'], stories: ['original_key', 'thumb_key'] }
    const row = await query(env, `SELECT * FROM ${table} WHERE id=?`, [id])
    if (!row.rows[0]) return errorResponse('not found', 404)
    // Delete R2 objects first (best-effort), then the DB row.
    for (const col of keyCols[kind]) {
      const key = row.rows[0][col]
      if (key && typeof key === 'string') { try { await env.MEDIA.delete(key) } catch {} }
    }
    await query(env, `DELETE FROM ${table} WHERE id=?`, [id])
    await audit(env, fresh, `${kind.replace(/s$/, '')}_deleted`, id, { kind })
    return jsonResponse({ ok: true, deleted: id, kind })
  }

  return null
}

export { isReadableKey }
