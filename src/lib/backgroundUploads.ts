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
  /** Stable per-logical-upload key — retries of the same upload reuse it. */
  idempotency_key?: string
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
  /** Photo stories: per-author duration in seconds (viewer auto-advance). */
  duration_secs?: number
}

export type BgUpload = {
  id: string
  label: string
  pct: number // 0..100
  status: 'uploading' | 'waiting' | 'failed'
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
  /** Account the upload was started under — queue never crosses accounts. */
  owner: string
}

const MAX_ATTEMPTS = 5
const BACKOFF_MS = [15_000, 60_000, 180_000, 600_000]

// Per-task completion signal. startBackgroundUpload's promise must stay
// pending while a task is retrying (status 'waiting') and settle only at a
// terminal state: resolve on confirmed success, reject on final failure.
type DeferredHandle = { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void }
const deferreds = new Map<string, DeferredHandle>()
const getDeferred = (id: string): DeferredHandle => {
  const h = deferreds.get(id)
  if (h) return h
  // Wire the promise after construction: assignments to `handle` inside the
  // executor would hit the temporal dead zone while the const is still
  // initializing ("Cannot access 'handle' before initialization").
  const handle: DeferredHandle = { promise: Promise.resolve(), resolve: () => {}, reject: () => {} }
  handle.promise = new Promise<void>((resolve, reject) => { handle.resolve = resolve; handle.reject = reject })
  deferreds.set(id, handle)
  return handle
}

// Client-side mirror of the server's MAX_BYTES (workers/src/lib/media.js).
// Checking before the background queue starts avoids a member waiting on a
// multi-hour upload that can only fail at presign time.
export const MAX_UPLOAD_MB: Record<string, number> = {
  avatar: 5, post: 10, story: 30, reel: 100, track: 50,
  sermon_audio: 2048, sermon_video: 5120,
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

export function retryUpload(id: string) {
  const rec = records.get(id)
  const st = states.get(id)
  if (!rec || !st || running.has(id)) return false
  rec.attempts = 0
  rec.nextAttemptAt = 0
  states.set(id, { ...st, status: 'uploading', pct: 0, attempt: 1, startedAt: Date.now() })
  emit()
  void runAttempt(id)
  return true
}

export async function dismissUpload(id: string) {
  records.delete(id)
  states.delete(id)
  await idbDelete(id)
  emit()
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
// The response body is kept on failure: the server explains exactly why it
// refused (wrong container, over the size cap, no sermon permission, rate
// limit) and throwing that away left members staring at "upload rejected
// (400)" with nothing to act on.
export function xhrSend(url: string, method: string, body: FormData | Blob | null, headers: Record<string, string> | undefined, onPct: (pct: number) => void): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    if (headers) Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: xhr.responseText || '' })
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

// Some Android WebViews report an empty (or generic octet-stream) type for
// mp3/m4a picks. Derive the mime from the extension so presign validates and
// the direct PUT carries exactly the content type the signature was made for.
const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', '3gp': 'video/3gpp', '3gpp': 'video/3gpp', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
}

type PresignResponse = { url: string; fields?: Record<string, string>; key: string; method?: string }

// ── Chunked uploads (resumable) ──────────────────────────────────
// A single long PUT is what fails on a phone: switching from Wi-Fi to data or
// the screen sleeping kills the socket mid-transfer and the browser reports an
// opaque "network error" with no status. Photos and short clips finish before
// that can happen; sermons and songs do not. Uploading in 8 MiB parts keeps a
// failure seconds wide, and the parts already stored are remembered so a retry
// resumes instead of re-sending from zero.
const CHUNK_THRESHOLD = 8 * 1024 * 1024
const PART_SIZE = 8 * 1024 * 1024
// Same-origin proxy runs inside a Worker and buffers the whole body — keep the
// fallback within a safe slice of the 128 MB Worker memory ceiling.
const PROXY_SAFE_MAX_BYTES = 96 * 1024 * 1024

type ChunkState = { uploadId: string; key: string; token: string; partSize: number; size: number; done: Record<string, string> }

const chunkStoreKey = (id: string) => `harvest:chunk:${id}`
function loadChunkState(id: string): ChunkState | null {
  try { const raw = localStorage.getItem(chunkStoreKey(id)); return raw ? JSON.parse(raw) as ChunkState : null } catch { return null }
}
function saveChunkState(id: string, st: ChunkState) {
  try { localStorage.setItem(chunkStoreKey(id), JSON.stringify(st)) } catch { /* resume is best-effort */ }
}
function clearChunkState(id: string) {
  try { localStorage.removeItem(chunkStoreKey(id)) } catch {}
}

// Worker refusals are JSON and carry the real reason; R2's own errors are XML.
function uploadError(up: { status: number; body: string }): Error {
  let reason = ''
  try {
    const parsed = JSON.parse(up.body || '{}')
    if (parsed && typeof parsed.error === 'string') reason = parsed.error
  } catch { /* XML error body, not a server explanation */ }
  if (reason) return new Error(reason)
  if (up.status === 403) return new Error('storage link expired — retrying')
  return new Error(up.status >= 500 || up.status === 429 ? `server busy (${up.status})` : `upload rejected (${up.status})`)
}

async function uploadChunked(
  file: File | Blob,
  type: UploadKind | 'post',
  filename: string | undefined,
  declaredType: string,
  idempotencyKey: string,
  onPct: (p: number) => void,
): Promise<string> {
  const fail = (n: number, e: any) => (e instanceof Error && e.message ? e : new Error(`chunk ${n} failed`))
  let st = loadChunkState(idempotencyKey)
  if (st && st.size !== file.size) st = null
  if (!st) {
    const started = await apiJson(`${API}/api/media/multipart`, tok(), {
      type, contentType: declaredType, bytes: file.size, ext: extOf(file, filename), idempotencyKey,
    }) as { uploadId: string; key: string; token: string; partSize?: number }
    st = {
      uploadId: String(started.uploadId), key: String(started.key), token: String(started.token),
      partSize: Number(started.partSize) || PART_SIZE, size: file.size, done: {},
    }
    saveChunkState(idempotencyKey, st)
  } else {
    // Ask the server which parts already landed: that is what turns a retry
    // after a drop into a resume rather than a restart.
    try {
      const known = await apiJson(`${API}/api/media/multipart/status`, tok(), {
        uploadId: st.uploadId, key: st.key, token: st.token,
      }) as { parts?: { partNumber: number; etag: string }[] }
      st.done = {}
      for (const p of Array.isArray(known?.parts) ? known.parts : []) st.done[String(p.partNumber)] = String(p.etag)
      saveChunkState(idempotencyKey, st)
    } catch {
      // Session expired on the storage side — start a fresh one.
      clearChunkState(idempotencyKey)
      const started = await apiJson(`${API}/api/media/multipart`, tok(), {
        type, contentType: declaredType, bytes: file.size, ext: extOf(file, filename), idempotencyKey,
      }) as { uploadId: string; key: string; token: string; partSize?: number }
      st = {
        uploadId: String(started.uploadId), key: String(started.key), token: String(started.token),
        partSize: Number(started.partSize) || PART_SIZE, size: file.size, done: {},
      }
      saveChunkState(idempotencyKey, st)
    }
  }
  const state: ChunkState = st
  const partSize = state.partSize || PART_SIZE
  const totalParts = Math.max(1, Math.ceil(file.size / partSize))
  for (let n = 1; n <= totalParts; n++) {
    if (state.done[String(n)]) { onPct(Math.round((n / totalParts) * 100)); continue }
    const from = (n - 1) * partSize
    const chunk = file.slice(from, Math.min(file.size, from + partSize))
    let stored = false
    let lastError: any = null
    for (let attempt = 1; attempt <= 3 && !stored; attempt++) {
      try {
        const form = new FormData()
        form.append('key', state.key)
        form.append('uploadId', state.uploadId)
        form.append('token', state.token)
        form.append('partNumber', String(n))
        form.append('part', chunk, `part-${n}`)
        const up = await xhrSend(
          `${API}/api/media/multipart/part`, 'POST', form,
          { Authorization: `Bearer ${tok()}` },
          p => onPct(Math.round(((n - 1 + p / 100) / totalParts) * 100)),
        )
        if (!up.ok) throw uploadError(up)
        const data = JSON.parse(up.body || '{}')
        state.done[String(n)] = String(data.etag || '')
        saveChunkState(idempotencyKey, state)
        stored = true
      } catch (e: any) {
        lastError = e
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt))
      }
    }
    if (!stored) throw fail(n, lastError)
  }
  await apiJson(`${API}/api/media/multipart/complete`, tok(), {
    uploadId: state.uploadId,
    key: state.key,
    token: state.token,
    parts: Object.entries(state.done).map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag })),
  })
  clearChunkState(idempotencyKey)
  onPct(100)
  return state.key
}

async function uploadOne(
  file: File | Blob,
  type: UploadKind | 'post',
  filename: string | undefined,
  onPct: (p: number) => void,
  pctFrom: number,
  pctTo: number,
  idempotencyKey: string,
): Promise<string> {
  const declaredType = file.type && file.type !== 'application/octet-stream'
    ? file.type
    : (MIME_BY_EXT[extOf(file, filename)] || 'application/octet-stream')
  const span = (p: number) => onPct(pctFrom + Math.round(p * (pctTo - pctFrom)))
  if (file.size > CHUNK_THRESHOLD) {
    try {
      return await uploadChunked(file, type, filename, declaredType, idempotencyKey, span)
    } catch (e: any) {
      // The chunked door needs R2 S3 credentials on the server (its multipart
      // session is a SigV4 call); the presign path does not — it degrades to the
      // same-origin proxy. If the server has no credentials yet and the proxy
      // can still carry the file, fall through and finish there instead of
      // refusing an upload the storage would accept.
      const msg = String(e?.message || '')
      if (!/credentials are not configured/i.test(msg) || file.size > PROXY_SAFE_MAX_BYTES) throw e
    }
  }
  const presign = await apiJson(`${API}/api/media/presign`, tok(), { type, contentType: declaredType, bytes: file.size, ext: extOf(file, filename), idempotencyKey }) as PresignResponse
  const direct = /^https?:\/\//.test(String(presign.url || ''))
  let up: { ok: boolean; status: number; body: string }
  if (direct) {
    const headers = Object.fromEntries(Object.entries(presign.fields || {}).map(([k, v]) => [k, String(v)]))
    try {
      up = await xhrSend(String(presign.url), 'PUT', file, headers, span)
    } catch {
      // This device cannot reach R2 at all — a blocked host or a failed bucket
      // CORS preflight. The Worker can, and it sits on a host the app already
      // talks to, so finish through the same-origin proxy instead of failing.
      const form = new FormData()
      form.append('key', String(presign.key))
      form.append('contentType', declaredType)
      form.append('file', file, filename || (file as File).name || 'upload')
      up = await xhrSend(`${API}/api/media/upload`, 'POST', form, { Authorization: `Bearer ${tok()}` }, span)
    }
  } else {
    const form = new FormData()
    Object.entries(presign.fields || {}).forEach(([k, v]) => form.append(k, String(v)))
    form.append('file', file)
    up = await xhrSend(`${API}${presign.url}`, String(presign.method || 'POST').toUpperCase(), form, { Authorization: `Bearer ${tok()}` }, span)
  }
  if (!up.ok) throw uploadError(up)
  return String(presign.key)
}

/** Cover art is a thumbnail, not a full-resolution photo. Downscale before the
 *  upload so `cover_thumb_key` really holds a small image: lists fill fast and
 *  the worship screen never ships a 4 MB camera shot for a 56px tile. Falls
 *  back to the original whenever the device cannot decode images. */
async function coverThumbnail(file: File | Blob, max = 720, quality = 0.85): Promise<File | Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file
  if (file.type && !file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (!blob) return file
    return new File([blob], 'cover.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

// presign → upload (with progress) → confirm, for any task kind.
export async function performUpload(task: UploadTask, onPct: (p: number) => void) {
  const idempotencyKey = task.idempotency_key || newUploadId()
  const audioKey = await uploadOne(task.file, task.kind, task.filename, onPct, 0, task.kind === 'track' ? 88 : 95, idempotencyKey)
  let coverKey: string | undefined
  if (task.kind === 'track' && task.cover) {
    const cover = await coverThumbnail(task.cover)
    coverKey = await uploadOne(cover, 'post', 'cover.jpg', onPct, 88, 95, idempotencyKey)
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
      duration_secs: task.duration_secs,
    })
  }
  onPct(100)
  // Completion events: every upload kind that lands in a browsable list must
  // notify the screen showing that list. Post/reel feed — Home + Reels; story —
  // Home (harvest:approved); track — Music; sermon — Sermons; avatar — profile.
  if (task.kind === 'story') window.dispatchEvent(new Event('harvest:approved'))
  if (task.kind === 'post' || task.kind === 'reel') window.dispatchEvent(new Event('harvest:feed-updated'))
  if (task.kind === 'track') window.dispatchEvent(new Event('harvest:tracks-updated'))
  if (task.kind === 'sermon_audio' || task.kind === 'sermon_video') window.dispatchEvent(new Event('harvest:sermons-updated'))
  if (task.kind === 'avatar') window.dispatchEvent(new Event('harvest:profile-updated'))
}

function isRetryable(e: any): boolean {
  const msg = String(e?.message || '').toLowerCase()
  if (!msg) return true
  return /network|timeout|timed out|busy|failed to fetch|rate limit|expired|chunk|rejected by storage|\(5\d\d\)|429/.test(msg)
}

// --- one attempt lifecycle ---------------------------------------------------
async function runAttempt(id: string) {
  const rec = records.get(id)
  if (!rec || running.has(id)) return
  if (rec.owner !== undefined && rec.owner !== currentOwner()) {
    // Account changed since this upload was queued — never send another
    // member's media under this account. Purge silently.
    records.delete(id)
    states.delete(id)
    await idbDelete(id)
    emit()
    return
  }
  running.add(id)
  const deferred = getDeferred(id)
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
    deferred.resolve()
    deferreds.delete(id)
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
      const detail = String(e?.message || 'check your connection')
      rec.nextAttemptAt = 0
      await idbPut(rec)
      if (st) { states.set(id, { ...st, status: 'failed', pct: 0, attempt: rec.attempts }); emit() }
      void pushHistory({ id, label: rec.label, status: 'failed', at: Date.now(), detail })
      showToast(`${rec.label} failed — tap Retry to try again`, 'error', 5000)
      deferred.reject(new Error(detail))
      deferreds.delete(id)
      emit()
    }
  } finally {
    running.delete(id)
  }
}

// Hand a task to the background manager. Resolves when the transfer finishes
// (success or final give-up); failures are surfaced by toast, so callers
// typically attach .catch(() => {}).
const currentOwner = () => localStorage.getItem('harvest_username') || ''

// Hermes (React Native WebView) runtimes have shipped without crypto.randomUUID
// in places — fall back to a random UUID-shaped string rather than dying silently
// inside the upload hand-off.
const newUploadId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `up_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`)

export function startBackgroundUpload(opts: { label: string; successMsg: string; task: UploadTask }): Promise<void> {
  const task: UploadTask = { ...opts.task, idempotency_key: opts.task.idempotency_key || newUploadId() }
  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  records.set(id, { id, label: opts.label, successMsg: opts.successMsg, task, attempts: 0, nextAttemptAt: 0, owner: currentOwner() })
  states.set(id, { id, label: opts.label, pct: 0, status: 'uploading', attempt: 1, startedAt: Date.now() })
  emit()
  const promise = getDeferred(id).promise
  void runAttempt(id).catch(() => {})
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
  let old = 0
  for (const rec of saved) {
    if (!rec?.task?.file || records.has(rec.id)) continue
    if (rec.owner !== undefined && rec.owner !== currentOwner()) { void idbDelete(rec.id); old++; continue }
    records.set(rec.id, rec)
    states.set(rec.id, { id: rec.id, label: rec.label, pct: 0, status: rec.nextAttemptAt ? 'waiting' : 'failed', attempt: rec.attempts || 1, startedAt: rec.nextAttemptAt || Date.now() })
  }
  const resumed = Object.keys(records).length
  if (resumed) {
    emit()
    showToast(`${resumed} upload${resumed > 1 ? 's' : ''} resumed from last time`, 'info', 3000)
  }
  void old // foreign-owner records purged silently
  if (saved.length && typeof navigator !== 'undefined' && navigator.onLine !== false) setTimeout(() => { void flushQueue() }, 4000)
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
