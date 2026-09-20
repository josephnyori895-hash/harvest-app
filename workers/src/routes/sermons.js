// Sermons — admin-published audio (mp3/m4a) and video (mp4/webm) teachings.
// Members stream in-app or download the original file. Downloads set the
// Content-Disposition filename and increment a counter.
import { query, uuid } from '../lib/db.js'
import { requireMember, requireAdmin } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, searchParams } from '../lib/http.js'
import { mediaUrlOrNull, isReadableKey } from '../lib/media.js'

function clean(v, max = 200) {
  return String(v ?? '').trim().slice(0, max) || null
}

// Friendly download filename: "Title-by-Speaker.mp3" (safe chars only).
function downloadName(title, speaker, ext) {
  const base = `${title || 'sermon'}${speaker ? `-${speaker}` : ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sermon'
  return `${base}.${ext || 'mp3'}`
}

function extOf(key) {
  return String(key || '').split('.').pop()?.toLowerCase() || 'mp3'
}

export async function handleSermons(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const user = ctx.user
  const qp = searchParams(url)

  // GET /api/sermons — list (auth not required to browse; URLs are signed).
  if (path === '/api/sermons' && method === 'GET') {
    const limit = Math.min(parseInt(qp.limit || '50', 10), 100)
    const { rows } = await query(
      env,
      `SELECT s.id, s.title, s.speaker, s.scripture, s.description, s.kind, s.duration_secs, s.bytes, s.plays, s.downloads, s.created_at, s.media_key, s.cover_key
         FROM sermons s ORDER BY s.created_at DESC LIMIT ?`,
      [limit],
    )
    const out = await Promise.all(rows.map(async s => ({
      ...s,
      plays: Number(s.plays) || 0,
      downloads: Number(s.downloads) || 0,
      // long TTL so playback doesn't cut out mid-sermon
      media_url: await mediaUrlOrNull(env, s.media_key, 24 * 3600),
      cover_url: s.cover_key ? await mediaUrlOrNull(env, s.cover_key, 24 * 3600) : null,
      media_key: undefined,
      cover_key: undefined,
    })))
    return jsonResponse({ sermons: out })
  }

  // POST /api/sermons — edit metadata (admin). Body: { id, title?, speaker?, scripture?, description? }
  if (path === '/api/sermons' && method === 'POST') {
    const body = await readJson(request)
    if (!body.id) return errorResponse('id required', 400)
    const fresh = await requireAdmin(env, user)
    const sets = [], vals = []
    for (const k of ['title', 'speaker', 'scripture', 'description']) {
      if (body[k] !== undefined) { sets.push(`${k}=?`); vals.push(clean(body[k], k === 'description' ? 1000 : 200)) }
    }
    if (!sets.length) return errorResponse('nothing to update', 400)
    vals.push(String(body.id))
    const r = await query(env, `UPDATE sermons SET ${sets.join(', ')} WHERE id=?`, vals)
    if (!r.meta?.changes) return errorResponse('sermon not found', 404)
    return jsonResponse({ ok: true })
  }

  // DELETE /api/sermons/:id — admin removes a sermon (DB row; R2 original stays for audit).
  const del = path.match(/^\/api\/sermons\/([0-9a-f-]+)$/i)
  if (del && method === 'DELETE') {
    const fresh = await requireAdmin(env, user)
    const row = await query(env, 'SELECT media_key, cover_key FROM sermons WHERE id=?', [del[1]])
    if (!row.rows[0]) return errorResponse('not found', 404)
    for (const k of [row.rows[0].media_key, row.rows[0].cover_key]) {
      if (k && isReadableKey(k)) { try { await env.MEDIA.delete(k) } catch {} }
    }
    await query(env, 'DELETE FROM sermons WHERE id=?', [del[1]])
    return jsonResponse({ ok: true })
  }

  // POST /api/sermons/:id/play — increment play counter (fire-and-forget client call).
  const play = path.match(/^\/api\/sermons\/([0-9a-f-]+)\/play$/i)
  if (play && method === 'POST') {
    await requireMember(env, user)
    await query(env, 'UPDATE sermons SET plays = plays + 1 WHERE id=?', [play[1]])
    return jsonResponse({ ok: true })
  }

  // GET /api/sermons/:id/download — returns a signed URL with download disposition.
  // POST variant also increments the counter (the client calls POST right before opening the URL).
  const dl = path.match(/^\/api\/sermons\/([0-9a-f-]+)\/download$/i)
  if (dl && (method === 'GET' || method === 'POST')) {
    await requireMember(env, user)
    const row = await query(env, 'SELECT title, speaker, media_key FROM sermons WHERE id=?', [dl[1]])
    if (!row.rows[0]) return errorResponse('not found', 404)
    const filename = downloadName(row.rows[0].title, row.rows[0].speaker, extOf(row.rows[0].media_key))
    const url2 = await mediaUrlOrNull(env, row.rows[0].media_key, 3600, { download: filename })
    if (!url2) return errorResponse('media storage unavailable', 503)
    if (method === 'POST') await query(env, 'UPDATE sermons SET downloads = downloads + 1 WHERE id=?', [dl[1]])
    return jsonResponse({ url: url2, filename })
  }

  return null
}
