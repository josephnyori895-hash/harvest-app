// In-app update check for the Capacitor Android build.
//
// The release pipeline stamps the Android versionCode as 1000 + run number
// and names the APK harvest-family-<run>-<sha>.apk, so GET /api/app-version
// reports the latest shipped versionCode. If the installed app is older,
// the UI offers the permanent download URL.
//
// Web builds (no Capacitor) never prompt — there is nothing to update.
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

export const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export type UpdateInfo = {
  available: boolean
  versionCode?: number
  versionName?: string
  apkUrl?: string
}

const DISMISS_KEY = 'harvest_update_dismissed_code'
const DISMISS_HOURS = 24

// The installed build has to come from the native package, not from config.
// Nothing in this repo injects versionCode into Capacitor.Config — the value
// only exists in android/app/build.gradle — so reading Config.versionCode gave
// 0 on every device and checkForUpdate returned available:false forever, which
// is why an out-of-date install (Waydroid, 1629 against a 1630 release) never
// saw the prompt. App.getInfo() is async and reads the package manager:
//   build   = versionCode of the installed APK ("1629")
//   version = versionName of the installed APK ("1.0.629")
async function installedVersion(): Promise<{ code: number; name: string }> {
  let code = 0
  let name = ''
  try {
    const info = await App.getInfo()
    name = String(info?.version || '')
    const build = Number(info?.build)
    if (Number.isFinite(build) && build > 0) code = build
  } catch {
    // Plugin unavailable (web build) — fall through to the config fallback.
  }
  if (!code) {
    try {
      const injected = Number((Capacitor as any)?.Config?.versionCode)
      if (Number.isFinite(injected) && injected > 0) code = injected
    } catch { /* best-effort */ }
  }
  return { code, name }
}

function versionParts(v: string): number[] {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map(p => Number(p))
    .filter(n => Number.isFinite(n))
}

// Name comparison is the fallback when the build number is unreadable: an
// install we cannot measure must still be able to learn it is behind.
function compareVersionNames(a: string, b: string): number {
  const x = versionParts(a)
  const y = versionParts(b)
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  // Web/dev builds never prompt.
  if (!Capacitor.isNativePlatform?.()) return { available: false }
  try {
    const r = await fetch(`${BASE}/api/app-version`)
    if (!r.ok) return { available: false }
    const d = await r.json()
    if (!d?.update_available) return { available: false }
    const latest = Number(d?.version_code)
    const latestName = String(d?.version_name || '')
    const { code: installed, name: installedName } = await installedVersion()
    const newer = installed > 0 && Number.isFinite(latest)
      ? latest > installed
      : Boolean(installedName && latestName) && compareVersionNames(latestName, installedName) > 0
    if (!newer) return { available: false }
    return {
      available: true,
      versionCode: Number.isFinite(latest) ? latest : 0,
      versionName: latestName,
      apkUrl: String(d.apk_url || '/harvest-family.apk'),
    }
  } catch {
    // Offline or endpoint unavailable — never nag on failure.
    return { available: false }
  }
}

// "Remind me later" is a snooze, not a mute, so the prompt has to come back.
// The first version stored only the code and compared it forever, which meant a
// member who tapped Later was never told about that release again — and
// DISMISS_HOURS sat unused. Store the code with an expiry and honour both.
export function dismissUpdate(versionCode: number) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({
      code: Number(versionCode) || 0,
      until: Date.now() + DISMISS_HOURS * 60 * 60 * 1000,
    }))
  } catch { /* best-effort */ }
}

export function isDismissed(versionCode: number): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    let code = 0
    let until = 0
    if (raw.trim().startsWith('{')) {
      const saved = JSON.parse(raw) as { code?: number; until?: number }
      code = Number(saved?.code) || 0
      until = Number(saved?.until) || 0
    } else {
      // Plain-number value written by builds before the snooze expiry existed:
      // it muted that version permanently, so treat it as already expired.
      code = Number(raw) || 0
      until = 0
    }
    if (code !== Number(versionCode)) return false
    return until > Date.now()
  } catch {
    return false
  }
}

export function openApkDownload(apkUrl: string) {
  const target = /^https?:\/\//.test(apkUrl) ? apkUrl : `${BASE}${apkUrl}`
  // In the Android WebView, '_blank' is a throwaway window that saves nothing —
  // verified on Waydroid: tapping Update dropped the app to the launcher and
  // /sdcard/Download stayed empty. '_system' hands the URL to the OS browser,
  // which is the only path that can actually download and install an APK. Web
  // builds keep the ordinary tab behaviour.
  const native = Boolean(Capacitor.isNativePlatform?.())
  window.open(target, native ? '_system' : '_blank', 'noopener')
}
