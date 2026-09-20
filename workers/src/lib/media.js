// Media storage on Cloudflare R2 — replaces Netlify Blobs (s3.js).
// Uploads: presigned POST (client → R2 directly, no function proxy).
// Reads: served through /api/media/* with a short-lived HMAC signature.
import { hmacSign, timingSafeEqualStr } from './crypto.js'
import { errorResponse } from './http.js'

export const BUCKET = 'harvest-media'
const DEFAULT_TTL = 900

// Sermon videos and worship tracks are larger than social clips: reels up to
// 100 MB (~10 min at 720p) and tracks up to 20 MB. Sermons are full services:
// audio up to 80 MB (~80 min mp3), video up to 500 MB (~60-90 min mp4).
// Stories allow short video moments up to 30 MB; photos 10 MB.
const MAX_BYTES = { post: 10 * 1024 * 1024, story: 30 * 1024 * 1024, reel: 100 * 1024 * 1024, track: 20 * 1024 * 1024, avatar: 5 * 1024 * 1024, sermon_audio: 80 * 1024 * 1024, sermon_video: 500 * 1024 * 1024 }
const ALLOW_CT = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  post: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  story: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  reel: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  track: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/x-m4a-aot', 'audio/aac', 'audio/ogg'],
  sermon_audio: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/ogg'],
  sermon_video: ['video/mp4', 'video/webm', 'video/x-m4v', 'video/quicktime'],
}

// Upload keys are restricted to originals/<type>/<yyyy>/<mm>/<uuid>.<ext>.
const KEY_RE = /^originals\/(avatar|post|story|reel|track|sermon_audio|sermon_video)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

// Reads also serve derived assets (thumbs/posters/hls) written by workers.
const READ_KEY_RES = [
  KEY_RE,
  /^thumbs\/(post|story|reel|track|sermon_audio|sermon_video)\/[0-9a-f-]+(-\d+w)?\.(webp|jpg|jpeg|png)$/i,
  /^posters\/[0-9a-f-]+\.(jpg|jpeg|webp|png)$/i,
  /^hls\/[0-9a-f-]+\/[a-zA-Z0-9._-]+\.(m3u8|ts)$/,
]
export const isReadableKey = key => READ_KEY_RES.some(re => re.test(key))

export function validatePresign({ type, contentType, bytes }) {
  if (!['avatar', 'post', 'story', 'reel', 'track', 'sermon_audio', 'sermon_video'].includes(type)) throw Object.assign(new Error('invalid type'), { status: 400 })
  const allowed = ALLOW_CT[type]
  if (!allowed.includes(contentType)) throw Object.assign(new Error(`contentType not allowed for ${type}: ${contentType}`), { status: 400 })
  const max = MAX_BYTES[type] || MAX_BYTES.post
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
}export async function mediaUrl(env, key, ttlSeconds, opts = {}) {
  if (!key) return null
  const { expires, signature } = await signMediaKey(env, key, ttlSeconds)
  const base = String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  const dl = opts.download ? `&dl=${encodeURIComponent(opts.download)}` : ''
  return `${base}/api/media/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}${dl}
`
}

export async function mediaUrlOrNull(env, key, ttlSeconds, opts = {}) {
  try {
    return await mediaUrl(env, key, ttlSeconds, opts)
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

// ── Presigned PUT (client uploads directly to R2) ──
// R2 supports presigned PUT URLs, not HTML multipart POST uploads. The signed
// owner metadata is required so /confirm can prove who uploaded the object.
async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacBytes(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))
}

function encodePath(path) {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function encodeQuery(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export async function presignedPost(env, { type, contentType, bytes, ext, ownerId }) {
  const max = validatePresign({ type, contentType, bytes })
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const safeExt = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : type === 'reel' ? 'mp4' : type === 'track' ? 'mp3' : 'jpg')
  const key = `originals/${type}/${yyyy}/${mm}/${crypto.randomUUID()}.${safeExt}`

  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return {
      url: '/api/media/upload',
      fields: { key, contentType },
      key,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      maxBytes: max,
      method: 'POST',
    }
  }

  const bucket = env.MEDIA_BUCKET_NAME || BUCKET
  const host = `${accountId}.r2.cloudflarestorage.com`
  const uri = `/${encodePath(bucket + '/' + key)}`
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}Z$/, 'Z')
  const date = amzDate.slice(0, 8)
  const credentialScope = `${date}/auto/s3/aws4_request`
  const owner = String(ownerId || '')
  if (!owner) throw Object.assign(new Error('upload owner is required'), { status: 500 })

  const signedHeaders = 'content-type;host;x-amz-meta-ownerid'
  const canonicalHeaders = `content-type:${contentType.toLowerCase()}\\nhost:${host}\\nx-amz-meta-ownerid:${owner}\\n`
  const canonicalQuery = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', '900'],
    ['X-Amz-SignedHeaders', signedHeaders],
  ].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join('&')
  const canonicalRequest = [
    'PUT',
    uri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\\n')

  const encoder = new TextEncoder()
  const kDate = await hmacBytes(encoder.encode('AWS4' + secretAccessKey), date)
  const kRegion = await hmacBytes(kDate, 'auto')
  const kService = await hmacBytes(kRegion, 's3')
  const kSigning = await hmacBytes(kService, 'aws4_request')
  const signature = [...await hmacBytes(kSigning, stringToSign)]
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return {
    url: `https://${host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    fields: {
      'Content-Type': contentType,
      'x-amz-meta-ownerid': owner,
    },
    key,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    maxBytes: max,
    method: 'PUT',
  }
}

// GET /api/media/* — signed reads from R2.
export async function handleMediaRead(request, env, ctx) {
  const url = new URL(request.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ''))
  if (!isReadableKey(key)) return errorResponse('invalid media key', 400)

  const signed = await verifyMediaSignature(env, key, url.searchParams.get('expires'), url.searchParams.get('signature'))
  if (!signed) return errorResponse('signed media URL required', 401)

  const obj = await env.MEDIA.get(key)
  if (!obj) return errorResponse('not found', 404)
  const headers = new Headers()
  headers.set('Content-Type', contentTypeForKey(key, obj.httpMetadata?.contentType))
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('ETag', obj.httpEtag)
  // ?dl=<filename> turns the read into a download (sermons): the WebView/browser
  // saves the file under that name instead of streaming it.
  const dl = url.searchParams.get('dl')
  if (dl && /^[a-z0-9._-]+$/i.test(dl)) {
    headers.set('Content-Disposition', `attachment; filename="${dl}"`)
    headers.set('Content-Length', String(obj.size))
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  return new Response(obj.body, { headers })
}
