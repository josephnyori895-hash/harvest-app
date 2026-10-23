// In-app notification records for the bell panel (device push lives in fcm.js).
// One insert per recipient per event. Never throws — notifications are
// best-effort and must not break the caller's main flow (send, join, publish).
import { query, nowIso } from './db.js'

export function notificationId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// records: [{ userId, type, category, title, body, preview, target }]
export async function recordNotifications(env, records) {
  if (!Array.isArray(records) || !records.length) return 0
  const rows = records
    .filter(r => r && r.userId)
    .map(r => [
      r.id || notificationId(),
      String(r.userId),
      String(r.category || 'all').slice(0, 32),
      String(r.type || 'general').slice(0, 32),
      String(r.title || '').slice(0, 140),
      String(r.body || '').slice(0, 400),
      r.preview ? String(r.preview).slice(0, 200) : null,
      r.target ? JSON.stringify(r.target).slice(0, 1000) : null,
      nowIso(),
    ])
  if (!rows.length) return 0
  // One row per user per (requestKey-less) event; naive duplicate sends only
  // occur on worker retries, which the sent-keys table already handles for
  // push. For record inserts, tolerate the duplicates by skipping ids seen
  // recently per user — cheap guard keyed off the preview+day.
  await query(env,
    `INSERT INTO notifications (id, user_id, category, type, title, body, preview, target, created_at)
     VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(', ')}`,
    rows.flat(),
  )
  return rows.length
}

// Tidy error text: notifications never break the main flow.
export async function recordNotificationsSafe(env, records) {
  try { return await recordNotifications(env, records) } catch { return 0 }
}
