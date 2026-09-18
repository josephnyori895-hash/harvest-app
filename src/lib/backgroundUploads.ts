// Global background upload manager.
//
// Composers (PostCreate, StoryCreate, ReelCreate, Music admin) hand their
// upload here and close immediately — the user keeps using the app while a
// floating progress pill tracks the transfer and a toast announces the result.
//
// The promise runs independently of React; the pill re-renders via
// subscription, so navigating tabs never interrupts an in-flight upload.
import { showToast } from '../components/Toast'

export type BgUpload = {
  id: string
  label: string
  pct: number // 0..100
  startedAt: number
}

const states = new Map<string, BgUpload>()
const listeners = new Set<() => void>()

const emit = () => listeners.forEach(l => l())

export function subscribeUploads(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getUploads(): BgUpload[] {
  return [...states.values()].sort((a, b) => a.startedAt - b.startedAt)
}

// Upload with real progress via XMLHttpRequest (fetch cannot report upload
// progress). Resolves { ok, status } like a fetch response.
export function xhrSend(url: string, method: string, body: FormData | null, headers: Record<string, string> | undefined, onPct: (pct: number) => void): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    if (headers) Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
    xhr.onerror = () => reject(new Error('network error'))
    xhr.send(body)
  })
}

// Small JSON fetch helper for presign/confirm calls inside a job.
export async function apiJson(url: string, token: string, body: unknown, method = 'POST') {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data as any)?.error || `request failed (${r.status})`)
  return data
}

export function startBackgroundUpload(opts: {
  label: string
  successMsg: string
  run: (onPct: (pct: number) => void) => Promise<void>
}): Promise<void> {
  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  states.set(id, { id, label: opts.label, pct: 0, startedAt: Date.now() })
  emit()

  const promise = (async () => {
    try {
      await opts.run(pct => { states.set(id, { ...(states.get(id)!), pct: Math.min(99, Math.max(0, pct)) }); emit() })
      states.set(id, { ...(states.get(id)!), pct: 100 })
      emit()
      showToast(opts.successMsg, 'success', 3500)
      setTimeout(() => { states.delete(id); emit() }, 1500)
    } catch (e: any) {
      showToast(`${opts.label} failed — ${e?.message || 'try again'}`, 'error', 5000)
      setTimeout(() => { states.delete(id); emit() }, 800)
      throw e
    }
  })()

  // Swallow rejection: failures are surfaced by toast; callers that want to
  // await the promise can attach their own catch.
  promise.catch(() => {})
  return promise
}
