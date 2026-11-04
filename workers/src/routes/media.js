// Port of server/src/routes/media.js (pg/Blobs → D1/R2).
import { query, uuid } from '../lib/db.js'
import { requireMember, requireAdmin } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, httpError } from '../lib/http.js'
import {
  presignedPost, validatePresign, isReadableKey, handleMediaRead, mediaUrlOrNull, contentTypeForKey, ALLOW_CT,
  mediaKeyFor, mediaSecret, createMultipartUpload, uploadMultipartPart, listMultipartParts,
  completeMultipartUpload, abortMultipartUpload, MULTIPART_PART_SIZE, MAX_PARTS,
} from '../lib/media.js'
import { hmacSign, timingSafeEqualStr } from '../lib/crypto.js'
import { hasCap } from '../lib/capabilities.js'
const CAP_DELETE = 'delete_media'

const KEY_RE = /^originals\/(avatar|post|story|reel|track|chat|sermon_audio|sermon_video)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

async function audit(env, actor, action, targetType, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,?,?,?,?)`,
    [actor.id, actor.role, action, targetType, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

// A cover/poster is a separate R2 object attached to a media row. Validate its
// shape, existence and ownership — one security rule for every attach site
// (reel posters, track covers, admin cover edits). Returns { key } or { error }.
const POSTER_MSGS = { invalid: 'invalid poster key', missing: 'poster not found in storage', forbidden: 'poster does not belong to this account' }
const COVER_MSGS = { invalid: 'invalid cover key', missing: 'cover not found in storage', forbidden: 'cover does not belong to this account' }
async function validateAttachedCover(env, fresh, rawKey, msgs) {
  const key = String(rawKey)
  if (!/^originals\/post\/\d{4}\/\d{2}\/[0-9a-f-]+\.(jpg|jpeg|png|webp)$/i.test(key)) return { error: errorResponse(msgs.invalid, 400) }
  const obj = await env.MEDIA.head(key)
  if (!obj) return { error: errorResponse(msgs.missing, 404) }
  const ownerId = String(obj.customMetadata?.ownerId || obj.customMetadata?.ownerid || '')
  if (ownerId !== String(fresh.id) && fresh.role !== 'admin') return { error: errorResponse(msgs.forbidden, 403) }
  return { key }
}

// Look up an existing registration for a storage key and return the ORIGINAL
// upload result, so a retried confirm (same logical upload → same key) replays
// instead of inserting a duplicate or erroring.
async function findRegisteredUpload(env, type, key) {
  const withRow = async (sql) => { const r = await query(env, sql, [key]); const row = r?.rows?.[0]; return row || null }
  if (type === 'post') { const row = await withRow(`SELECT id FROM posts WHERE original_key=? LIMIT 1`); if (row) return { id: row.id, status: 'approved', key } }
  if (type === 'reel') { const row = await withRow(`SELECT id FROM reels WHERE hls_master_key=? LIMIT 1`); if (row) return { id: row.id, status: 'approved', key } }
  if (type === 'story') { const row = await withRow(`SELECT id FROM stories WHERE original_key=? LIMIT 1`); if (row) return { id: row.id, status: 'published', key } }
  if (type === 'track') { const row = await withRow(`SELECT id FROM tracks WHERE original_key=? LIMIT 1`); if (row) return { id: row.id, status: 'approved', key } }
  if (type === 'sermon_audio' || type === 'sermon_video') {
    const kind = type === 'sermon_video' ? 'video' : 'audio'
    const row = await withRow(`SELECT id FROM sermons WHERE media_key=? LIMIT 1`)
    if (row) return { id: row.id, status: kind === 'video' ? 'published' : 'approved', kind, key }
  }
  const pending = await query(env, `SELECT id, status, created_at FROM pending_queue WHERE original_key=? AND status IN ('pending','approved') LIMIT 1`, [key])
  const prow = pending?.rows?.[0]
  if (prow) return { id: prow.id, status: prow.status, key, at: prow.created_at }
  return null
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
    const { type, contentType, bytes, ext, idempotencyKey } = body
    if (!type || !contentType) return errorResponse('type and contentType required', 400)
    // Upload policy: stories and profile avatars are open to every signed-in
    // member. All other media (posts, reels, tracks) requires a verified
    // account or admin.
    if ((type === 'sermon_audio' || type === 'sermon_video')) {
      if (!hasCap(fresh, 'manage_sermons')) return errorResponse('sermon management permission required', 403)
    } else if (type !== 'story' && type !== 'avatar' && type !== 'chat' && fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !fresh.verified) {
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
      return jsonResponse(await presignedPost(env, { type, contentType, bytes: Number(bytes) || 0, ext, ownerId: fresh.id, idempotencyKey }))
    } catch (e) {
      return errorResponse(e.message, e.status || 400)
    }
  }

  // ── CHUNKED (RESUMABLE) UPLOADS ─────────────────────────────────
  // A device that cannot reach R2 directly — blocked host, or its origin fails
  // the bucket's CORS preflight — gets an opaque XHR error and no status code,
  // which is the "network error" admins were reporting. Parts travel through
  // this Worker instead, and a dropped connection resumes from the last part
  // the server confirms, never from zero.
  //
  // The upload token binds (uploadId, key, owner) so one member cannot keep
  // writing into another member's open session.
  const multipartToken = async (fresh, uploadId, key) =>
    hmacSign(mediaSecret(env), `mp|${uploadId}|${key}|${fresh.id}`)

  if (path === '/api/media/multipart' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const ct = request.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return errorResponse('content-type must be application/json', 415)
    const body = await readJson(request)
    const { type, contentType: rawCt, bytes: rawBytes, ext, idempotencyKey } = body
    if (!type) return errorResponse('type required', 400)
    if (type === 'sermon_audio' || type === 'sermon_video') {
      if (!hasCap(fresh, 'manage_sermons')) return errorResponse('sermon management permission required', 403)
    } else if (type !== 'story' && type !== 'avatar' && type !== 'chat' && fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !fresh.verified) {
      return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
    }
    try {
      const declared = String(rawCt || '').toLowerCase().split(';')[0].trim()
      const probe = `originals/${type}/2000/01/probe.${String(ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'}`
      // Android reports an empty or generic type for a picked recording; resolve
      // it from the extension rather than refusing the upload at the start.
      const resolvedType = (!declared || declared === 'application/octet-stream') ? contentTypeForKey(probe, '') : declared
      const bytes = Number(rawBytes) || 0
      if (bytes <= 0) return errorResponse('bytes required', 400)
      validatePresign({ type, contentType: resolvedType, bytes })
      const parts = Math.ceil(bytes / MULTIPART_PART_SIZE)
      if (parts > MAX_PARTS) return errorResponse('file is too large for chunked upload', 400)
      const rate = await query(
        env,
        'SELECT COUNT(*) AS count FROM media_upload_attempts WHERE user_id=? AND created_at > ?',
        [fresh.id, new Date(Date.now() - 60_000).toISOString()],
      )
      if (Number(rate.rows[0]?.count || 0) >= 10) return errorResponse('upload rate limit 10/min', 429)
      await query(env, 'INSERT INTO media_upload_attempts (user_id, created_at) VALUES (?,?)', [fresh.id, new Date().toISOString()])
      const key = mediaKeyFor({ type, ext, contentType: resolvedType, idempotencyKey })
      const uploadId = await createMultipartUpload(env, { key, contentType: resolvedType, ownerId: fresh.id })
      const token = await multipartToken(fresh, uploadId, key)
      return jsonResponse({ key, uploadId, token, partSize: MULTIPART_PART_SIZE, parts, contentType: resolvedType }, 201)
    } catch (e) {
      return errorResponse(e.message || 'could not start the upload', e.status || 400)
    }
  }

  // POST /api/media/multipart/part — store one chunk. FormData rather than a
  // raw body so the request stays a plain authored POST the API CORS policy
  // already permits.
  if (path === '/api/media/multipart/part' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const form = await request.formData().catch(() => null)
    if (!form) return errorResponse('multipart/form-data required', 415)
    const key = String(form.get('key') || '')
    const uploadId = String(form.get('uploadId') || '')
    const token = String(form.get('token') || '')
    const partNumber = Number(form.get('partNumber'))
    const part = form.get('part')
    if (!KEY_RE.test(key) || !uploadId || !(part instanceof File) || !Number.isInteger(partNumber) || partNumber < 1) {
      return errorResponse('key, uploadId, partNumber and part are required', 400)
    }
    if (part.size > MULTIPART_PART_SIZE + 1024 * 1024) return errorResponse('part too large', 413)
    const uploadType = key.split('/')[1]
    if (uploadType === 'sermon_audio' || uploadType === 'sermon_video') {
      if (!hasCap(fresh, 'manage_sermons')) return errorResponse('sermon management permission required', 403)
    } else if (uploadType !== 'story' && uploadType !== 'avatar' && uploadType !== 'chat' && fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !fresh.verified) {
      return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
    }
    if (!timingSafeEqualStr(await multipartToken(fresh, uploadId, key), token)) {
      return errorResponse('upload token does not match this account', 403)
    }
    try {
      const etag = await uploadMultipartPart(env, { key, uploadId, partNumber, body: await part.arrayBuffer() })
      return jsonResponse({ partNumber, etag })
    } catch (e) {
      return errorResponse(e.message || 'part upload failed', e.status || 502)
    }
  }

  // POST /api/media/multipart/status — which parts already landed (resume).
  if (path === '/api/media/multipart/status' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const key = String(body.key || '')
    const uploadId = String(body.uploadId || '')
    const token = String(body.token || '')
    if (!KEY_RE.test(key) || !uploadId) return errorResponse('key and uploadId required', 400)
    if (!timingSafeEqualStr(await multipartToken(fresh, uploadId, key), token)) {
      return errorResponse('upload token does not match this account', 403)
    }
    try {
      return jsonResponse({ parts: await listMultipartParts(env, { key, uploadId }) })
    } catch (e) {
      return errorResponse(e.message || 'could not read upload session', e.status || 502)
    }
  }

  // POST /api/media/multipart/complete — join the parts into the object.
  if (path === '/api/media/multipart/complete' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const key = String(body.key || '')
    const uploadId = String(body.uploadId || '')
    const token = String(body.token || '')
    const parts = Array.isArray(body.parts) ? body.parts : []
    if (!KEY_RE.test(key) || !uploadId) return errorResponse('key and uploadId required', 400)
    if (!timingSafeEqualStr(await multipartToken(fresh, uploadId, key), token)) {
      return errorResponse('upload token does not match this account', 403)
    }
    if (!parts.length) return errorResponse('parts required', 400)
    try {
      await completeMultipartUpload(env, { key, uploadId, parts: parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag || '') })) })
      const head = await env.MEDIA.head(key)
      return jsonResponse({ key, size: Number(head?.size) || null })
    } catch (e) {
      return errorResponse(e.message || 'could not finish the upload', e.status || 502)
    }
  }

  // POST /api/media/multipart/abort — give up and release the parts.
  if (path === '/api/media/multipart/abort' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const key = String(body.key || '')
    const uploadId = String(body.uploadId || '')
    if (!KEY_RE.test(key) || !uploadId) return errorResponse('key and uploadId required', 400)
    await abortMultipartUpload(env, { key, uploadId })
    return jsonResponse({ ok: true })
  }

  // POST /api/media/upload — proxy fallback (used when R2 presign creds are not configured).
  if (path === '/api/media/upload' && method === 'POST') {
    const fresh = await requireMember(env, user)
    // Keep the proxy fallback under the same authorization and per-user
    // upload limits as presign. Without this, disabling R2 presigning would
    // silently bypass both posting permissions and the 10/minute limit.
    try {
      const form = await request.formData()
      const file = form.get('file')
      const key = String(form.get('key') || '')
      const expectedContentType = String(form.get('contentType') || '')
      if (!(file instanceof File) || !key) return errorResponse('key and file are required', 400)
      if (!KEY_RE.test(key)) return errorResponse('invalid media key', 400)
      const type = key.split('/')[1]
      if ((type === 'sermon_audio' || type === 'sermon_video')) {
        if (!hasCap(fresh, 'manage_sermons')) return errorResponse('sermon management permission required', 403)
      } else if (type !== 'story' && type !== 'avatar' && type !== 'chat' && fresh.role !== 'admin' && !hasCap(fresh, 'post_media') && !fresh.verified) {
        return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
      }
      const rate = await query(
        env,
        'SELECT COUNT(*) AS count FROM media_upload_attempts WHERE user_id=? AND created_at > ?',
        [fresh.id, new Date(Date.now() - 60_000).toISOString()],
      )
      if (Number(rate.rows[0]?.count || 0) >= 10) return errorResponse('upload rate limit 10/min', 429)
      await query(env, 'INSERT INTO media_upload_attempts (user_id, created_at) VALUES (?,?)', [fresh.id, new Date().toISOString()])
      const buf = await file.arrayBuffer()
      // An opaque/empty type from an Android picker is resolved from the key
      // extension, exactly as presign and multipart do — otherwise the very
      // files presign accepts are refused here.
      const fileCt = String(file.type || '').toLowerCase().split(';')[0].trim()
      const normalized = (!fileCt || fileCt === 'application/octet-stream') ? contentTypeForKey(key, '') : fileCt
      validatePresign({ type, contentType: normalized, bytes: buf.byteLength })
      if (expectedContentType && expectedContentType.toLowerCase().split(';')[0].trim() !== normalized) {
        return errorResponse('content type mismatch', 400)
      }
      await env.MEDIA.put(key, buf, {
        httpMetadata: { contentType: normalized },
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
    const body = await readJson(request)
    const { key, type, caption, title, artist, speaker, scripture, description, music_track_id: musicTrackId, cover_key: coverKeyRaw } = body
    // Optional client-picked video poster (reels): a JPEG the client captured
    // from the chosen frame, uploaded to originals/post/… before confirm.

    if (!key || !type) return errorResponse('key and type required', 400)
    if (type === 'avatar') return errorResponse('avatars are attached with PATCH /api/me, not media/confirm', 400)
    if (type === 'chat') return errorResponse('chat attachments are referenced directly by chat messages — nothing to confirm', 400)
    if (!KEY_RE.test(key) || !key.startsWith(`originals/${type}/`)) return errorResponse('invalid media key', 400)

    const obj = await env.MEDIA.head(key)
    if (!obj) return errorResponse('original not found — upload to R2 first', 404)
    const ownerId = String(obj.customMetadata?.ownerId || obj.customMetadata?.ownerid || '')
    if (ownerId !== String(fresh.id) && fresh.role !== 'admin') {
      return errorResponse('media does not belong to this account', 403)
    }
    try {
      validatePresign({
        type,
        contentType: String(obj.httpMetadata?.contentType || ''),
        bytes: Number(obj.size) || 0,
      })
    } catch (e) {
      return errorResponse(e.message || 'uploaded media failed validation', e.status || 400)
    }

    const userId = fresh.id

    // Idempotent confirm: the client derives the storage key from a stable
    // idempotency key, so a retried logical upload re-submits the same key and
    // must get the ORIGINAL result back — no duplicate registrations, no 409
    // masquerading as failure when the first confirm actually landed.
    const existing = await findRegisteredUpload(env, type, key)
    if (existing) {
      const status = existing.status
      const out = { id: existing.id, status, key }
      if (existing.kind) out.kind = existing.kind
      if (existing.at) out.at = existing.at
      return jsonResponse(out, status === 'pending' ? 202 : 200)
    }

    // A cover/poster is a separate R2 object attached to a media row. Validate
    // its shape, existence and ownership before direct publication,
    // moderation queueing, or an update — one rule everywhere.
    let validatedPosterKey = null
    if (type === 'reel' && coverKeyRaw) {
      const r = await validateAttachedCover(env, fresh, coverKeyRaw, POSTER_MSGS)
      if (r.error) return r.error
      validatedPosterKey = r.key
    } else if (type === 'track' && coverKeyRaw) {
      const r = await validateAttachedCover(env, fresh, coverKeyRaw, COVER_MSGS)
      if (r.error) return r.error
    } else if (coverKeyRaw) {
      return errorResponse('cover key is only supported for reels', 400)
    }
    if (musicTrackId) { const mt = await query(env, 'SELECT id FROM tracks WHERE id=?', [String(musicTrackId)]); if (!mt.rows[0]) return errorResponse('music track not found', 404) }
    const u = await query(env, 'SELECT group_name, constituency, faith, verified FROM users WHERE id=?', [userId])
    const sermonType = type === 'sermon_audio' || type === 'sermon_video'
    if (sermonType) {
      if (!hasCap(fresh, 'manage_sermons')) {
        return errorResponse('sermon management permission required', 403)
      }
      // The stored content type is normalized from the object metadata (or the
      // key extension when metadata is missing) and must match the SAME
      // allowlist presign used — otherwise an m4a recording the server cheerfully
      // presigned would be rejected at confirm, after the full transfer. The
      // original file keeps its native format; no transcoding happens here.
      const storedCt = String(contentTypeForKey(key, obj.httpMetadata?.contentType)).split(';')[0].trim().toLowerCase()
      const kind = type === 'sermon_video' ? 'video' : 'audio'
      if (!ALLOW_CT[type].map(t => String(t).toLowerCase()).includes(storedCt)) return errorResponse(kind === 'audio' ? 'sermon audio format not supported' : 'sermon video format not supported', 400)
      const id = uuid()
      await query(env, `INSERT INTO sermons (id, user_id, title, speaker, scripture, description, kind, media_key, bytes) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, userId, String(title || caption || 'Untitled Sermon').trim().slice(0, 200), String(speaker || '').trim().slice(0, 200) || null, String(scripture || '').trim().slice(0, 200) || null, String(description || caption || '').trim().slice(0, 1000) || null, kind, key, Number(obj.size) || null])
      await audit(env, fresh, 'sermon_published', 'sermon', id, { key, kind })
      return jsonResponse({ id, status: 'published', kind, key }, 201)
    }
    const snap = u.rows[0] || {}
    const isAdmin = fresh.role === 'admin'
    const now = new Date().toISOString()

    // Upload policy: stories are open to every signed-in member (24h expiry).
    // Posts, reels, music tracks and sermons require a verified account or admin.
    if (type !== 'story' && !isAdmin && !fresh.verified && !hasCap(fresh, 'post_media')) {
      return errorResponse('posting is for verified members — ask an admin to verify your account, or share a story instead', 403)
    }

    if (type === 'story') {
      // Photos and short video moments are both allowed; record which so the
      // feed/viewer render it correctly (derived from the stored contentType).
      const storedCt = String(obj.httpMetadata?.contentType || '')
      const mediaType = storedCt.startsWith('video/') ? 'video' : 'image'
      // Author-selected viewer duration for photo stories (seconds); clamped
      // to the composer's chip range so nothing outside 1–12 persists.
      const durRaw = Number(body?.duration_secs)
      const durationSecs = Number.isFinite(durRaw) ? Math.min(Math.max(Math.round(durRaw), 1), 12) : null
      const id = uuid()
      await query(env, `INSERT INTO stories (id, user_id, original_key, expires_at, media_type, caption, music_track_id, duration_secs) VALUES (?,?,?,?,?,?,?,?)`, [id, userId, key, new Date(Date.now() + 24 * 3600_000).toISOString(), mediaType, caption || '', musicTrackId || null, durationSecs])
      await audit(env, fresh, 'direct_publish', 'story', id, { key, caption, mediaType })
      return jsonResponse({ id, status: 'published', key }, 201)
    }

    // Direct publication: admin, verified members (option 2 policy — trusted
    // badge means instant visibility) or post_media grant holders. Everyone
    // else who passed the gate above queues for admin approval.
    if (isAdmin || fresh.verified || hasCap(fresh, 'post_media')) {
      const id = uuid()
      if (type === 'post') {
        await query(
          env,
          `INSERT INTO posts (id, user_id, caption, original_key, music_track_id, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, userId, caption || '', key, musicTrackId || null, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
        )
      } else if (type === 'reel') {
        // Optional client-picked poster (cover frame) for reels: captured by the
        // composer as a JPEG and uploaded to originals/post/… before confirm.
        const posterKey = validatedPosterKey
        await query(
          env,
          `INSERT INTO reels (id, user_id, caption, music_track_id, hls_master_key, poster_key, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [id, userId, caption || '', musicTrackId || null, key, posterKey, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
        )
      } else if (type === 'track') {
        // Optional cover art: validated (format, existence, ownership) in the
        // shared gate above; attach whatever survived it.
        const coverKey = String(coverKeyRaw || '') || null
        await query(env, `INSERT INTO tracks (id, user_id, title, artist, original_key, preview_key, cover_thumb_key) VALUES (?,?,?,?,?,?,?)`, [id, userId, title || caption || 'Untitled', artist || '', key, key, coverKey])
      } else return errorResponse('unsupported media type', 400)
      await audit(env, fresh, 'direct_publish', type, id, { key, caption })
      return jsonResponse({ id, status: 'approved', key }, 201)
    }

    const id = uuid()
    await query(
      env,
      `INSERT INTO pending_queue (id, type, user_id, caption, original_key, poster_key, music_track_id, status) VALUES (?,?,?,?,?,?,?,'pending')`,
      [id, type, userId, caption || '', key, type === 'reel' ? validatedPosterKey : null, musicTrackId || null],
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
      // Track covers are attached media: format, existence and ownership are
      // validated under the same rule as reel posters (P2 unification).
      const ck = String(body.cover_key || '')
      if (ck) {
        const r = await validateAttachedCover(env, fresh, ck, COVER_MSGS)
        if (r.error) return r.error
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
  // Author of the row may delete his own post/reel/track (not stories — they
  // expire in 24h; speeches need no tombstone) without any grant. Admin or a
  // delete_media grant holder can remove anything. Both paths are audited.
  if (/^\/api\/admin\/media\/(posts|reels|tracks|stories)\/[0-9a-f-]+$/i.test(path) && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const [, , , , kindRaw, id] = path.split('/')
    const kind = kindRaw.toLowerCase()
    const table = { posts: 'posts', reels: 'reels', tracks: 'tracks', stories: 'stories' }[kind]
    if (!table) return errorResponse('unknown media kind', 400)
    const keyCols = { posts: ['original_key', 'thumb_key'], reels: ['hls_master_key', 'poster_key', 'thumb_key'], tracks: ['original_key', 'preview_key', 'cover_thumb_key'], stories: ['original_key', 'thumb_key'] }
    const row = await query(env, `SELECT * FROM ${table} WHERE id=?`, [id])
    if (!row.rows[0]) return errorResponse('not found', 404)
    const isOwner = row.rows[0].user_id === fresh.id
    if (!isOwner && fresh.role !== 'admin' && !hasCap(fresh, CAP_DELETE)) return errorResponse('not permitted — needs delete_media', 403)
    // Delete R2 objects first (best-effort), then the DB row.
    for (const col of keyCols[kind]) {
      const key = row.rows[0][col]
      if (key && typeof key === 'string') { try { await env.MEDIA.delete(key) } catch {} }
    }
    await query(env, `DELETE FROM ${table} WHERE id=?`, [id])
    await audit(env, fresh, isOwner ? `${kind.replace(/s$/, '')}_deleted_own` : `${kind.replace(/s$/, '')}_deleted`, id, { kind, owner_delete: isOwner })
    return jsonResponse({ ok: true, deleted: id, kind, own: isOwner })
  }

  return null
}

export { isReadableKey }
