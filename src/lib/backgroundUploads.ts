// Global background upload manager with automatic retry.
//
// Composers (PostCreate, StoryCreate, ReelCreate, Music admin) hand a task
// here and close immediately. Uploads run independently of React; a floating
// pill tracks progress on every screen. Failed transfers (network loss,
// server 5xx/429/rate-limit) are queued — persisted to IndexedDB so they
// survive app restarts — and retried automatically when connectivity
// returns. Backoff: 15s → 1m → 3m → 10m, 5 attempts total, then the user
// is told plainly that it gave up. Validation errors (4xx) fail fast and
// are never queued: retrying a rejected file cannot succeed.
import { showToast } from '../components/Toast'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const tok = () => localStorage.getItem('harvest_token') || ''

export type UploadKind = 'avatar' | 'story' | 'post' | 'reel' | 'track' | 'sermon_audio' | 'sermon_video'

export type UploadTask = {
  kind: UploadKind
  file: File | Blob
  filename?: string
  caption?: string
  title?: string
  artist?: string
  speaker?: string
  scripture?: string
  description?: string
  music_track_id?: string
  cover?: File | Blob
  /** Reels only: pre-uploaded poster key (client-picked cover frame). */
  cover_key?: string
}

export type BgUpload = {
  id: string
  label: string
  pct: number // 0..100
  status: 'uploading' | 'waiting'
  attempt: number
  startedAt: number
}

// Completed-upload history entry (kept on-device, shown on the Profile screen).
export type UploadHistoryEntry = {
  id: string
  label: string
  status: 'done' | 'failed'
  at: number
  detail?: string
}

type QueueRecord = {
  id: string
  label: string
  successMsg: string
  task: UploadTask
  attempts: number // completed attempts so far
  nextAttemptAt: number
}

const MAX_ATTEMPTS = 5
const BACKOFF_MS = [15_000, 60_000, 180_000, 600_000]

// Client-side mirror of the server's MAX_BYTES (workers/src/lib/media.js).
// Checking before the background queue starts avoids a member waiting on a
// multi-hour upload that can only fail at presign time.
export const MAX_UPLOAD_MB: Record<string, number> = {
  avatar: 5, post: 10, story: 30, reel: 100, track: 20,
  sermon_audio: 200, sermon_video: 1024,
}
export function uploadTooLarge(kind: string, bytes: number): string | null {
  const maxMb = MAX_UPLOAD_MB[kind]
  if (!maxMb || bytes <= maxMb * 1024 * 1024) return null
  return `This file is ${(bytes / (1024 * 1024)).toFixed(0)} MB — the limit for ${kind.startsWith('sermon') ? 'sermons' : kind === 'reel' ? 'videos' : kind === 'track' ? 'music' : 'this content type'} is ${maxMb} MB.`
}

const states = new Map<string, BgUpload>()
const records = new Map<string, QueueRecord>()
const running = new Set<string>()
const listeners = new Set<() => void>()

// --- upload history (last 20 finished, persisted in IndexedDB) ---
let history: UploadHistoryEntry[] = []
export function getUploadHistory(): UploadHistoryEntry[] { return history }
async function pushHistory(entry: UploadHistoryEntry) {
  history = [entry, ...history].slice(0, 20)
  try { localStorage.setItem('harvest_upload_history', JSON.stringify(history)) } catch {}
  emit()
}
try { history = JSON.parse(localStorage.getItem('harvest_upload_history') || '[]') } catch {}

const emit = () => listeners.forEach(l => l())
export function subscribeUploads(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function getUploads(): BgUpload[] {
  return [...states.values()].sort((a, b) => a.startedAt - b.startedAt)
}

// --- IndexedDB persistence (queued uploads survive app restarts) ----------
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('harvest-uploads', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('queue', { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbPut(rec: QueueRecord) {
  try {
    const db = await idbOpen()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('queue', 'readwrite')
      tx.objectStore('queue').put(rec)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch { /* persistence is best-effort; in-memory retry still works */ }
}
async function idbDelete(id: string) {
  try {
    const db = await idbOpen()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('queue', 'readwrite')
      tx.objectStore('queue').delete(id)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {}
}
async function idbAll(): Promise<QueueRecord[]> {
  try {
    const db = await idbOpen()
    return await new Promise((res, rej) => {
      const tx = db.transaction('queue', 'readonly')
      const rq = tx.objectStore('queue').getAll()
      rq.onsuccess = () => res((rq.result || []) as QueueRecord[])
      rq.onerror = () => rej(rq.error)
    })
  } catch { return [] }
}

// --- transfer helpers -------------------------------------------------------
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

const extOf = (file: File | Blob, filename?: string) =>
  (filename || (file as File).name || '').split('.').pop()?.toLowerCase()
  || file.type.split('/')[1]?.split('+')[0]?.toLowerCase()
  || 'bin'

async function uploadOne(
  file: File | Blob,
  type: UploadKind | 'post',
  filename: string | undefined,
  onPct: (p: number) => void,
  pctFrom: number,
  pctTo: number,
): Promise<string> {
  const presign = await apiJson(`${API}/api/media/presign`, tok(), { type, contentType: file.type || 'application/octet-stream', bytes: file.size, ext: extOf(file, filename) })
  const form = new FormData()
  Object.entries(presign.fields || {}).forEach(([k, v]) => form.append(k, String(v)))
  form.append('file', file)
  const direct = /^https?:\/\//.test(presign.url)
  const up = await xhrSend(direct ? presign.url : `${API}${presign.url}`, 'POST', form, direct ? undefined : { Authorization: `Bearer ${tok()}` }, p => onPct(pctFrom + Math.round(p * (pctTo - pctFrom))))
  if (!up.ok) throw new Error(up.status >= 500 || up.status === 429 ? `server busy (${up.status})` : `upload rejected (${up.status})`)
  return presign.key as string
}

// presign → upload (with progress) → confirm, for any task kind.
export async function performUpload(task: UploadTask, onPct: (p: number) => void) {
  const audioKey = await uploadOne(task.file, task.kind, task.filename, onPct, 0, task.kind === 'track' ? 88 : 95)
  let coverKey: string | undefined
  if (task.kind === 'track' && task.cover) {
    coverKey = await uploadOne(task.cover, 'post', (task.cover as File)?.name, onPct, 88, 95)
  }
  if (task.kind === 'avatar') {
    // Avatars are attached to the profile with a follow-up PATCH /api/me.
    await apiJson(`${API}/api/me`, tok(), { avatar_key: audioKey }, 'PATCH')
  } else {
    await apiJson(`${API}/api/media/confirm`, tok(), {
      key: audioKey,
      type: task.kind,
      caption: task.caption,
      title: task.title,
      artist: task.artist,
      speaker: task.speaker,
      scripture: task.scripture,
      description: task.description || task.caption,
      music_track_id: task.music_track_id,
      // Tracks upload their cover in this lifecycle; reels may already have
      // a pre-uploaded poster key. Prefer the newly uploaded cover when present.
      cover_key: coverKey ?? task.cover_key,
    })
  }
  onPct(100)
  if (task.kind === 'story') window.dispatchEvent(new Event('harvest:approved'))
  if (task.kind === 'track') window.dispatchEvent(new Event('harvest:tracks-updated'))
  if (task.kind === 'sermon_audio' || task.kind === 'sermon_video') window.dispatchEvent(new Event('harvest:sermons-updated'))
  if (task.kind === 'avatar') window.dispatchEvent(new Event('harvest:profile-updated'))
}

function isRetryable(e: any): boolean {
  const msg = String(e?.message || '').toLowerCase()
  if (!msg) return true
  return /network|timeout|timed out|busy|failed to fetch|rate limit|\(5\d\d\)|429/.test(msg)
}

// --- one attempt lifecycle ---------------------------------------------------
async function runAttempt(id: string) {
  const rec = records.get(id)
  if (!rec || running.has(id)) return
  running.add(id)
  states.set(id, { ...(states.get(id)!), status: 'uploading', pct: 0, attempt: rec.attempts + 1 })
  emit()
  try {
    await performUpload(rec.task, pct => {
      const st = states.get(id)
      if (st) { states.set(id, { ...st, pct: Math.min(99, Math.max(0, pct)) }); emit() }
    })
    const st = states.get(id)
    if (st) { states.set(id, { ...st, pct: 100 }); emit() }
    showToast(rec.successMsg, 'success', 3500)
    records.delete(id)
    states.delete(id)
    await idbDelete(id)
    void pushHistory({ id, label: rec.label, status: 'done', at: Date.now() })
    emit()
  } catch (e: any) {
    rec.attempts += 1
    const st = states.get(id)
    if (rec.attempts < MAX_ATTEMPTS && isRetryable(e)) {
      const delay = BACKOFF_MS[Math.min(rec.attempts - 1, BACKOFF_MS.length - 1)]
      rec.nextAttemptAt = Date.now() + delay
      await idbPut(rec)
      if (st) { states.set(id, { ...st, status: 'waiting', pct: 0, attempt: rec.attempts + 1 }); emit() }
      showToast(`${rec.label} interrupted — will retry automatically`, 'warning', 3500)
      setTimeout(() => { void flushQueue() }, delay + 250)
    } else {
      showToast(`${rec.label} failed — ${String(e?.message || 'check your connection')}`, 'error', 5000)
      records.delete(id)
      states.delete(id)
      await idbDelete(id)
      void pushHistory({ id, label: rec.label, status: 'failed', at: Date.now(), detail: String(e?.message || 'check your connection') })
      emit()
    }
  } finally {
    running.delete(id)
  }
}

// Hand a task to the background manager. Resolves when the transfer finishes
// (success or final give-up); failures are surfaced by toast, so callers
// typically attach .catch(() => {}).
export function startBackgroundUpload(opts: { label: string; successMsg: string; task: UploadTask }): Promise<void> {
  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  records.set(id, { id, label: opts.label, successMsg: opts.successMsg, task: opts.task, attempts: 0, nextAttemptAt: 0 })
  states.set(id, { id, label: opts.label, pct: 0, status: 'uploading', attempt: 1, startedAt: Date.now() })
  emit()
  const promise = runAttempt(id)
  promise.catch(() => {})
  return promise
}

// Retry every queued upload whose backoff has elapsed (online only).
export async function flushQueue() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const now = Date.now()
  for (const rec of [...records.values()]) {
    if (running.has(rec.id)) continue
    const st = states.get(rec.id)
    if (st?.status !== 'waiting') continue
    if (rec.nextAttemptAt > now) continue
    void runAttempt(rec.id)
  }
}

// Restore queued uploads from a previous session (IndexedDB).
void (async () => {
  const saved = await idbAll()
  for (const rec of saved) {
    if (!rec?.task?.file || records.has(rec.id)) continue
    records.set(rec.id, rec)
    states.set(rec.id, { id: rec.id, label: rec.label, pct: 0, status: 'waiting', attempt: rec.attempts + 1, startedAt: rec.nextAttemptAt || Date.now() })
  }
  if (saved.length) {
    emit()
    showToast(`${saved.length} upload${saved.length > 1 ? 's' : ''} resumed from last time`, 'info', 3000)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) setTimeout(() => { void flushQueue() }, 4000)
  }
})()

export function clearUploadHistory() {
  history = []
  try { localStorage.removeItem('harvest_upload_history') } catch {}
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushQueue() })
  setInterval(() => { void flushQueue() }, 30_000)
}
