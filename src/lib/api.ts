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

async function apiJson(path: string, init: RequestInit = {}) {
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
        if (body) message = body
      } catch { /* keep status message */ }
      throw new Error(message)
    }
    return r.json()
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Request timed out. Please try again.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function presign(params: { type: 'post'|'story'|'reel'|'track', contentType: string, bytes: number, ext?: string }) {
  return apiJson('/api/media/presign', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params) }) as Promise<{url:string,fields:Record<string,string>,key:string,expiresAt:string}>
}

export async function uploadToMinio(url:string, fields:Record<string,string>, file:File) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k,v]) => fd.append(k, v))
  fd.append('file', file)
  // Presigned targets are absolute (R2); the proxy fallback returns an API-relative path.
  // The proxy route requires the bearer token; direct R2 posts must stay header-free.
  const absolute = /^https?:\/\//.test(url)
  const target = absolute ? url : `${BASE}${url}`
  const r = await fetch(target, {
    method: 'POST',
    body: fd,
    headers: absolute ? undefined : { ...authHeader() },
  })
  if (!r.ok) throw new Error(`Media upload failed (${r.status})`)
}

export async function confirmMedia(body: {key:string,type:string,caption?:string,title?:string,artist?:string}) {
  return apiJson('/api/media/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
}

export async function fetchFeed(offset=0, limit=20) {
  return apiJson(`/api/feed?offset=${offset}&limit=${limit}`) as Promise<{posts:any[],stories:any[],nextOffset:number,hasMore:boolean}>
}

export async function startGiving(params: {amount:number,phone:string,purpose:string}) {
  return apiJson('/api/giving/mpesa/stkpush', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params) }) as Promise<{transactionId:string,checkoutRequestId:string,message:string}>
}

export async function fetchMusic() {
  return apiJson('/api/music') as Promise<{ tracks: any[] }>
}

export async function fetchReels(offset = 0, limit = 20) {
  return apiJson(`/api/reels?offset=${offset}&limit=${limit}`) as Promise<{ reels: any[], nextOffset: number }>
}

export async function fetchMyGiving() {
  return apiJson('/api/giving/mine') as Promise<any[]>
}

export async function fetchGivingAdmin() {
  return apiJson('/api/giving/admin') as Promise<{transactions:any[],totals:{completed_kes:string,pending_count:number}}>
}

export async function fetchMe() {
  return apiJson('/api/me') as Promise<{ user: any; role?: string }>
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
