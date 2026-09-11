// Socket.IO security helpers. Rate limits are intentionally process-local for the single-VPS deployment.
// If realtime is scaled horizontally, move this limiter to Redis.
const buckets = new Map()

export function rateLimit(socket, action, limit, windowMs = 60_000) {
  const key = `${socket.user?.id || socket.handshake.address}:${action}`
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  if (bucket.count > limit) return false
  return true
}

export function validateString(value, max, required = false) {
  if (typeof value !== 'string') return required ? null : ''
  const trimmed = value.trim()
  if (required && !trimmed) return null
  if (trimmed.length > max) return null
  return trimmed
}

export function dmConversationKey(a, b) {
  return `harvest:chat:${[a, b].sort().join(':')}`
}

export function ownsDmConversation(username, peer, conversationKey) {
  if (!username || !peer || username === peer) return false
  return conversationKey === dmConversationKey(username, peer)
}

export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true
  return allowedOrigins.includes(origin)
}

export function cleanupRateLimitBuckets() {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
}
