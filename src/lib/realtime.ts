// src/lib/realtime.ts — realtime client for the Cloudflare Realtime Durable Object.
// Wire protocol: JSON frames {event, data, ackId?} → server; server sends
// {event, data} and {event:'__ack', ackId, payload}. REST fallbacks (fetchHistory)
// work even if the socket is offline. Set VITE_REALTIME_URL (or VITE_API_URL) to
// the Workers origin; empty disables realtime entirely (Netlify-only deploys).

const BASE = (import.meta.env.VITE_REALTIME_URL || import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

let sock: WebSocket | null = null
let backoff = 800
let closedByUs = false
type Handler = (...args: any[]) => void
const listeners: Record<string, Set<Handler>> = {}
const pendingAcks = new Map<number, (res: any) => void>()
let ackSeq = 1
let currentToken = ''

export function getSocket(): WebSocket | null { return sock }
export function realtimeEnabled(): boolean { return BASE !== '' }

function dispatch(event: string, ...args: any[]) {
  for (const h of listeners[event] || []) {
    try { h(...args) } catch (e) { console.warn('[realtime] handler error', event, e) }
  }
}

function scheduleReconnect() {
  if (closedByUs || !BASE) return
  setTimeout(() => connectSocket(currentToken), backoff)
  backoff = Math.min(backoff * 1.6, 5000)
}

export function connectSocket(token?: string): WebSocket | null {
  if (!BASE) return null // realtime disabled
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return sock
  const t = token || localStorage.getItem('harvest_token') || ''
  currentToken = t
  closedByUs = false
  if (sock) { try { sock.close() } catch {} sock = null }

  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(t)}`)
  sock = ws
  ws.onopen = () => {
    backoff = 800
    dispatch('connect')
  }
  ws.onmessage = ev => {
    let frame: any
    try { frame = JSON.parse(ev.data) } catch { return }
    if (frame?.event === '__ack' && frame.ackId != null) {
      pendingAcks.get(frame.ackId)?.(frame.payload)
      pendingAcks.delete(frame.ackId)
      return
    }
    if (frame?.event) dispatch(frame.event, frame.data)
  }
  ws.onclose = () => {
    sock = null
    dispatch('disconnect', 'transport closed')
    scheduleReconnect()
  }
  ws.onerror = () => {
    dispatch('connect_error', new Error('websocket error'))
  }
  return ws
}

export function disconnectSocket() {
  closedByUs = true
  sock?.close()
  sock = null
  for (const [, fn] of pendingAcks) fn({ error: 'socket closed' })
  pendingAcks.clear()
}

export function onSocket(event: string, handler: Handler) {
  if (!listeners[event]) listeners[event] = new Set<Handler>()
  listeners[event].add(handler)
  return () => { listeners[event]?.delete(handler) }
}

export function emitSocket(event: string, data: any, ack?: (res: any) => void) {
  if (!sock || sock.readyState !== WebSocket.OPEN) return ack?.({ error: 'socket not connected' })
  const frame: any = { event, data }
  if (ack) {
    const id = ackSeq++
    frame.ackId = id
    pendingAcks.set(id, ack)
    // expire stale acks after 15s
    setTimeout(() => {
      if (pendingAcks.has(id)) { pendingAcks.delete(id); ack({ error: 'ack timeout' }) }
    }, 15_000)
  }
  try { sock.send(JSON.stringify(frame)) } catch { ack?.({ error: 'send failed' }) }
}

export const keyFor = (a: string, b: string) => `harvest:chat:${[a, b].sort().join(':')}`
export const groupKey = (slug: string) => `group:${slug}`

// REST history fallback (works even if socket offline)
export async function fetchHistory(peer?: string, groupSlug?: string) {
  const token = localStorage.getItem('harvest_token')
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  // REST history is served by the API (Workers), same origin as the socket.
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

// coturn ICE servers for WebRTC (VPS 3478/5349) — 60% Nyeri 3G symmetric NAT needs TURN.
// STUN-only works for many networks; TURN requires the VPS (can be added later).
export function getIceServers(): RTCConfiguration {
  const host = import.meta.env.VITE_COTURN_HOST || ''
  const user = import.meta.env.VITE_COTURN_USER || ''
  const pass = import.meta.env.VITE_COTURN_PASS || ''
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
  if (host) {
    servers.push({ urls: `stun:${host}:3478` })
    if (user && pass) {
      servers.push(
        { urls: `turn:${host}:3478`, username: user, credential: pass },
        { urls: `turn:${host}:3478?transport=tcp`, username: user, credential: pass },
        { urls: `turns:${host}:5349`, username: user, credential: pass },
        { urls: `turns:${host}:5349?transport=tcp`, username: user, credential: pass },
      )
    }
  }
  return {
    iceServers: servers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  }
}
