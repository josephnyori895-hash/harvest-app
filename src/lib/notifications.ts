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


/** Schedule a small set of local project reminders after participation. */
export async function scheduleProjectReminders(project: { id: string; name: string; deadline?: string | null }, remainingKes: number): Promise<void> {
  const ln = await plugin()
  if (!ln || !project.deadline || remainingKes <= 0) return
  try {
    const current = await ln.checkPermissions()
    if (current.display !== 'granted') return
    const deadline = new Date(project.deadline).getTime()
    const now = Date.now()
    const reminders = [7, 1].map((days, index) => {
      const at = new Date(deadline - days * 86400000)
      return at.getTime() > now ? {
        id: 700000000 + Math.abs(hashCode(project.id)) % 1000000 + index,
        title: project.name,
        body: days === 1 ? `Your project commitment has 1 day left (KES ${remainingKes.toLocaleString()} remaining).` : `Your project commitment is due soon (KES ${remainingKes.toLocaleString()} remaining).`,
        channelId: NOTIF_CHANNEL,
        smallIcon: 'ic_launcher',
      } : null
    }).filter(Boolean) as any[]
    if (reminders.length) await ln.schedule({ notifications: reminders.map(x => ({ ...x, schedule: { at: new Date(x.body ? deadline - ([7,1][reminders.indexOf(x)] * 86400000) : deadline) } })) })
  } catch { /* reminders are best-effort and never block participation */ }
}

function hashCode(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0
  return h
}
