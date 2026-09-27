// FCM device registration — storage only. Delivery (sending) is a later batch.
// POST /api/notifications/devices   { platform, fcm_token, installation_id, app_version? }
//   → registers or idempotently refreshes a device token for the signed-in user.
// DELETE /api/notifications/devices { fcm_token }
//   → removes a device registration; owner-only.
// The FCM token is write-only: it is accepted, stored, and never echoed back.
import { query, uuid, nowIso } from '../lib/db.js'
import { requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, httpError } from '../lib/http.js'

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
  if (path !== '/api/notifications/devices') return null

  const fresh = await requireMember(env, ctx.user)

  if (request.method === 'POST') {
    const { platform, fcmToken, installationId, appVersion } = validateRegistration(await readJson(request))
    const now = nowIso()
    // Idempotent by token: re-registering the same token refreshes it instead
    // of duplicating. Account switching on the same installation lands here
    // too — the conflict update moves the token to the newly signed-in user,
    // so the previous account never keeps receiving pushes on that device.
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
    // Token deliberately omitted — the client already holds it.
    return jsonResponse({
      ok: true,
      device: { platform, installation_id: installationId, app_version: appVersion, enabled: true, updated_at: now },
    })
  }

  if (request.method === 'DELETE') {
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

  return null
}
