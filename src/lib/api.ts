// src/lib/api.ts — Harvest Family API client (VPS MinIO presigned flow)
// Feature-flagged: VITE_USE_API=true switches PostCreate/Home/Reels from localStorage to real API.
// Falls back to localStorage when offline or flag off (keeps shallow 238 working).

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const USE_API = import.meta.env.VITE_USE_API === 'true'

export const useApi = () => USE_API

function authHeader() {
  const t = localStorage.getItem('harvest_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export async function presign(params: { type: 'post'|'story'|'reel'|'track', contentType: string, bytes: number, ext?: string }) {
  const r = await fetch(`${BASE}/api/media/presign`, {
    method: 'POST', headers: { 'Content-Type':'application/json', ...authHeader() },
    body: JSON.stringify(params)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json() as Promise<{ url:string, fields:Record<string,string>, key:string, expiresAt:string }>
}

export async function uploadToMinio(url:string, fields:Record<string,string>, file:File) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k,v])=> fd.append(k, v))
  fd.append('file', file) // MinIO expects 'file' last
  // Note: Content-Type must match presigned contentType; FormData sets it.
  const r = await fetch(url, { method:'POST', body: fd })
  if (!r.ok) throw new Error(`MinIO upload failed ${r.status} ${await r.text()}`)
}

export async function confirmMedia(body: { key:string, type:string, caption?:string, title?:string, artist?:string }) {
  const r = await fetch(`${BASE}/api/media/confirm`, {
    method:'POST', headers:{'Content-Type':'application/json',...authHeader()}, body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchFeed(offset=0, limit=20) {
  const r = await fetch(`${BASE}/api/feed?offset=${offset}&limit=${limit}`, { headers: authHeader() })
  if (!r.ok) throw new Error(await r.text())
  return r.json() as Promise<{ posts:any[], stories:any[], nextOffset:number, hasMore:boolean }>
}

// Example: PostCreate.tsx:12 migration
// Before: const img = `https://picsum.photos/400/400?random=${Date.now()%100}` // line 13-14
// After (when USE_API):
//   const file = input.files[0]
//   const {url, fields, key} = await presign({type, contentType: file.type, bytes: file.size, ext: file.name.split('.').pop()})
//   await uploadToMinio(url, fields, file)
//   await confirmMedia({key, type, caption})
// Home.tsx:34: replace approvedPosts localStorage with fetchFeed(); stories top 51 from feed.stories
