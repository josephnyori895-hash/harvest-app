// src/lib/realtime.ts — socket.io client (VPS-only, no Ably/Pusher)
// Channels: chat:a:b, group:youth_group, events sent→delivered→seen, typing 3s, presence
import { io, Socket } from 'socket.io-client'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

let sock: Socket | null = null
type Handler = (...args: any[]) => void
const listeners: Record<string, Set<Handler>> = {}

export function getSocket(): Socket | null { return sock }

export function connectSocket(token?: string): Socket {
  if (sock?.connected) return sock
  const t = token || localStorage.getItem('harvest_token') || ''
  if (sock) { sock.disconnect(); sock = null }
  sock = io(BASE, {
    auth: { token: t },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  })
  // re-attach cached listeners
  for (const [ev, set] of Object.entries(listeners)) for (const h of set) sock.on(ev, h)
  sock.on('connect', () => console.log('[realtime] connected', sock?.id))
  sock.on('disconnect', (r) => console.log('[realtime] disconnect', r))
  sock.on('connect_error', (e) => console.warn('[realtime] connect_error', e.message))
  return sock
}

export function disconnectSocket() { sock?.disconnect(); sock = null }

export function onSocket(event: string, handler: Handler) {
  if (!listeners[event]) listeners[event] = new Set()
  listeners[event].add(handler)
  sock?.on(event, handler)
  return () => { listeners[event]?.delete(handler); sock?.off(event, handler) }
}

export function emitSocket(event: string, data: any, ack?: (res: any) => void) {
  if (!sock?.connected) return ack?.({ error: 'socket not connected' })
  sock.emit(event, data, ack)
}

export const keyFor = (a: string, b: string) => `harvest:chat:${[a, b].sort().join(':')}`
export const groupKey = (slug: string) => `group:${slug}`

// REST history fallback (works even if socket offline)
export async function fetchHistory(peer?: string, groupSlug?: string) {
  const token = localStorage.getItem('harvest_token')
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (groupSlug) {
    const r = await fetch(`${BASE}/api/chat/history?group=${encodeURIComponent(groupSlug)}`, { headers })
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<{ messages: any[]; conversation_key: string }>
  }
  if (peer) {
    const r = await fetch(`${BASE}/api/chat/history?peer=${encodeURIComponent(peer)}`, { headers })
    if (!r.ok) throw new Error(await r.text())
    return r.json() as Promise<{ messages: any[]; conversation_key: string }>
  }
  throw new Error('peer or groupSlug required')
}

// coturn ICE servers for WebRTC (VPS 3478/5349) — 60% Nyeri 3G symmetric NAT needs TURN
export function getIceServers(): RTCConfiguration {
  const host = import.meta.env.VITE_COTURN_HOST || 'harvestfamily.or.ke'
  const user = import.meta.env.VITE_COTURN_USER || 'harvest'
  const pass = import.meta.env.VITE_COTURN_PASS || 'replace-me'
  return {
    iceServers: [
      { urls: `stun:${host}:3478` },
      { urls: `stun:stun.l.google.com:19302` },
      { urls: `stun:stun1.l.google.com:19302` },
      { urls: `turn:${host}:3478`, username: user, credential: pass },
      { urls: `turn:${host}:3478?transport=tcp`, username: user, credential: pass },
      { urls: `turns:${host}:5349`, username: user, credential: pass },
      { urls: `turns:${host}:5349?transport=tcp`, username: user, credential: pass },
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  }
}
