// Media storage on Cloudflare R2 — replaces Netlify Blobs (s3.js).
// Uploads: presigned POST (client → R2 directly, no function proxy).
// Reads: served through /api/media/* with a short-lived HMAC signature.
import { hmacSign, timingSafeEqualStr } from './crypto.js'
import { errorResponse } from './http.js'

export const BUCKET = 'harvest-media'
const DEFAULT_TTL = 900

// Sermon videos and worship tracks are larger than social clips: reels up to
// 100 MB (~10 min at 720p) and tracks up to 20 MB. Stories allow short video
// moments (the creator + viewer both support video) up to 30 MB (~2 min phone
// clip); photos 10 MB.
const MAX_BYTES = { post: 10 * 1024 * 1024, story: 30 * 1024 * 1024, reel: 100 * 1024 * 1024, track: 20 * 1024 * 1024, avatar: 5 * 1024 * 1024 }
const ALLOW_CT = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  post: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  story: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  reel: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  track: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/x-m4a-aot', 'audio/aac', 'audio/ogg'],
}

// Upload keys are restricted to originals/<type>/<yyyy>/<mm>/<uuid>.<ext>.
const KEY_RE = /^originals\/(avatar|post|story|reel|track)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

// Reads also serve derived assets (thumbs/posters/hls) written by workers.
const READ_KEY_RES = [
  KEY_RE,
  /^thumbs\/(post|story|reel|track)\/[0-9a-f-]+(-\d+w)?\.(webp|jpg|jpeg|png)$/i,
  /^posters\/[0-9a-f-]+\.(jpg|jpeg|webp|png)$/i,
  /^hls\/[0-9a-f-]+\/[a-zA-Z0-9._-]+\.(m3u8|ts)$/,
]
export const isReadableKey = key => READ_KEY_RES.some(re => re.test(key))

export function validatePresign({ type, contentType, bytes }) {
  if (!['avatar', 'post', 'story', 'reel', 'track'].includes(type)) throw Object.assign(new Error('invalid type'), { status: 400 })
  const allowed = ALLOW_CT[type]
  if (!allowed.includes(contentType)) throw Object.assign(new Error(`contentType not allowed for ${type}: ${contentType}`), { status: 400 })
  const max = type === 'reel' ? MAX_BYTES.video || MAX_BYTES.reel : type === 'track' ? MAX_BYTES.audio || MAX_BYTES.track : MAX_BYTES.image || MAX_BYTES[type] || MAX_BYTES.post
  if (bytes > max) throw Object.assign(new Error(`bytes ${bytes} > max ${max} for ${type}`), { status: 400 })
  return max
}

export function mediaSecret(env) {
  const value = env.MEDIA_URL_SECRET || env.JWT_SECRET || ''
  if (String(value).length < 32) throw new Error('MEDIA_URL_SECRET or JWT_SECRET (>=32 chars) is required to sign media URLs')
  return String(value)
}

export async function signMediaKey(env, key, ttlSeconds = DEFAULT_TTL) {
  const ttl = Number.isFinite(Number(ttlSeconds)) ? Math.max(60, Math.floor(Number(ttlSeconds))) : DEFAULT_TTL
  const expires = Math.floor(Date.now() / 1000) + ttl
  const signature = await hmacSign(mediaSecret(env), `${key}\n${expires}`)
  return { expires, signature }
}

export async function mediaUrl(env, key, ttlSeconds) {
  if (!key) return null
  const { expires, signature } = await signMediaKey(env, key, ttlSeconds)
  const base = String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  return `${base}/api/media/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`
}

export async function mediaUrlOrNull(env, key, ttlSeconds) {
  try {
    return await mediaUrl(env, key, ttlSeconds)
  } catch {
    return null
  }
}

export async function verifyMediaSignature(env, key, expires, signature) {
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false
  if (typeof signature !== 'string' || !signature) return false
  const expected = await hmacSign(mediaSecret(env), `${key}\n${expiry}`)
  return timingSafeEqualStr(expected, signature)
}

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

// ── Presigned POST (client uploads directly to R2) ──
// Client flow: POST these fields as multipart/form-data to `${url}` with `file` last.

export async function presignedPost(env, { type, contentType, bytes, ext }) {
  const max = validatePresign({ type, contentType, bytes })
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const safeExt = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : type === 'reel' ? 'mp4' : type === 'track' ? 'mp3' : 'jpg')
  const key = `originals/${type}/${yyyy}/${mm}/${crypto.randomUUID()}.${safeExt}`

  // R2 supports POST policies (S3-compatible). Build the policy + signature by hand.
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    // Fallback: proxy the upload through the Worker (still works, slightly slower).
    return { url: '/api/media/upload', fields: { key, contentType }, key, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), maxBytes: max }
  }

  const expiration = new Date(Date.now() + 15 * 60_000).toISOString()
  const policy = {
    expiration,
    conditions: [
      { bucket: env.MEDIA_BUCKET_NAME || BUCKET },
      ['starts-with', '$key', `originals/${type}/`],
      { acl: 'private' },
      ['eq', '$Content-Type', contentType],
      ['content-length-range', 1, max],
    ],
  }
  const policyB64 = btoa(JSON.stringify(policy).replace(/[^\x00-\x7F]/g, ''))
  const encoder = new TextEncoder()
  const dateKey = await crypto.subtle.importKey('raw', encoder.encode(secretAccessKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signHex = async (keyObj, data) => {
    const sig = await crypto.subtle.sign('HMAC', keyObj, encoder.encode(data))
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8)
  const dateKey2 = await crypto.subtle.sign('HMAC', dateKey, encoder.encode(date))
  const dateKey3 = await crypto.subtle.importKey('raw', dateKey2, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const regionKey = await crypto.subtle.sign('HMAC', dateKey3, encoder.encode('auto'))
  const regionKey2 = await crypto.subtle.importKey('raw', new Uint8Array(regionKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const serviceKey = await crypto.subtle.sign('HMAC', regionKey2, encoder.encode('s3'))
  const serviceKey2 = await crypto.subtle.importKey('raw', new Uint8Array(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signingKey = await crypto.subtle.sign('HMAC', serviceKey2, encoder.encode('aws4_request'))
  const signingKey2 = await crypto.subtle.importKey('raw', new Uint8Array(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await signHex(signingKey2, policyB64)

  return {
    url: `https://${accountId}.r2.cloudflarestorage.com/${env.MEDIA_BUCKET_NAME || BUCKET}`,
    fields: {
      key,
      acl: 'private',
      'Content-Type': contentType,
      Policy: policyB64,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${date}/auto/s3/aws4_request`,
      'X-Amz-Date': `${date}000000Z`,
      'X-Amz-Signature': signature,
    },
    key,
    expiresAt: expiration,
    maxBytes: max,
  }
}

// GET /api/media/* — signed reads from R2.
export async function handleMediaRead(request, env, ctx) {
  const url = new URL(request.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ''))
  if (!isReadableKey(key)) return errorResponse('invalid media key', 400)

  const signed = await verifyMediaSignature(env, key, url.searchParams.get('expires'), url.searchParams.get('signature'))
  const member = ctx.user && ['member', 'admin'].includes(ctx.user.role)
  if (!signed && !member) return errorResponse('signed media URL required', 401)

  const obj = await env.MEDIA.get(key)
  if (!obj) return errorResponse('not found', 404)
  const headers = new Headers()
  headers.set('Content-Type', contentTypeForKey(key, obj.httpMetadata?.contentType))
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('ETag', obj.httpEtag)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  return new Response(obj.body, { headers })
}
