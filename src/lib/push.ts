// Client-side FCM push — Android/APK only, fail-soft everywhere.
// Pipeline: get token → register with the trusted server → keep fresh on
// sign-in/account switch → disable on sign-out → route taps into the app.
// Requires google-services.json + @capacitor-firebase/messaging; without them
// every function below is a silent no-op, so builds and the web never break.
import { Capacitor } from '@capacitor/core'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type MessagingPlugin = {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' }>
  getToken(options: { vapidKey?: string }): Promise<{ value?: string }>
  deleteToken(): Promise<{ value?: boolean }>
  addListener(eventName: 'notificationReceived', cb: (n: any) => void): Promise<any>
  addListener(eventName: 'notificationActionPerformed', cb: (a: any) => void): Promise<any>
}

const INSTALL_KEY = 'harvest_installation_id'
const TOKEN_KEY = 'harvest_fcm_token'
const LAST_USER_KEY = 'harvest_fcm_last_user'

function isNative(): boolean {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' } catch { return false }
}

export function getInstallationId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY)
    if (!id) {
      id = (crypto.randomUUID?.() || `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
      localStorage.setItem(INSTALL_KEY, id)
    }
    return id
  } catch { return 'unknown-installation' }
}

async function loadMessaging(): Promise<MessagingPlugin | null> {
  if (!isNative()) return null
  try {
    const mod: any = await import('@capacitor-firebase/messaging')
    const plugin = mod?.FirebaseMessaging
    // Graceful degradation when google-services.json is absent at build time:
    // the Capacitor plugin throws on method calls, so gate on a cheap probe.
    try { await plugin.removeAllListeners() } catch { return null }
    return plugin as MessagingPlugin
  } catch { return null }
}

function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem('harvest_token') || ''
    return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : {}
  } catch { return {} }
}

async function callApi(path: string, method: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(`${API}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch { return null }
}

async function acquireToken(messaging: MessagingPlugin): Promise<string | null> {
  try {
    const perm = await messaging.requestPermissions()
    if (perm?.receive !== 'granted') return null
    const vapidKey = (import.meta.env.VITE_FCM_VAPID_KEY as string | undefined) || undefined
    const { value } = await messaging.getToken(vapidKey ? { vapidKey } : {})
    return value || null
  } catch { return null }
}

// Register (or refresh) the FCM token for the currently signed-in member.
// Idempotent and safe to call on every sign-in and account switch; the server
// dedupes by token and retires stale tokens from the same installation.
export async function registerPush(): Promise<void> {
  try {
    const username = localStorage.getItem('harvest_username') || ''
    const token = localStorage.getItem('harvest_token') || ''
    if (!isNative() || !username || !token) return
    const messaging = await loadMessaging()
    if (!messaging) return

    const fcmToken = await acquireToken(messaging)
    if (!fcmToken) return
    localStorage.setItem(TOKEN_KEY, fcmToken)

    const res = await callApi('/api/notifications/devices', 'POST', {
      platform: 'android',
      fcm_token: fcmToken,
      installation_id: getInstallationId(),
      app_version: import.meta.env.VITE_APP_VERSION || null,
    })
    if (res?.ok) localStorage.setItem(LAST_USER_KEY, username)

    // Foreground deliveries: surface via the in-app toast channel if present.
    await messaging.addListener('notificationReceived', (notification: any) => {
      try { window.dispatchEvent(new CustomEvent('harvest:push-received', { detail: notification })) } catch {}
    })
    // Tap routing: emit a single app-level event with a normalized deep link.
    await messaging.addListener('notificationActionPerformed', (action: any) => {
      try {
        const data = action?.notification?.data || {}
        window.dispatchEvent(new CustomEvent('harvest:push-tap', { detail: normalizeDeepLink(data) }))
      } catch {}
    })
  } catch { /* push must never break sign-in */ }
}

// Account switch: re-register so the server moves this installation's token
// to the newly signed-in member.
export async function onAccountSwitched(): Promise<void> {
  try {
    const username = localStorage.getItem('harvest_username') || ''
    if (!username) return
    if (localStorage.getItem(LAST_USER_KEY) === username) { await registerPush(); return }
    try { localStorage.removeItem(TOKEN_KEY) } catch {}
    await registerPush()
  } catch {}
}

// Sign-out: disable delivery for this installation without deleting the row,
// so a later sign-in re-enables it server-side.
export async function disablePushOnLogout(): Promise<void> {
  try {
    await callApi('/api/notifications/devices', 'PATCH', { installation_id: getInstallationId(), enabled: false })
  } catch {}
}

// Full unregister (e.g. explicit account removal).
export async function unregisterPush(): Promise<void> {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || ''
    if (token) await callApi('/api/notifications/devices', 'DELETE', { fcm_token: token })
    try { localStorage.removeItem(TOKEN_KEY) } catch {}
  } catch {}
}

// Map server push `data` to the app's internal deep links.
export function normalizeDeepLink(data: Record<string, string>): { tab: string; kind?: string; dm?: { id: string; username: string; name?: string }; slug?: string } {
  if (data.kind === 'chat') {
    if (data.type === 'dm' && data.peer) {
      return { tab: 'chat', kind: 'dm', dm: { id: data.peer_user_id || data.peer, username: data.peer, name: data.peer_name } }
    }
    return { tab: 'chat', kind: data.type || 'group', slug: data.slug || '' }
  }
  return { tab: data.deep_link?.replace(/^\//, '') || 'home' }
}
