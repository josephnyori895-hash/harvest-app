// src/lib/api.ts — Harvest Family API client
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const USE_API = import.meta.env.VITE_USE_API === 'true'

export const useApi = () => USE_API

function authHeader() {
  const t = localStorage.getItem('harvest_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function apiJson(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...authHeader(), ...(init.headers || {}) } })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function presign(params: { type: 'post'|'story'|'reel'|'track', contentType: string, bytes: number, ext?: string }) {
  return apiJson('/api/media/presign', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params) }) as Promise<{url:string,fields:Record<string,string>,key:string,expiresAt:string}>
}

export async function uploadToMinio(url:string, fields:Record<string,string>, file:File) {
  const fd = new FormData()
  Object.entries(fields).forEach(([k,v]) => fd.append(k, v))
  fd.append('file', file)
  const r = await fetch(url, { method:'POST', body:fd })
  if (!r.ok) throw new Error(`MinIO upload failed ${r.status} ${await r.text()}`)
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

export async function fetchMyGiving() {
  return apiJson('/api/giving/mine') as Promise<any[]>
}

export async function fetchGivingAdmin() {
  return apiJson('/api/giving/admin') as Promise<{transactions:any[],totals:{completed_kes:string,pending_count:number}}>
}
