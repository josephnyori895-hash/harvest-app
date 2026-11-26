// src/lib/api.ts — Harvest Family API client
// In production the API is same-origin so the Netlify /api rewrite is used.
// A custom VITE_API_URL is still supported for local development or a separate API.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const USE_API = import.meta.env.PROD
  ? import.meta.env.VITE_USE_API !== 'false'
  : import.meta.env.VITE_USE_API === 'true'

export const useApi = () => USE_API

function authHeader() {
  const t = localStorage.getItem('harvest_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// A transient failure is one worth a second attempt: the network was missing,
// the request timed out, or the server answered 5xx / rate-limited. A 4xx is a
// decision (bad input, no permission) and retrying it can never succeed.
type TransientError = Error & { retryable?: boolean }
const transient = (message: string): TransientError => {
  const e: TransientError = new Error(message)
  e.retryable = true
  return e
}

async function apiOnce(path: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      signal: init.signal || controller.signal,
      headers: { ...authHeader(), ...(init.headers || {}) },
    })
    if (!r.ok) {
      let message = `API request failed (${r.status})`
      try {
        const body = await r.text()
        if (body) {
          // A JSON error body is a message for a person, not a payload to show.
          // Throwing the raw text put `{"error":"…"}` in the toast.
          try {
            const parsed = JSON.parse(body)
            if (typeof parsed?.error === 'string' && parsed.error) message = parsed.error
            else if (typeof parsed?.message === 'string' && parsed.message) message = parsed.message
          } catch {
            // An HTML error page is not a sentence: keep the status message
            // rather than showing markup or a truncated stack.
            message = body.length > 200 ? `API request failed (${r.status})` : body
          }
        }
      } catch { /* keep status message */ }
      const e: TransientError = new Error(message)
      e.retryable = r.status >= 500 || r.status === 429
      throw e
    }
    return r.json()
  } catch (error: any) {
    if (error?.name === 'AbortError') throw transient('Request timed out. Please try again.')
    // fetch() rejects with a TypeError for a dropped connection or DNS failure.
    // Saying "Failed to fetch" to a member is not a sentence; name the cause.
    if (error instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw transient('You appear to be offline — check your connection and try again.')
    }
    if (error instanceof TypeError) throw transient('Could not reach the church server — check your connection and try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function apiJson(path: string, init: RequestInit = {}, opts: { retries?: number } = {}) {
  const attempts = Math.max(1, (opts.retries ?? 0) + 1)
  let lastError: any
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await apiOnce(path, init)
    } catch (e: any) {
      lastError = e
      if (attempt === attempts - 1 || !e?.retryable) throw e
      // One short backoff: a tunnel or a dropped Wi-Fi packet is usually gone
      // by the second try, and a member should not have to tap Retry for it.
      await new Promise(resolve => window.setTimeout(resolve, 600))
    }
  }
  throw lastError
}

/** Idempotent GET with one automatic retry on a transient failure. Every
 *  read path should use this: a single lost packet must not turn a feed, a
 *  profile or a directory into an error screen. */
export async function apiGet<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  return apiJson(path, { ...init, method: 'GET' }, { retries: 1 }) as Promise<T>
}

export async function presign(params: { type: 'post'|'story'|'reel'|'track'|'avatar', contentType: string, bytes: number, ext?: string }) {
  return apiJson('/api/media/presign', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params) }) as Promise<{url:string,fields:Record<string,string>,key:string,expiresAt:string,method?:'PUT'|'POST'}>
}

async function uploadOnce(target: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  // Photos and posters are small; a full minute without a response means the
  // socket is dead, and waiting longer just freezes "Uploading…".
  const timer = window.setTimeout(() => controller.abort(), 60_000)
  try {
    return await fetch(target, { ...init, signal: controller.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw transient('Upload timed out — check your connection and try again.')
    if (e instanceof TypeError) throw transient('Could not reach media storage — check your connection and try again.')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

export async function uploadToMinio(url:string, fields:Record<string,string>, file:File) {
  const absolute = /^https?:\/\//.test(url)
  const target = absolute ? url : `${BASE}${url}`
  let init: RequestInit
  if (absolute) {
    // Direct R2 uploads use a presigned PUT. Every signed header must be sent
    // exactly as returned by the API; do not attach the Harvest bearer token.
    init = { method: 'PUT', body: file, headers: { ...fields } }
  } else {
    // Proxy fallback is authenticated and uses multipart/form-data.
    const fd = new FormData()
    Object.entries(fields).forEach(([k,v]) => fd.append(k, v))
    fd.append('file', file)
    init = { method: 'POST', body: fd, headers: { ...authHeader() } }
  }
  let lastError: any
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await uploadOnce(target, init)
      if (!r.ok) {
        // The server names the refusal. A generic status hides the one thing
        // the member can act on (format, size, permission).
        let reason = ''
        try {
          const text = await r.text()
          try {
            const parsed = JSON.parse(text)
            reason = parsed?.error || parsed?.message || ''
          } catch { reason = text.length <= 200 ? text : '' }
        } catch { /* keep status message */ }
        const e: TransientError = new Error(reason || `Media upload failed (${r.status})`)
        // 403 is usually an expired presigned URL: re-sending the same URL can
        // never succeed, so only transient statuses get the second attempt.
        e.retryable = r.status >= 500 || r.status === 429
        throw e
      }
      return
    } catch (e: any) {
      lastError = e
      if (attempt === 0 && e?.retryable) {
        await new Promise(resolve => window.setTimeout(resolve, 600))
        continue
      }
      throw e
    }
  }
  throw lastError
}

// `cursor` freezes the feed window at the first page's instant, so posts
// published while the member scrolls cannot shift offsets and duplicate or skip
// items. The server echoes the frozen timestamp on every page.
export async function fetchFeed(offset=0, limit=20, cursor?: string) {
  const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
  return apiGet<{posts:any[],stories:any[],nextOffset:number,hasMore:boolean,cursor?:string}>(`/api/feed?offset=${offset}&limit=${limit}${q}`)
}

export async function startGiving(params: {amount:number,phone:string,purpose:string,purpose_id?:string,project_id?:string}) {
  return apiJson('/api/giving/mpesa/stkpush', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params) }) as Promise<{transactionId:string,checkoutRequestId:string,message:string}>
}

export async function fetchProjects() {
  return apiGet<{ projects: any[] }>('/api/projects')
}

export async function participateInProject(projectId:string, commitment_kes:number, reminder_enabled=true) {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/participate`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ commitment_kes, reminder_enabled }) }) as Promise<{ project:any }>
}

export async function createGivingProject(body:any) {
  return apiJson('/api/projects/admin', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) as Promise<{ project:any }>
}

export async function updateGivingProject(projectId:string, body:any) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) as Promise<{ project:any }>
}

export async function deleteGivingProject(projectId:string) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}`, { method:'DELETE' }) as Promise<{ deleted:boolean; id:string }>
}

export type ProjectTake = { kind:'group'|'department'|'community'; name?: string; take_id?: string; note?: string }

/** Pledge/help under a collective take (group, department or community). */
export async function participateByTake(projectId:string, take:ProjectTake, commitment_kes:number) {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/participate`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ take, commitment_kes }),
  }) as Promise<{ project:any; take:any; helper:{ take_id:string; commitment_kes:number } }>
}

export async function fetchGroupDirectory() {
  return apiGet<{ communities: Record<string, number>; groups: any[] }>('/api/groups')
}

export async function fetchDepartmentDirectory() {
  return apiGet<{ departments: any[] }>('/api/departments')
}

// ── Admin override power (requireAdmin server-side; audit-logged) ──
export async function overrideGivingPledge(projectId:string, username:string, commitment_kes:number) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}/participants/${encodeURIComponent(username)}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ commitment_kes }),
  }) as Promise<{ updated:boolean; individual:boolean; helper:boolean }>
}

export async function removeGivenParticipant(projectId:string, username:string) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}/participants/${encodeURIComponent(username)}`, { method:'DELETE' }) as Promise<{ removed:boolean }>
}

export async function renameGivingTake(projectId:string, takeId:string, body:{ name?: string; taken_by_username?: string }) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}/takes/${encodeURIComponent(takeId)}`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  }) as Promise<{ updated:boolean }>
}

export async function removeFromTake(projectId:string, takeId:string) {
  return apiJson(`/api/projects/admin/${encodeURIComponent(projectId)}/takes/${encodeURIComponent(takeId)}`, { method:'DELETE' }) as Promise<{ removed:boolean }>
}

export async function fetchMusic() {
  return apiGet<{ tracks: any[] }>('/api/music')
}

export async function fetchReels(offset = 0, limit = 20) {
  return apiGet<{ reels: any[], nextOffset: number, hasMore?: boolean }>(`/api/reels?offset=${offset}&limit=${limit}`)
}

export async function fetchMyGiving() {
  return apiGet<any[]>('/api/giving/mine')
}

export type GivingFilters = { status?: string; from?: string; to?: string; q?: string; limit?: number; offset?: number }
function givingQuery(filters?: GivingFilters) {
  if (!filters) return ''
  const q = new URLSearchParams()
  for (const key of ['status', 'from', 'to', 'q'] as const) if (filters[key]) q.set(key, String(filters[key]))
  if (filters.limit) q.set('limit', String(filters.limit))
  if (filters.offset) q.set('offset', String(filters.offset))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function fetchGivingAdmin(filters?: GivingFilters) {
  return apiGet<{transactions:any[],totals:{completed_kes:string,pending_kes:number,pending_count:number},total?:number,limit?:number,offset?:number}>(`/api/giving/admin${givingQuery(filters)}`)
}

// Manual giving: the treasurer records a gift that arrived at the Paybill, Till,
// bank or in cash, and can correct a typo later. The server keeps the original
// row and the correction reason in giving_transaction_audit.
export async function recordManualGiving(body: {
  amount_kes: number; purpose: string; method: string; phone?: string; receipt_number?: string
  project_id?: string | null; note?: string; member_username?: string; received_at?: string
}) {
  return apiJson('/api/giving/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as Promise<{ transaction: any }>
}

export async function correctGivingTransaction(id: string, body: {
  reason: string; amount_kes?: number; purpose?: string; status?: string
  receipt_number?: string | null; phone?: string; project_id?: string | null
}) {
  return apiJson(`/api/giving/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as Promise<{ transaction: any }>
}

export async function fetchGivingAudit(id: string) {
  return apiGet<{ audit: any[] }>(`/api/giving/transactions/${encodeURIComponent(id)}/audit`)
}

// CSV goes through fetch so the bearer token is sent (a plain <a href> cannot
// authenticate); the blob is then handed to the browser as a download.
export async function downloadGivingCsv(filters?: GivingFilters) {
  const token = localStorage.getItem('harvest_token')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30_000)
  let res: Response
  try {
    res = await fetch(`${BASE}/api/giving/admin/export.csv${givingQuery(filters)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError' ? 'Export timed out — try again' : 'Could not reach the server — try again')
  } finally { window.clearTimeout(timer) }
  if (!res.ok) throw new Error(res.status === 403 ? 'Only an administrator can export the ledger' : 'Could not export the ledger — try again')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `harvest-giving-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function fetchMe() {
  return apiGet<{ user: any; role?: string }>('/api/me')
}

export async function updateProfile(body: {
  name?: string
  phone?: string
  location?: string
  faith?: string
  constituency?: string
  group_name?: string
  avatar_key?: string | null
}) {
  return apiJson('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as Promise<{ user: any }>
}
