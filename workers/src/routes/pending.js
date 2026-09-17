// Port of server/src/routes/pending.js (pg/Blobs → D1/R2).
import { query } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, searchParams } from '../lib/http.js'
import { mediaUrlOrNull } from '../lib/media.js'

const STALE_PENDING_MS = 24 * 60 * 60 * 1000
const REJECTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function mediaKeys(item) {
  return [item.original_key, item.thumb_key, item.hls_master_key, item.poster_key].filter(Boolean)
}

export async function cleanupOrphanedUploads(env) {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString()
  const rejectedCutoff = new Date(Date.now() - REJECTED_RETENTION_MS).toISOString()
  const { rows } = await query(
    env,
    `SELECT id, type, status, original_key, thumb_key, hls_master_key, poster_key
       FROM pending_queue
      WHERE (status IN ('pending','transcoding') AND created_at < ?)
         OR (status='rejected' AND reviewed_at IS NOT NULL AND reviewed_at < ?)
      ORDER BY created_at ASC LIMIT 200`,
    [cutoff, rejectedCutoff],
  )
  let removed = 0
  for (const item of rows) {
    for (const key of mediaKeys(item)) {
      try { if (await env.MEDIA.head(key)) { await env.MEDIA.delete(key); removed++ } } catch {}
    }
    await query(env, `DELETE FROM pending_queue WHERE id=?`, [item.id])
    await query(
      env,
      `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (NULL,'cleanup','pending',?,?,?,?)`,
      [item.id, JSON.stringify({ type: item.type, status: item.status }), new Date().toISOString()],
    ).catch(() => {})
  }
  return { rows: rows.length, objects: removed }
}

// Cron handler (also used by the manual cleanup endpoint).
export async function runScheduledCleanup(env) {
  const cleanup = await cleanupOrphanedUploads(env)
  // story expiry
  const expired = await query(env, `SELECT id, original_key, thumb_key FROM stories WHERE expires_at <= ?`, [new Date().toISOString()])
  for (const s of expired.rows) {
    for (const key of [s.original_key, s.thumb_key].filter(Boolean)) {
      try { await env.MEDIA.delete(key) } catch {}
    }
    await query(env, 'DELETE FROM stories WHERE id=?', [s.id])
  }
  // login_attempts GC (>7d) + media_upload_attempts GC (>1d)
  await query(env, `DELETE FROM login_attempts WHERE created_at < ?`, [new Date(Date.now() - 7 * 24 * 3600_000).toISOString()]).catch(() => {})
  await query(env, `DELETE FROM media_upload_attempts WHERE created_at < ?`, [new Date(Date.now() - 24 * 3600_000).toISOString()]).catch(() => {})
  return { cleanup, stories_purged: expired.rows.length }
}

export async function handlePending(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const user = ctx.user
  const method = request.method

  // GET /api/pending/mine
  if (path === '/api/pending/mine' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT q.*, u.username FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.user_id=? ORDER BY q.created_at DESC LIMIT 50`,
      [fresh.id],
    )
    const out = await Promise.all(rows.map(async r => ({ ...r, thumb_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 600) })))
    return jsonResponse({ pending: out })
  }

  // GET /api/pending?status=
  if (path === '/api/pending' && method === 'GET') {
    const fresh = await requireAdmin(env, user)
    const status = ['pending', 'rejected', 'transcoding'].includes(searchParams(url).status) ? searchParams(url).status : 'pending'
    const { rows } = await query(
      env,
      `SELECT q.*, u.username, u.name FROM pending_queue q JOIN users u ON u.id=q.user_id WHERE q.status=? ORDER BY q.created_at DESC LIMIT 100`,
      [status],
    )
    const out = await Promise.all(rows.map(async r => ({ ...r, thumb_url: await mediaUrlOrNull(env, r.thumb_key || r.original_key, 600) })))
    return jsonResponse({ pending: out })
  }

  // POST /api/pending/:id/approve
  if (/^\/api\/pending\/[^/]+\/approve$/.test(path) && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const id = path.split('/')[3]
    const { rows } = await query(env, 'SELECT * FROM pending_queue WHERE id=?', [id])
    const item = rows[0]
    if (!item) return errorResponse('not found', 404)
    if (item.status !== 'pending' && item.status !== 'transcoding') return errorResponse(`already ${item.status}`, 409)
    const u = await query(env, 'SELECT verified, group_name, constituency, faith FROM users WHERE id=?', [item.user_id])
    const snap = u.rows[0] || {}
    const now = new Date().toISOString()
    if (item.type === 'post') {
      await query(
        env,
        `INSERT INTO posts (id, user_id, caption, original_key, thumb_key, blurhash, width, height, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [item.id, item.user_id, item.caption, item.original_key, item.thumb_key, item.blurhash, item.width, item.height, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
      )
    } else if (item.type === 'story') {
      await query(
        env,
        `INSERT INTO stories (id, user_id, original_key, thumb_key, blurhash, expires_at) VALUES (?,?,?,?,?,?)`,
        [item.id, item.user_id, item.original_key, item.thumb_key, item.blurhash, new Date(Date.now() + 24 * 3600_000).toISOString()],
      )
    } else if (item.type === 'reel') {
      await query(
        env,
        `INSERT INTO reels (id, user_id, caption, hls_master_key, poster_key, thumb_key, verified_snapshot, group_name, constituency, faith, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [item.id, item.user_id, item.caption, item.hls_master_key || item.original_key, item.poster_key, item.thumb_key, snap.verified ? 1 : 0, snap.group_name, snap.constituency, snap.faith, now],
      )
    } else if (item.type === 'track') {
      await query(env, `INSERT INTO tracks (id, user_id, title, artist, original_key, preview_key) VALUES (?,?,?,?,?,?)`, [item.id, item.user_id, item.caption || 'Untitled', '', item.original_key, item.original_key])
    } else {
      return errorResponse('unsupported pending type', 400)
    }
    await query(env, 'DELETE FROM pending_queue WHERE id=?', [id])
    await query(
      env,
      `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,'approve',?,?,?,?)`,
      [fresh.id, item.type, item.id, JSON.stringify({ caption: item.caption }), now],
    ).catch(() => {})
    return jsonResponse({ ok: true, id, status: 'approved' })
  }

  // POST /api/pending/:id/reject
  if (/^\/api\/pending\/[^/]+\/reject$/.test(path) && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const id = path.split('/')[3]
    const body = await readJson(request)
    const reason = String(body.reason || '').trim().slice(0, 500)
    const { rows } = await query(
      env,
      `UPDATE pending_queue SET status='rejected', reviewed_by=?, reviewed_at=?, reject_reason=? WHERE id=? AND status='pending' RETURNING *`,
      [fresh.id, new Date().toISOString(), reason || null, id],
    )
    if (!rows[0]) return errorResponse('not found or not pending', 404)
    await query(
      env,
      `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,'reject','pending',?,?,?,?)`,
      [fresh.id, id, JSON.stringify({ reason: reason || null }), new Date().toISOString()],
    ).catch(() => {})
    return jsonResponse({ ok: true, id, status: 'rejected' })
  }

  // POST /api/pending/cleanup
  if (path === '/api/pending/cleanup' && method === 'POST') {
    await requireAdmin(env, user)
    return jsonResponse(await cleanupOrphanedUploads(env))
  }

  // POST /api/admin/verify/:username
  if (/^\/api\/admin\/verify\/[^/]+$/.test(path) && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const username = String(path.split('/')[4] || '').trim().toLowerCase()
    const body = await readJson(request)
    const { verified } = body
    if (!username || typeof verified !== 'boolean') return errorResponse('username and boolean verified are required', 400)
    const { rows } = await query(env, 'UPDATE users SET verified=? WHERE username=? RETURNING id, username, verified', [verified ? 1 : 0, username])
    if (!rows[0]) return errorResponse('user not found', 404)
    await query(
      env,
      `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,'verify_toggle','user',?,?,?,?)`,
      [fresh.id, rows[0].id, JSON.stringify({ verified }), new Date().toISOString()],
    ).catch(() => {})
    return jsonResponse({ ok: true, user: { ...rows[0], verified: !!rows[0].verified } })
  }

  return null
}
