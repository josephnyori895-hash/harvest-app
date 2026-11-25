import { query } from '../lib/db.js'
import { jsonResponse, errorResponse } from '../lib/http.js'

// Operational checks stay read-only. Support must never change data or call a
// provider: the admin sees what is wrong, then follows a link to the existing
// workflow that owns the fix.
async function count(env, sql, params = []) {
  const { rows } = await query(env, sql, params)
  return Number(rows[0]?.n || 0)
}

export async function handleAdminHealth(request, env, { user }) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/admin/health') return null
  if (request.method !== 'GET') return errorResponse('method not allowed', 405)
  if (!user || user.role !== 'admin') return errorResponse('admin required', 403)

  const checks = []
  let databaseOk = true
  try {
    await query(env, 'SELECT 1 AS ok')
  } catch {
    databaseOk = false
  }
  if (!databaseOk) {
    checks.push({
      id: 'database',
      label: 'Member database',
      status: 'error',
      detail: 'The database did not answer. Do not save or publish until this recovers.',
      action: { tab: 'support', label: 'Run checks again' },
    })
  } else {
    checks.push({
      id: 'database',
      label: 'Member database',
      status: 'ok',
      detail: 'Members, giving, content and audit records are reachable.',
      action: null,
    })
  }

  checks.push({
    id: 'media',
    label: 'Media storage',
    status: env.MEDIA ? 'ok' : 'error',
    detail: env.MEDIA
      ? 'Photos, videos, sermon audio and advert images can be stored.'
      : 'The media bucket is not connected. New uploads will fail until it is restored.',
    action: null,
  })

  if (databaseOk) {
    const pending = await count(env, "SELECT COUNT(*) AS n FROM pending_queue WHERE status IN ('pending','transcoding')")
    checks.push({
      id: 'approvals',
      label: 'Content awaiting approval',
      status: pending > 0 ? 'warning' : 'ok',
      detail: pending > 0
        ? `${pending} upload${pending === 1 ? '' : 's'} waiting for review. Members cannot see them until approved.`
        : 'No uploads are waiting for review.',
      action: pending > 0 ? { tab: 'moderation', label: 'Review approvals' } : null,
    })

    const now = new Date().toISOString()
    const due = await count(env, "SELECT COUNT(*) AS n FROM content_publications WHERE status='scheduled' AND scheduled_at <= ?", [now])
    const failed = await count(env, "SELECT COUNT(*) AS n FROM content_publications WHERE status='scheduled' AND attempts > 0 AND last_error IS NOT NULL")
    checks.push({
      id: 'publishing',
      label: 'Publishing calendar',
      status: failed > 0 ? 'error' : due > 0 ? 'warning' : 'ok',
      detail: failed > 0
        ? `${failed} scheduled item${failed === 1 ? '' : 's'} failed to publish. Open the calendar to retry or correct the schedule.`
        : due > 0
          ? `${due} scheduled item${due === 1 ? ' is' : 's are'} due now and will publish on the next sweep.`
          : 'No scheduled publications are overdue or failed.',
      action: due > 0 || failed > 0 ? { tab: 'publishing', label: 'Open calendar' } : null,
    })

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const failedPush = await count(env, 'SELECT COUNT(*) AS n FROM notification_deliveries WHERE ok=0 AND created_at >= ?', [since])
    const devices = await count(env, 'SELECT COUNT(*) AS n FROM notification_devices WHERE enabled=1')
    checks.push({
      id: 'notifications',
      label: 'Push notifications',
      status: failedPush > 0 ? 'warning' : 'ok',
      detail: failedPush > 0
        ? `${failedPush} push attempt${failedPush === 1 ? '' : 's'} failed in the last 24 hours. Announcements still reach the in-app inbox; review the announcement and device registrations.`
        : devices > 0
          ? `${devices} device${devices === 1 ? '' : 's'} registered and receiving notifications.`
          : 'No devices have enabled push yet. The in-app notification inbox still works.',
      action: failedPush > 0 ? { tab: 'announce', label: 'Open announcements' } : null,
    })
  }

  const status = checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warning')
      ? 'warning'
      : 'ok'

  return jsonResponse({
    status,
    checked_at: new Date().toISOString(),
    checks,
  })
}
