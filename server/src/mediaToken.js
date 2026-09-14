import crypto from 'node:crypto'

// Browsers cannot attach an Authorization header to <img>/<video> requests, so
// media reads are authorized with a short-lived signature embedded in the URL.
// The signature is scoped to one object key and expires; it is not a session.
const DEFAULT_TTL_SECONDS = 900

function secret() {
  const value = process.env.MEDIA_URL_SECRET || process.env.JWT_SECRET || ''
  if (value.length < 32) {
    throw new Error('MEDIA_URL_SECRET or JWT_SECRET (>=32 chars) is required to sign media URLs')
  }
  return value
}

function signatureFor(key, expires) {
  return crypto.createHmac('sha256', secret()).update(`${key}\n${expires}`).digest('base64url')
}

export function signMediaKey(key, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const ttl = Number.isFinite(Number(ttlSeconds)) ? Math.max(60, Math.floor(Number(ttlSeconds))) : DEFAULT_TTL_SECONDS
  const expires = Math.floor(Date.now() / 1000) + ttl
  return { expires, signature: signatureFor(key, expires) }
}

export function mediaUrl(key, ttlSeconds) {
  if (!key) return null
  const { expires, signature } = signMediaKey(key, ttlSeconds)
  // Relative by default (same-origin web). When PUBLIC_BASE_URL is set — e.g. the
  // Netlify site URL — links become absolute so the Capacitor APK WebView can load them.
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  return `${base}/api/media/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
}

export function verifyMediaSignature(key, expires, signature) {
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false
  if (typeof signature !== 'string' || !signature) return false
  let expected
  try {
    expected = signatureFor(key, expiry)
  } catch {
    return false
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Content type fallback for derived assets (HLS segments, posters, thumbs) that
// were written without media metadata.
const EXTENSION_CONTENT_TYPES = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  quicktime: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
}

export function contentTypeForKey(key, stored) {
  const normalized = stored || ''
  if (normalized && normalized !== 'application/octet-stream') return normalized
  const ext = String(key || '').split('.').pop()?.toLowerCase() || ''
  return EXTENSION_CONTENT_TYPES[ext] || 'application/octet-stream'
}
