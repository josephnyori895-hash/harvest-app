// Local notifications: permission + delivery for chat DMs and admin announcements.
// Uses Capacitor LocalNotifications on Android/iOS; no-ops gracefully on web.
import { Capacitor } from '@capacitor/core'

type LN = typeof import('@capacitor/local-notifications').LocalNotifications

async function plugin(): Promise<LN | null> {
  if (!Capacitor.isNativePlatform?.()) return null
  try {
    const mod = await import('@capacitor/local-notifications')
    return mod.LocalNotifications
  } catch {
    return null
  }
}

export const NOTIF_CHANNEL = 'messages'

/** Ask the user to grant notification permission (Android 13+ / iOS). Safe to call repeatedly. */
export async function requestNotificationPermission(): Promise<boolean> {
  const ln = await plugin()
  if (!ln) return false
  try {
    const current = await ln.checkPermissions()
    if (current.display === 'granted') return true
    if (current.display === 'denied') return false
    const result = await ln.requestPermissions()
    return result.display === 'granted'
  } catch {
    return false
  }
}

/** Create the messages channel (Android 8+). Idempotent. */
export async function ensureNotificationChannel(): Promise<void> {
  const ln = await plugin()
  if (!ln) return
  try {
    await ln.createChannel({
      id: NOTIF_CHANNEL,
      name: 'Messages & announcements',
      description: 'Chat messages and church announcements',
      importance: 5, // IMPORTANCE_HIGH — heads-up + badge
      visibility: 1, // VISIBILITY_PUBLIC — show on lock screen
      vibration: true,
    })
  } catch { /* channel exists or unsupported */ }
}

/** Fire a local notification. Silently ignored without permission/native. */
export async function showMessageNotification(from: string, text: string, id: number): Promise<void> {
  const ln = await plugin()
  if (!ln) return
  try {
    const current = await ln.checkPermissions()
    if (current.display !== 'granted') return
    await ln.schedule({
      notifications: [{
        id,
        title: from,
        body: text.slice(0, 200),
        channelId: NOTIF_CHANNEL,
        smallIcon: 'ic_launcher',
        ongoing: false,
      }],
    })
  } catch { /* never crash the app over a notification */ }
}

/** Called once after successful sign-in. */
export async function initNotifications(): Promise<void> {
  await ensureNotificationChannel()
  await requestNotificationPermission()
}

/**
 * Family-directory activity (new members, follows in/out) normalized into
 * notification-shaped rows so the single inbox can carry both.
 */
export async function fetchFamilyActivity(): Promise<any[]> {
  const token = localStorage.getItem('harvest_token') || ''
  const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
  const r = await fetch(`${API}/api/activity`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!r.ok) throw new Error('Could not load family activity')
  const d = await r.json()
  const rows: any[] = []
  for (const m of d?.new_members || []) {
    rows.push({
      id: `activity:nm:${m.username}`,
      type: 'member_joined',
      category: 'family',
      title: `${m.name || m.username} joined the family`,
      body: `Joined ${m.group_name || 'Harvest Family Church'}`,
      created_at: m.created_at,
      actor: { username: m.username, name: m.name, verified: !!m.verified },
      read_at: null,
    })
  }
  for (const f of d?.follows_in || []) {
    rows.push({
      id: `activity:fi:${f.username}`,
      type: 'followed_you',
      category: 'family',
      title: `${f.name || f.username} started following you`,
      body: '',
      created_at: f.created_at,
      actor: { username: f.username, name: f.name, verified: false },
      read_at: null,
    })
  }
  for (const f of d?.follows_out || []) {
    rows.push({
      id: `activity:fo:${f.username}`,
      type: 'you_followed',
      category: 'family',
      title: `You followed ${f.name || f.username}`,
      body: '',
      created_at: f.created_at,
      actor: { username: f.username, name: f.name, verified: false },
      read_at: null,
    })
  }
  return rows
}


/** Schedule local project reminders when a member still has a commitment outstanding. */
export async function scheduleProjectReminders(project: { id: string; name: string; deadline?: string | null }, remainingKes: number): Promise<void> {
  const ln = await plugin()
  if (!ln || !project.deadline || remainingKes <= 0) return
  try {
    const current = await ln.checkPermissions()
    if (current.display !== 'granted') return
    const deadline = new Date(project.deadline).getTime()
    const now = Date.now()
    const days = [7, 1]
    const notifications = days.map((day, index) => {
      const at = new Date(deadline - day * 86400000)
      if (at.getTime() <= now) return null
      return {
        id: 700000000 + Math.abs(hashCode(project.id)) % 1000000 + index,
        title: project.name,
        body: day === 1
          ? `Your project commitment has 1 day left (KES ${remainingKes.toLocaleString()} remaining).`
          : `Your project commitment is due soon (KES ${remainingKes.toLocaleString()} remaining).`,
        channelId: NOTIF_CHANNEL,
        smallIcon: 'ic_launcher',
        schedule: { at },
      }
    }).filter(Boolean) as any[]
    if (notifications.length) await ln.schedule({ notifications })
  } catch { /* reminders are best-effort and never block participation */ }
}

function hashCode(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0
  return h
}
