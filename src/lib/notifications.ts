// Local notifications: permission + delivery for chat DMs and admin announcements.
// Uses Capacitor LocalNotifications on Android/iOS; no-ops gracefully on web.
import { Capacitor } from '@capacitor/core'
import { apiGet } from './api'

type LN = typeof import('@capacitor/local-notifications').LocalNotifications

// Never resolve an async function with the Capacitor plugin proxy itself.
// The proxy answers every property access — including `then` — so a promise
// resolving to it is treated as a thenable and calls the missing native method
// `LocalNotifications.then()`. Wrapping it keeps Promise resolution ordinary.
type LoadedPlugin = { ln: LN }

async function loadPlugin(): Promise<LoadedPlugin | null> {
  if (!Capacitor.isNativePlatform?.()) return null
  try {
    const mod = await import('@capacitor/local-notifications')
    return { ln: mod.LocalNotifications }
  } catch {
    return null
  }
}

export const NOTIF_CHANNEL = 'messages'

/** Ask the user to grant notification permission (Android 13+ / iOS). Safe to call repeatedly. */
export async function requestNotificationPermission(): Promise<boolean> {
  const loaded = await loadPlugin()
  if (!loaded) return false
  const ln = loaded.ln
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
  const loaded = await loadPlugin()
  if (!loaded) return
  const ln = loaded.ln
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
  const loaded = await loadPlugin()
  if (!loaded) return
  const ln = loaded.ln
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

/**
 * Admin sign-in code as a real notification. FCM does not draw a notification
 * while the app is foregrounded, so a code needed by the browser was silent on a
 * phone being used at that moment. A local notification always lands in the
 * shade, which is where the admin looks when the sign-in screen says "check the
 * admin phone".
 */
export async function showAdminCodeNotification(code: string): Promise<void> {
  const digits = String(code || '').replace(/\D/g, '').slice(0, 8)
  if (!digits) return
  const loaded = await loadPlugin()
  if (!loaded) return
  const ln = loaded.ln
  try {
    const current = await ln.checkPermissions()
    if (current.display !== 'granted') return
    await ln.createChannel({
      id: 'admin-code',
      name: 'Admin sign-in codes',
      description: 'Verification codes for administrator sign-in',
      importance: 5,
      visibility: 1,
      vibration: true,
    })
    await ln.schedule({
      notifications: [{
        // One stable id: a newer code replaces the previous one instead of stacking.
        id: 730021,
        title: 'Harvest admin sign-in code',
        body: `${digits} — valid for 10 minutes. Type it in the browser.`,
        channelId: 'admin-code',
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
  // apiGet adds the bearer token, a timeout and one retry on a transient blip.
  const d = await apiGet<any>('/api/activity')
  const rows: any[] = []
  for (const m of d?.new_members || []) {
    rows.push({
      id: `activity:nm:${m.username}`,
      type: 'member_joined',
      category: 'family',
      title: `${m.name || m.username} joined the family`,
      body: `Joined ${m.group_name || 'Harvest Family Church'}`,
      created_at: m.created_at,
      actor: { username: m.username, name: m.name, verified: !!m.verified, avatar_url: m.avatar_url || undefined },
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
      actor: { username: f.username, name: f.name, verified: false, avatar_url: f.avatar_url || undefined },
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
      actor: { username: f.username, name: f.name, verified: false, avatar_url: f.avatar_url || undefined },
      read_at: null,
    })
  }
  return rows
}


/** Schedule local project reminders when a member still has a commitment outstanding. */
export async function scheduleProjectReminders(project: { id: string; name: string; deadline?: string | null }, remainingKes: number): Promise<void> {
  const loaded = await loadPlugin()
  if (!loaded || !project.deadline || remainingKes <= 0) return
  const ln = loaded.ln
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
