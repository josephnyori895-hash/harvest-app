import { Capacitor } from '@capacitor/core'

// Stable per-install identity for the single-admin device policy.
//
// device_id is the identity: it is created once, kept in storage across sign-in
// and sign-out, and sent with every admin login. The server keys a device row
// on it, so signing out and back in on the same phone or browser updates that
// row instead of adding a twin. Clearing site data (or reinstalling the app)
// deliberately looks like a new device — that is exactly when the phone code is
// required again.
//
// The label carries facts a person can use to tell devices apart: the browser
// and OS on the web, the app platform and phone model on Android, and a short
// code derived from the installation id so two identical-looking devices still
// differ. The full details are sent alongside for the admin's device list.
const NATIVE_KEY = 'harvest_installation_id'
const WEB_KEY = 'harvest_admin_device_id'

function safeGet(key: string) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}

function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode: sign-in still works */ }
}

function shortCode(id: string) {
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-4)
  return tail ? `#${tail.toUpperCase()}` : ''
}

function browserName(ua: string) {
  const m = ua.match(/(EdgiOS|Edg|OPiOS|OPR|SamsungBrowser|Chrome|CriOS|Firefox|FxiOS|Safari)\/(\d+)/)
  if (!m) return ''
  const names: Record<string, string> = {
    Edg: 'Edge', EdgiOS: 'Edge', OPR: 'Opera', OPiOS: 'Opera',
    SamsungBrowser: 'Samsung Internet', Chrome: 'Chrome', CriOS: 'Chrome',
    Firefox: 'Firefox', FxiOS: 'Firefox', Safari: 'Safari',
  }
  return `${names[m[1]] || m[1]} ${m[2]}`
}

function osName(ua: string, platform: string) {
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return platform || 'web'
}

// "Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A…)" → "Pixel 6"
function androidModel(ua: string) {
  const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/)
  const model = m ? m[1].trim() : ''
  return /^(wv|K|en-us)/i.test(model) ? '' : model.slice(0, 40)
}

function describe() {
  const ua = (() => { try { return String(navigator.userAgent || '') } catch { return '' } })()
  const platform = (() => { try { return Capacitor.getPlatform() } catch { return 'web' } })()
  const screen = (() => {
    try { return `${window.screen.width}x${window.screen.height}` } catch { return '' }
  })()
  return {
    browser: browserName(ua),
    os: osName(ua, platform),
    model: androidModel(ua),
    screen,
  }
}

export function adminDeviceIdentity() {
  const native = (() => { try { return Capacitor.isNativePlatform() } catch { return false } })()
  const platform = (() => { try { return Capacitor.getPlatform() } catch { return 'web' } })()
  // On the phone this is the SAME identifier push registration sends as
  // installation_id, so the server can push the login code to the one bound
  // phone instead of every device that ever registered for notifications.
  const key = native ? NATIVE_KEY : WEB_KEY
  let id = safeGet(key)
  if (!id) {
    try { id = crypto.randomUUID() } catch { id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
    safeSet(key, id)
  }
  const facts = describe()
  const code = shortCode(id)
  const label = native
    ? ['Harvest app', facts.os, facts.model, code].filter(Boolean).join(' · ')
    : [facts.browser || 'Browser', facts.os, code].filter(Boolean).join(' · ')
  return {
    device_id: id,
    device_kind: native ? 'mobile' : 'web',
    device_label: label.slice(0, 120),
    device_details: {
      platform: native ? platform : 'web',
      os: facts.os,
      browser: facts.browser,
      model: facts.model,
      screen: facts.screen,
    },
  }
}
