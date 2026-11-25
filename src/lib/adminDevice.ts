import { Capacitor } from '@capacitor/core'

// Stable per-install identity for the single-admin device policy. The server
// sees one phone (Capacitor) and one browser; clearing site data deliberately
// looks like a new browser, which is exactly when the phone code is required.
export function adminDeviceIdentity() {
  const native = (() => { try { return Capacitor.isNativePlatform() } catch { return false } })()
  const platform = (() => { try { return Capacitor.getPlatform() } catch { return 'web' } })()
  // On the phone, use the SAME identifier push registration sends as
  // installation_id. The server can then push the login code to the one bound
  // phone instead of every device that ever registered for notifications.
  const key = native ? 'harvest_installation_id' : 'harvest_admin_device_id'
  let id = ''
  try { id = localStorage.getItem(key) || '' } catch { id = '' }
  if (!id) {
    try { id = crypto.randomUUID() } catch { id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
    try { localStorage.setItem(key, id) } catch { /* private mode: login still works, but a refresh looks like a new browser */ }
  }
  return {
    device_id: id,
    device_kind: native ? 'mobile' : 'web',
    device_label: native ? `Harvest app · ${platform}` : `Browser · ${String(navigator.platform || 'web').slice(0, 40)}`,
  }
}
