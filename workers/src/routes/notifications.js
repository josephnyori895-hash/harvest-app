// FCM device registration + delivery controls — device lifecycle route.
// The delivery engine lives in lib/fcm.js; this route owns registration:
//   POST   /api/notifications/devices        register / idempotently refresh a token
//   PATCH  /api/notifications/devices        enable/disable (sign-out, mute) or rotate
//   DELETE /api/notifications/devices        unregister (owner-only)
//   POST   /api/notifications/devices/test   test push to the caller's own devices
//   GET    /api/notifications/deliveries     caller's own delivery log (debugging)
// The FCM token is write-only: accepted, stored, never echoed back.
import { query, uuid, nowIso } from '../lib/db.js'
import { requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, httpError } from '../lib/http.js'
import { sendFanOut } from '../lib/fcm.js'
import { mediaUrlOrNull } from '../lib/media.js'

const PLATFORMS = new Set(['android', 'ios', 'web'])

// Registration body validation. Strict on purpose: this is the write path for
// a credential, so unknown/garbage input is rejected rather than coerced.
function validateRegistration(body) {
  const platform = String(body?.platform || '').trim().toLowerCase()
  if (!PLATFORMS.has(platform)) throw httpError(400, 'platform must be android, ios or web')

  const fcmToken = String(body?.fcm_token || '').trim()
  if (!fcmToken || fcmToken.length > 4096) throw httpError(400, 'fcm_token is required (max 4096 chars)')

  const installationId = String(body?.installation_id || '').trim()
  if (!installationId || installationId.length > 128) throw httpError(400, 'installation_id is required (max 128 chars)')

  const appVersionRaw = body?.app_version
  const appVersion = appVersionRaw === undefined || appVersionRaw === null ? null : String(appVersionRaw).trim().slice(0, 64) || null

  return { platform, fcmToken, installationId, appVersion }
}

export async function handleNotifications(request, env, ctx) {
  const path = new URL(request.url).pathname
  const NOTIFICATION_PATHS = new Set([
    '/api/notifications/devices',
    '/api/notifications/devices/test',
    '/api/notifications/deliveries',
  ])
  // In-app record routes: GET list, POST mark one read, POST mark all read.
  const listMatch = path === '/api/notifications' || path === '/api/notifications/read-all' || path.match(/^\/api\/notifications\/([^/]+)\/read$/)
  if (!NOTIFICATION_PATHS.has(path) && !listMatch) return null

  const fresh = await requireMember(env, ctx.user)

  // ── POST /api/notifications/read-all — mark everything read for caller ──
  if (path === '/api/notifications/read-all' && request.method === 'POST') {
    await query(env, 'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [nowIso(), fresh.id])
    return jsonResponse({ ok: true })
  }

  // ── POST /api/notifications/:id/read — owner-only mark-read ──
  if (listMatch && listMatch[1] && request.method === 'POST') {
    const { rows } = await query(env, 'UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', [nowIso(), listMatch[1], fresh.id])
    const changed = Number(rows?.meta?.changes ?? 0) > 0
    if (!changed && !(await query(env, 'SELECT 1 FROM notifications WHERE id=? AND user_id=?', [listMatch[1], fresh.id])).rows[0]) return errorResponse('not found', 404)
    return jsonResponse({ ok: true })
  }

  // ── GET /api/notifications — newest records for caller ──
  if (path === '/api/notifications' && request.method === 'GET') {
    const url = new URL(request.url)
    const limitRaw = Number(url.searchParams.get('limit') || 60)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 60, 1), 200)
    const offsetRaw = Number(url.searchParams.get('offset') || 0)
    const offset = Math.max(Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0, 0)
    // The page and the true unread total in one round trip: the badge used to
    // be computed from the loaded page only, so it silently capped at 40.
    const [{ rows }, unreadRow] = await Promise.all([
      query(
        env,
        `SELECT id, category, type, title, body, preview, target, created_at, read_at
         FROM notifications WHERE user_id=?
         ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [fresh.id, limit, offset],
      ),
      query(env, 'SELECT COUNT(*) AS unread FROM notifications WHERE user_id=? AND read_at IS NULL', [fresh.id]),
    ])
    const parsed = rows.map(r => {
      try { return r.target ? JSON.parse(r.target) : null } catch { return null }
    })
    // Resolve every distinct actor in one query instead of one per row (a
    // 40-row page was 40 sequential D1 round trips).
    const actorIds = [...new Set(parsed.map(t => t?.actor_user_id).filter(Boolean).map(String))]
    const actors = new Map()
    if (actorIds.length) {
      const placeholders = actorIds.map(() => '?').join(',')
      const { rows: users } = await query(
        env,
        `SELECT id, username, name, avatar_key FROM users WHERE id IN (${placeholders})`,
        actorIds,
      )
      await Promise.all(users.map(async u => {
        const avatarUrl = u.avatar_key ? await mediaUrlOrNull(env, u.avatar_key, 900) : null
        // username is required for tap routing (profile opens) — without it the
        // panel could render the row but had nothing to navigate to.
        actors.set(String(u.id), { name: u.name || u.username, username: u.username, avatar_url: avatarUrl || undefined })
      }))
    }
    const out = rows.map((r, i) => {
      const target = parsed[i]
      return {
        id: r.id,
        category: r.category,
        type: r.type,
        title: r.title,
        body: r.body,
        preview: r.preview || undefined,
        target: { ...(target || {}), type: target?.type || r.type, id: target?.id },
        actor: actors.get(String(target?.actor_user_id)) || (r.title ? { name: r.title } : { name: 'Harvest Family' }),
        created_at: r.created_at,
        read_at: r.read_at || null,
      }
    })
    return jsonResponse({
      notifications: out,
      unread: Number(unreadRow.rows[0]?.unread) || 0,
      nextOffset: offset + out.length,
      hasMore: out.length === limit,
    })
  }

  // ── POST /api/notifications/devices — register or refresh ──
  if (path === '/api/notifications/devices' && request.method === 'POST') {
    const { platform, fcmToken, installationId, appVersion } = validateRegistration(await readJson(request))
    const now = nowIso()
    // Idempotent by token: re-registering refreshes instead of duplicating.
    // Token rotation (Firebase periodically rotates) arrives here as a new
    // token with the same installation_id — the old token for that
    // installation is retired so only one live row per installation remains.
    // Account switching on the same installation also lands here: the
    // conflict update moves the token to the newly signed-in user.
    await query(
      env,
      `INSERT INTO notification_devices
         (id, user_id, platform, fcm_token, installation_id, app_version, enabled, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(fcm_token) DO UPDATE SET
         user_id = excluded.user_id,
         platform = excluded.platform,
         installation_id = excluded.installation_id,
         app_version = excluded.app_version,
         enabled = 1,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
      [uuid(), fresh.id, platform, fcmToken, installationId, appVersion, now, now, now],
    )
    // Retire any OTHER token previously registered for this installation so
    // rotation does not leave a stale second row behind.
    await query(
      env,
      `DELETE FROM notification_devices WHERE installation_id = ? AND fcm_token != ?`,
      [installationId, fcmToken],
    )
    return jsonResponse({ ok: true, registered: true })
  }

  // ── PATCH /api/notifications/devices — enable/disable (sign-out, mute) ──
  if (path === '/api/notifications/devices' && request.method === 'PATCH') {
    const body = await readJson(request)
    const enabled = body?.enabled === undefined ? undefined : (body.enabled === true || body.enabled === 1 || body.enabled === 'true' ? 1 : 0)
    if (enabled === undefined) return errorResponse('enabled (boolean) is required', 400)
    const installationId = String(body?.installation_id || '').trim()
    const fcmToken = String(body?.fcm_token || '').trim()
    if (!installationId && !fcmToken) return errorResponse('installation_id or fcm_token required', 400)
    // Owner-scoped: a member can only flip their own devices.
    const { rows } = await query(
      env,
      `UPDATE notification_devices SET enabled = ?, updated_at = ?,
              last_seen_at = last_seen_at
        WHERE user_id = ? AND (${fcmToken ? 'fcm_token = ?' : 'installation_id = ?'})`,
      enabled === 1
        ? [enabled, nowIso(), fresh.id, fcmToken || installationId]
        : [enabled, nowIso(), fresh.id, fcmToken || installationId],
    )
    if (!rows.length && !rows.meta?.changes) {
      const check = await query(env, `SELECT id FROM notification_devices WHERE user_id = ? AND (${fcmToken ? 'fcm_token = ?' : 'installation_id = ?'})`, [fresh.id, fcmToken || installationId])
      if (!check.rows[0]) return errorResponse('device not found for this account', 404)
    }
    return jsonResponse({ ok: true, enabled: enabled === 1 })
  }

  // ── DELETE /api/notifications/devices — unregister (owner-only) ──
  if (path === '/api/notifications/devices' && request.method === 'DELETE') {
    const body = await readJson(request)
    const fcmToken = String(body?.fcm_token || '').trim()
    if (!fcmToken) return errorResponse('fcm_token is required', 400)
    // Owner-only: scope by the authenticated user so one member can never
    // unregister another member's device by guessing tokens.
    const { rows } = await query(
      env,
      'SELECT id FROM notification_devices WHERE fcm_token = ? AND user_id = ?',
      [fcmToken, fresh.id],
    )
    if (!rows.length) throw httpError(404, 'device registration not found for this account')
    await query(env, 'DELETE FROM notification_devices WHERE fcm_token = ? AND user_id = ?', [fcmToken, fresh.id])
    return jsonResponse({ ok: true })
  }

  // ── POST /api/notifications/devices/test — push to the caller's own devices ──
  if (path === '/api/notifications/devices/test' && request.method === 'POST') {
    const { rows } = await query(
      env,
      'SELECT id FROM notification_devices WHERE user_id = ? AND enabled = 1',
      [fresh.id],
    )
    if (!rows.length) return errorResponse('no enabled devices registered for this account', 404)
    const summary = await sendFanOut(env, {
      recipients: [fresh.id],
      title: 'Harvest Family test notification',
      body: `Push delivery works — ${fresh.username} @ ${nowIso().slice(0, 16).replace('T', ' ')}`,
      data: { kind: 'test', deep_link: '/home' },
      collapseKey: 'test',
      actor: fresh.username,
    })
    return jsonResponse({ ok: !summary.disabled, ...summary })
  }

  // ── GET /api/notifications/deliveries — caller's own delivery log ──
  if (path === '/api/notifications/deliveries' && request.method === 'GET') {
    const { rows } = await query(
      env,
      `SELECT title, body, ok, status, error, actor, created_at
         FROM notification_deliveries
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 50`,
      [fresh.id],
    )
    return jsonResponse({ deliveries: rows.map(r => ({ ...r, ok: !!r.ok })) })
  }

  return null
}
