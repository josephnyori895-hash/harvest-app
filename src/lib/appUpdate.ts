// In-app update check for the Capacitor Android build.
//
// The release pipeline stamps the Android versionCode as 1000 + run number
// and names the APK harvest-family-<run>-<sha>.apk, so GET /api/app-version
// reports the latest shipped versionCode. If the installed app is older,
// the UI offers the permanent download URL.
//
// Web builds (no Capacitor) never prompt — there is nothing to update.
import { Capacitor } from '@capacitor/core'

export const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export type UpdateInfo = {
  available: boolean
  versionCode?: number
  versionName?: string
  apkUrl?: string
}

const DISMISS_KEY = 'harvest_update_dismissed_code'
const DISMISS_HOURS = 24

function installedVersionCode(): number {
  // Config.versionCode is injected at Capacitor build time from
  // android/app/build.gradle's versionCode (1000 + run number).
  try {
    const code = Number((Capacitor as any)?.Config?.versionCode)
    return Number.isFinite(code) && code > 0 ? code : 0
  } catch {
    return 0
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  // Web/dev builds never prompt.
  if (!Capacitor.isNativePlatform?.()) return { available: false }
  try {
    const r = await fetch(`${BASE}/api/app-version`)
    if (!r.ok) return { available: false }
    const d = await r.json()
    const latest = Number(d?.version_code)
    if (!d?.update_available || !Number.isFinite(latest)) return { available: false }
    const installed = installedVersionCode()
    if (installed <= 0 || latest <= installed) return { available: false }
    return {
      available: true,
      versionCode: latest,
      versionName: String(d.version_name || ''),
      apkUrl: String(d.apk_url || '/harvest-family.apk'),
    }
  } catch {
    // Offline or endpoint unavailable — never nag on failure.
    return { available: false }
  }
}

// "Remind me later" suppresses the prompt for this version for a day.
export function dismissUpdate(versionCode: number) {
  try { localStorage.setItem(DISMISS_KEY, String(versionCode)) } catch { /* best-effort */ }
}

export function isDismissed(versionCode: number): boolean {
  try {
    if (Number(localStorage.getItem(DISMISS_KEY)) !== versionCode) return false
    return true
  } catch {
    return false
  }
}

export function openApkDownload(apkUrl: string) {
  const target = /^https?:\/\//.test(apkUrl) ? apkUrl : `${BASE}${apkUrl}`
  window.open(target, '_blank', 'noopener')
}
