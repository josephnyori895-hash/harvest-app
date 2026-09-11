// Harvest Family API client.
// Feature-flagged so the existing demo/localStorage experience can coexist with
// the backend migration. New features should use this module instead of calling fetch directly.

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const USE_API = import.meta.env.VITE_USE_API === 'true'

export const isApiEnabled = () => USE_API && Boolean(BASE)

export class ApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function authHeader() {
  const token = localStorage.getItem('harvest_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  Object.entries(authHeader()).forEach(([key, value]) => headers.set(key, value))

  const response = await fetch(`${BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error?: unknown }).error || 'Request failed')
      : `Request failed with status ${response.status}`
    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export type AuthSession = {
  token: string
  role: 'member' | 'leader' | 'pastor' | 'admin' | 'guest'
  username: string
}

export async function login(username: string, pin: string) {
  return request<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: username.trim(), pin: pin.trim() }),
  })
}

export async function presign(params: { type: 'post'|'story'|'reel'|'track', contentType: string, bytes: number, ext?: string }) {
  return request<{ url: string, fields: Record<string, string>, key: string, expiresAt: string }>('/api/media/presign', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function uploadToMinio(url: string, fields: Record<string, string>, file: File) {
  const fd = new FormData()
  Object.entries(fields).forEach(([key, value]) => fd.append(key, value))
  fd.append('file', file)
  const response = await fetch(url, { method: 'POST', body: fd })
  if (!response.ok) throw new ApiError(`MinIO upload failed (${response.status})`, response.status)
}

export async function confirmMedia(body: { key: string, type: string, caption?: string, title?: string, artist?: string }) {
  return request('/api/media/confirm', { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchFeed(offset = 0, limit = 20) {
  return request<{ posts: any[], stories: any[], nextOffset: number, hasMore: boolean }>(`/api/feed?offset=${offset}&limit=${limit}`)
}

export async function getHealth() {
  return request<{ ok: boolean }>('/health')
}

export function clearSession() {
  localStorage.removeItem('harvest_token')
  localStorage.removeItem('harvest_role')
  localStorage.removeItem('harvest_pin')
}
