// Client-side FCM push — Android/APK only, fail-soft everywhere.
// Pipeline: get token → register with the trusted server → keep fresh on
// sign-in/account switch → disable on sign-out → route taps into the app.
// Requires google-services.json + @capacitor-firebase/messaging; without them
// every function below is a silent no-op, so builds and the web never break.
import { Capacitor } from '@capacitor/core'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type MessagingPlugin = {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' }>
  // @capacitor-firebase/messaging returns { token }. `value` is kept only so a
  // different plugin build lands on the same code path instead of silently
  // reporting "no token" — reading the wrong key here was exactly why the
  // device table stayed empty while the phone was otherwise healthy.
  getToken(options: { vapidKey?: string }): Promise<{ token?: string; value?: string }>
  deleteToken(): Promise<{ value?: boolean }>
  addListener(eventName: 'notificationReceived', cb: (n: any) => void): Promise<any>
  addListener(eventName: 'notificationActionPerformed', cb: (a: any) => void): Promise<any>
}

const INSTALL_KEY = 'harvest_installation_id'

function isNative(): boolean {
  try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' } catch { return false }
}

function getInstallationId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY)
    if (!id) {
      id = (crypto.randomUUID?.() || `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
      localStorage.setItem(INSTALL_KEY, id)
    }
    return id
  } catch { return 'unknown-installation' }
}

// Keep the Capacitor proxy inside an object: resolving a promise directly
// with the proxy makes JavaScript read its `then` property, which the native
// bridge treats as a missing method ("FirebaseMessaging.then() is not
// implemented"). A wrapper makes promise resolution ordinary.
type LoadedMessaging = { messaging: MessagingPlugin }

async function loadMessaging(): Promise<LoadedMessaging | null> {
  if (!isNative()) return null
  try {
    const mod: any = await import('@capacitor-firebase/messaging')
    const plugin = mod?.FirebaseMessaging
    // Graceful degradation when google-services.json is absent at build time:
    // the Capacitor plugin throws on method calls, so gate on a cheap probe.
    try { await plugin.removeAllListeners() } catch { return null }
    return { messaging: plugin as MessagingPlugin }
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

// Registration outcome, kept on the device so the phone itself can say why it
// is (or is not) receiving push. Without this every failure above was silent:
// the app looked signed in while no token ever reached the server, and the only
// symptom was an admin sign-in code that never arrived.
export type PushStatus = {
  state:
    | 'unsupported'   // web build — push is APK-only
    | 'signed-out'    // no session to attach a token to
    | 'plugin-missing' // @capacitor-firebase/messaging unavailable / Firebase config absent
    | 'permission-denied'
    | 'no-token'      // permission granted but Firebase returned no token
    | 'unreachable'   // token obtained, server call failed
    | 'registered'
    | 'error'
  detail?: string
  at: number
}

const STATUS_KEY = 'harvest_push_status'
const FCM_KEY = 'harvest_fcm_token'
export const PUSH_STATUS_EVENT = 'harvest:push-status'

// Listeners are bound once per app run: registerPush() is called on every
// session start and every return to the foreground, and re-binding there would
// stack duplicate notification handlers.
let listenersBound = false

function publish(status: PushStatus): PushStatus {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(status)) } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(PUSH_STATUS_EVENT, { detail: status })) } catch {}
  return status
}

export function getPushStatus(): PushStatus | null {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.state === 'string' ? parsed as PushStatus : null
  } catch { return null }
}

// Last token we managed to register — shown as a short fingerprint in the UI
// so two installs can be told apart without exposing the token.
export function getPushTokenHint(): string {
  try {
    const t = localStorage.getItem(FCM_KEY) || ''
    return t ? t.slice(-6) : ''
  } catch { return '' }
}

/** True on the Android app; the web build never shows push controls. */
export function isPushSupported(): boolean {
  return isNative()
}

function message(e: unknown): string {
  const text = e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message || '') : ''
  return text.slice(0, 120)
}

// Register (or refresh) the FCM token for the currently signed-in member.
// Idempotent and safe to call on every sign-in and account switch; the server
// dedupes by token and retires stale tokens from the same installation.
export async function registerPush(): Promise<PushStatus> {
  try {
    if (!isNative()) return publish({ state: 'unsupported', at: Date.now() })
    const username = localStorage.getItem('harvest_username') || ''
    const token = localStorage.getItem('harvest_token') || ''
    if (!username || !token) return publish({ state: 'signed-out', at: Date.now() })

    const loaded = await loadMessaging()
    if (!loaded) {
      return publish({ state: 'plugin-missing', at: Date.now() })
    }
    const messaging = loaded.messaging

    let granted = false
    try {
      const perm = await messaging.requestPermissions()
      granted = perm?.receive === 'granted'
    } catch (e) {
      return publish({ state: 'permission-denied', detail: message(e), at: Date.now() })
    }
    if (!granted) return publish({ state: 'permission-denied', at: Date.now() })

    let fcmToken = ''
    try {
      const vapidKey = (import.meta.env.VITE_FCM_VAPID_KEY as string | undefined) || undefined
      const result = await messaging.getToken(vapidKey ? { vapidKey } : {})
      fcmToken = String(result?.token || result?.value || '').trim()
    } catch (e) {
      // No Google Play services, a restricted API key, or an unregistered app
      // all land here. Keep the reason: it is the only clue on the device.
      return publish({ state: 'no-token', detail: message(e), at: Date.now() })
    }
    if (!fcmToken) return publish({ state: 'no-token', at: Date.now() })

    const response = await callApi('/api/notifications/devices', 'POST', {
      platform: 'android',
      fcm_token: fcmToken,
      installation_id: getInstallationId(),
      app_version: import.meta.env.VITE_APP_VERSION || null,
    })
    if (!response || !response.ok) {
      return publish({
        state: 'unreachable',
        detail: response ? `HTTP ${response.status}` : 'network',
        at: Date.now(),
      })
    }
    try { localStorage.setItem(FCM_KEY, fcmToken) } catch { /* private mode */ }

    if (!listenersBound) {
      listenersBound = true
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
    }

    return publish({ state: 'registered', at: Date.now() })
  } catch (e) {
    // push must never break sign-in
    return publish({ state: 'error', detail: message(e), at: Date.now() })
  }
}

// Sign-out: disable delivery for this installation without deleting the row,
// so a later sign-in re-enables it server-side.
export async function disablePushOnLogout(): Promise<void> {
  try {
    await callApi('/api/notifications/devices', 'PATCH', { installation_id: getInstallationId(), enabled: false })
  } catch {}
}

// Map server push `data` to the app's internal deep links.
function normalizeDeepLink(data: Record<string, string>): { tab: string; kind?: string; dm?: { id: string; username: string; name?: string }; slug?: string } {
  if (data.kind === 'chat') {
    if (data.type === 'dm' && data.peer) {
      return { tab: 'chat', kind: 'dm', dm: { id: data.peer_user_id || data.peer, username: data.peer, name: data.peer_name } }
    }
    return { tab: 'chat', kind: data.type || 'group', slug: data.slug || '' }
  }
  return { tab: data.deep_link?.replace(/^\//, '') || 'home' }
}
