// Media storage on Cloudflare R2 — replaces Netlify Blobs (s3.js).
// Uploads: presigned POST (client → R2 directly, no function proxy).
// Reads: served through /api/media/* with a short-lived HMAC signature.
import { hmacSign, timingSafeEqualStr } from './crypto.js'
import { errorResponse } from './http.js'

export const BUCKET = 'harvest-media'
const DEFAULT_TTL = 900

// Sermon videos and worship tracks are larger than social clips: reels up to
// 100 MB (~10 min at 720p) and tracks up to 20 MB. Sermons are full services:
// audio up to 2 GB and video up to 5 GB, giving ample headroom for multi-hour recordings. Large uploads go directly to R2 via presigned
// PUT — the in-Worker proxy fallback would run out of memory on files this
// size, so R2 credentials are required for full-length sermon videos.
// Stories allow short video moments up to 30 MB; photos 10 MB.
const MAX_BYTES = { post: 10 * 1024 * 1024, story: 30 * 1024 * 1024, reel: 100 * 1024 * 1024, track: 50 * 1024 * 1024, avatar: 5 * 1024 * 1024, chat: 10 * 1024 * 1024, sermon_audio: 2 * 1024 * 1024 * 1024, sermon_video: 5 * 1024 * 1024 * 1024 }
export const ALLOW_CT = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  post: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  story: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  reel: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  track: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/x-m4a-aot', 'audio/aac', 'audio/ogg'],
  sermon_audio: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav'],
  // Phones hand back whatever container the camera or a download produced.
  // Matroska, 3GP and AVI are accepted because refusing them left sermon
  // uploads failing with no usable explanation; the original file keeps its
  // native container (this Worker stores bytes, it does not transcode).
  sermon_video: ['video/mp4', 'video/webm', 'video/x-m4v', 'video/quicktime', 'video/x-matroska', 'video/3gpp', 'video/3gpp2', 'video/avi', 'video/x-msvideo', 'video/mpeg'],
  // Chat attachments: images only, referenced directly by chat messages rows.
  chat: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
}

// Upload keys are restricted to originals/<type>/<yyyy>/<mm>/<uuid>.<ext>.
const KEY_RE = /^originals\/(avatar|post|story|reel|track|chat|sermon_audio|sermon_video)\/\d{4}\/\d{2}\/[0-9a-f-]+\.[a-z0-9]+$/i

// Reads also serve derived assets (thumbs/posters/hls) written by workers.
const READ_KEY_RES = [
  KEY_RE,
  /^thumbs\/(post|story|reel|track|sermon_audio|sermon_video)\/[0-9a-f-]+(-\d+w)?\.(webp|jpg|jpeg|png)$/i,
  /^posters\/[0-9a-f-]+\.(jpg|jpeg|webp|png)$/i,
  /^hls\/[0-9a-f-]+\/[a-zA-Z0-9._-]+\.(m3u8|ts)$/,
]
export const isReadableKey = key => READ_KEY_RES.some(re => re.test(key))

export function validatePresign({ type, contentType, bytes }) {
  if (!['avatar', 'post', 'story', 'reel', 'track', 'chat', 'sermon_audio', 'sermon_video'].includes(type)) throw Object.assign(new Error('invalid type'), { status: 400 })
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
  return `${base}/api/media/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}${dl}`
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
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  '3gpp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  avi: 'video/x-msvideo',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
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

export async function presignedPost(env, { type, contentType, bytes, ext, ownerId, idempotencyKey }) {
  // Android pickers often hand back an empty or generic type for a picked
  // recording. Resolve it from the extension instead of rejecting the upload at
  // presign — the signature is made for the resolved type and the client sends
  // back exactly that on the PUT.
  const declared = String(contentType || '').toLowerCase().split(';')[0].trim()
  const resolvedType = (!declared || declared === 'application/octet-stream')
    ? (EXTENSION_CONTENT_TYPES[String(ext || '').toLowerCase()] || contentType)
    : contentType
  const max = validatePresign({ type, contentType: resolvedType, bytes })
  // A sermon is hundreds of megabytes over a mobile link. The 15-minute default
  // outlives neither a 200 MB video nor a slow uplink, and R2 answers 403 when
  // the signed window closes — after the whole transfer. Give sermon uploads a
  // six-hour window; everything social keeps the short one.
  const ttlSeconds = type === 'sermon_audio' || type === 'sermon_video' ? 6 * 3600 : 900
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const safeExt = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (resolvedType.includes('png') ? 'png' : resolvedType.includes('webp') ? 'webp' : type === 'reel' ? 'mp4' : type === 'track' ? 'mp3' : 'jpg')
  const stable = String(idempotencyKey || '').toLowerCase().replace(/[^0-9a-f-]/g, '').slice(0, 36)
  const idPart = stable || crypto.randomUUID().replace(/-/g, '')
  const key = `originals/${type}/${yyyy}/${mm}/${idPart}.${safeExt}`

  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return {
      url: '/api/media/upload',
      fields: { key, contentType: resolvedType },
      key,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
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
    ['X-Amz-Expires', String(ttlSeconds)],
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
      'Content-Type': resolvedType,
      'x-amz-meta-ownerid': owner,
    },
    key,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    maxBytes: max,
    method: 'PUT',
  }
}

// ── Multipart (chunked, resumable) uploads ──
// Chunks travel client → Worker → R2, so a device never has to reach
// *.r2.cloudflarestorage.com itself. That direct host is exactly what failed on
// mobile devices whose network blocks it, or whose origin fails the bucket's
// CORS preflight — an opaque XHR "network error" with no HTTP status. 8 MiB
// keeps each request well inside the Worker body limit while clearing R2's
// 5 MiB part minimum.
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024
export const MAX_PARTS = 10_000

const hexOf = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

function r2Credentials(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) return null
  return { accountId, accessKeyId, secretAccessKey, bucket: env.MEDIA_BUCKET_NAME || BUCKET }
}

// SigV4 with an Authorization header (not a presigned URL): these calls are
// made by the Worker itself, so the signature is computed server-side.
async function r2Request(env, { method, key, query = {}, headers = {}, body }) {
  const creds = r2Credentials(env)
  if (!creds) throw Object.assign(new Error('storage credentials are not configured on the server'), { status: 501 })
  const host = `${creds.accountId}.r2.cloudflarestorage.com`
  const uri = `/${encodePath(creds.bucket + '/' + key)}`
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const date = amzDate.slice(0, 8)
  const payloadHash = 'UNSIGNED-PAYLOAD'
  const signed = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])),
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const names = Object.keys(signed).sort()
  const canonicalHeaders = names.map(n => `${n}:${signed[n]}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalQuery = Object.keys(query).sort().map(k => `${encodeQuery(k)}=${encodeQuery(query[k])}`).join('&')
  const scope = `${date}/auto/s3/aws4_request`
  const canonicalRequest = [method, uri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')
  const encoder = new TextEncoder()
  const kDate = await hmacBytes(encoder.encode('AWS4' + creds.secretAccessKey), date)
  const kRegion = await hmacBytes(kDate, 'auto')
  const kService = await hmacBytes(kRegion, 's3')
  const kSigning = await hmacBytes(kService, 'aws4_request')
  const signature = hexOf(await hmacBytes(kSigning, stringToSign))
  return fetch(`https://${host}${uri}${canonicalQuery ? '?' + canonicalQuery : ''}`, {
    method,
    headers: {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)])),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })
}

// One key derivation for every upload path, so presign and multipart agree on
// the shape /confirm and the read routes validate.
export function mediaKeyFor({ type, ext, contentType, idempotencyKey }) {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const ct = String(contentType || '').toLowerCase()
  const safeExt = String(ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('mpeg') ? 'mp3' : ct.startsWith('video/') || type === 'reel' ? 'mp4' : 'jpg')
  const stable = String(idempotencyKey || '').toLowerCase().replace(/[^0-9a-f-]/g, '').slice(0, 36)
  return `originals/${type}/${yyyy}/${mm}/${stable || crypto.randomUUID().replace(/-/g, '')}.${safeExt}`
}

const xmlTag = (xml, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(String(xml))
  return m ? m[1].trim() : ''
}

export async function createMultipartUpload(env, { key, contentType, ownerId }) {
  const res = await r2Request(env, {
    method: 'POST',
    key,
    query: { uploads: '' },
    headers: { 'content-type': contentType, 'x-amz-meta-ownerid': String(ownerId) },
  })
  const xml = await res.text()
  if (!res.ok) throw Object.assign(new Error(`storage refused to start the upload (${res.status})`), { status: 502 })
  const uploadId = xmlTag(xml, 'UploadId')
  if (!uploadId) throw Object.assign(new Error('storage did not return an upload id'), { status: 502 })
  return uploadId
}

export async function uploadMultipartPart(env, { key, uploadId, partNumber, body }) {
  const res = await r2Request(env, {
    method: 'PUT',
    key,
    query: { partNumber: String(partNumber), uploadId },
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const message = xmlTag(detail, 'Message')
    throw Object.assign(new Error(`part ${partNumber} rejected by storage (${res.status})${message ? ': ' + message : ''}`), { status: 502 })
  }
  const etag = res.headers.get('etag')
  if (!etag) throw Object.assign(new Error(`part ${partNumber} was stored without an ETag`), { status: 502 })
  return etag.replace(/"/g, '')
}

export async function listMultipartParts(env, { key, uploadId }) {
  const res = await r2Request(env, { method: 'GET', key, query: { uploadId } })
  const xml = await res.text()
  if (!res.ok) {
    if (res.status === 404) throw Object.assign(new Error('upload session not found — start the upload again'), { status: 404 })
    throw Object.assign(new Error(`storage could not list parts (${res.status})`), { status: 502 })
  }
  const parts = []
  const re = /<Part>([\s\S]*?)<\/Part>/g
  let m
  while ((m = re.exec(xml))) {
    const partNumber = Number(xmlTag(m[1], 'PartNumber'))
    const etag = xmlTag(m[1], 'ETag').replace(/"/g, '')
    if (partNumber && etag) parts.push({ partNumber, etag })
  }
  return parts
}

export async function completeMultipartUpload(env, { key, uploadId, parts }) {
  const xmlBody = '<CompleteMultipartUpload>' + [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(p => `<Part><PartNumber>${Number(p.partNumber)}</PartNumber><ETag>"${String(p.etag).replace(/["<>&]/g, '')}"</ETag></Part>`)
    .join('') + '</CompleteMultipartUpload>'
  const res = await r2Request(env, {
    method: 'POST',
    key,
    query: { uploadId },
    headers: { 'content-type': 'application/xml' },
    body: new TextEncoder().encode(xmlBody),
  })
  const xml = await res.text()
  // S3-family services can answer 200 with an <Error> body; treat both as failure.
  if (!res.ok || /<Error>/.test(xml)) {
    throw Object.assign(new Error(xmlTag(xml, 'Message') || `storage could not finish the upload (${res.status})`), { status: 502 })
  }
  return { key }
}

export async function abortMultipartUpload(env, { key, uploadId }) {
  try { await r2Request(env, { method: 'DELETE', key, query: { uploadId } }) } catch { /* best effort */ }
}

// ── Staged chunks (no S3 credentials required) ──
// The multipart session above is a SigV4 call against R2's S3 API, so it needs
// account-scoped R2 keys. Without them every chunk went straight to a 501
// "storage credentials are not configured on the server", which is a dead end
// for a phone twice removed from any dashboard. The binding can do the same job
// through a different route: keep each part as its own small object under
// tmp/chunks/<uploadId>/, then join them into the final key on complete. Parts
// stay independent, so a dropped upload resumes exactly as it does on the S3
// path — and the R2 bucket stays a single public object per upload.
export const STAGED_CHUNK_PREFIX = 'tmp/chunks/'
const STAGED_ID_PREFIX = 'st_'

// The id names the backend, so every later call on this session knows which one
// it is looking at without any D1 row or extra client state.
export const isStagedUpload = uploadId => String(uploadId || '').startsWith(STAGED_ID_PREFIX)
export const newStagedUploadId = () => STAGED_ID_PREFIX + crypto.randomUUID().replace(/-/g, '')
export const hasStorageCredentials = env => !!r2Credentials(env)
const stagedChunkKey = (uploadId, partNumber) => `${STAGED_CHUNK_PREFIX}${uploadId}/${String(partNumber).padStart(6, '0')}`

// ETags do not exist for a binding put, but the client only ever echoes them
// back, so a size-derived value keeps the resume bookkeeping identical.
const stagedEtag = size => `staged-${size}`

export async function stageChunk(env, { uploadId, partNumber, body }) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body)
  if (!bytes.byteLength) throw Object.assign(new Error('part is empty'), { status: 400 })
  await env.MEDIA.put(stagedChunkKey(uploadId, partNumber), bytes)
  return { etag: stagedEtag(bytes.byteLength) }
}

export async function listStagedChunks(env, uploadId) {
  const prefix = `${STAGED_CHUNK_PREFIX}${uploadId}/`
  const parts = []
  let cursor
  do {
    const listed = await env.MEDIA.list({ prefix, cursor })
    for (const object of listed.objects || []) {
      const partNumber = Number(String(object.key).slice(prefix.length))
      if (partNumber) parts.push({ partNumber, etag: stagedEtag(Number(object.size) || 0), size: Number(object.size) || 0, key: object.key })
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return parts.sort((a, b) => a.partNumber - b.partNumber)
}

export async function deleteStagedChunks(env, uploadId) {
  const keys = (await listStagedChunks(env, uploadId)).map(p => p.key)
  // R2 accepts up to 1000 keys per delete call; a 5 GB sermon is 640 parts.
  while (keys.length) {
    try { await env.MEDIA.delete(keys.splice(0, 1000)) } catch { /* best effort */ }
  }
}

export async function abortStagedChunks(env, uploadId) {
  try { await deleteStagedChunks(env, uploadId) } catch { /* best effort */ }
}

// Join the parts into the object the app actually reads. The body is streamed
// part by part into a FixedLengthStream, so peak memory is one part (8 MiB)
// rather than the whole sermon — the reason a single 400 MB request could never
// pass through a Worker. FixedLengthStream also fails the put if the assembled
// byte count does not match, which catches a truncated part before it reaches
// the sermons table as a broken video.
export async function completeStagedChunks(env, { key, uploadId, contentType, ownerId }) {
  const parts = await listStagedChunks(env, uploadId)
  if (!parts.length) throw Object.assign(new Error('no chunks have been uploaded yet — retry the upload'), { status: 400 })
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].partNumber !== i + 1) {
      throw Object.assign(new Error(`chunk ${i + 1} is missing — retry the upload`), { status: 409 })
    }
  }
  const total = parts.reduce((n, p) => n + p.size, 0)
  if (!total) throw Object.assign(new Error('uploaded chunks are empty — retry the upload'), { status: 400 })

  const fixed = new FixedLengthStream(total)
  const put = env.MEDIA.put(key, fixed.readable, {
    httpMetadata: { contentType },
    customMetadata: { ownerId: String(ownerId), uploadedAt: new Date().toISOString() },
  })
  const writer = fixed.writable.getWriter()
  try {
    for (const part of parts) {
      const object = await env.MEDIA.get(part.key)
      if (!object) throw Object.assign(new Error(`chunk ${part.partNumber} disappeared — retry the upload`), { status: 409 })
      const reader = object.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
      }
    }
    await writer.close()
    await put
  } catch (e) {
    try { await writer.abort(e) } catch { /* already closed */ }
    try { await put } catch { /* the abort surfaces here */ }
    // Keep the parts: the client's retry re-runs complete without re-uploading.
    throw Object.assign(new Error(e?.message || 'could not join the uploaded chunks'), { status: e?.status || 502 })
  }
  await deleteStagedChunks(env, uploadId)
  return { key, size: total }
}

// Abandoned sessions (app killed mid-upload) would otherwise sit in the bucket
// forever. Staged parts are single-use, so anything untouched for a day is dead.
export async function purgeStaleStagedChunks(env, olderThanMs = 24 * 3600_000) {
  const cutoff = Date.now() - olderThanMs
  let cursor, removed = 0
  do {
    const listed = await env.MEDIA.list({ prefix: STAGED_CHUNK_PREFIX, cursor })
    const stale = (listed.objects || [])
      .filter(o => new Date(o.uploaded || 0).getTime() < cutoff)
      .map(o => o.key)
      .slice(0, 1000)
    if (stale.length) { await env.MEDIA.delete(stale); removed += stale.length }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return removed
}

// GET /api/media/* — signed reads from R2.
// Range handling is explicit: parse the header ourselves and pass a proper
// {offset, length} to R2. Forwarding raw request headers used to make the
// binding report a range even for plain GETs, answering 206 to <img> requests
// and breaking every decoded image.
function parseRangeHeader(value, size) {
  if (!value) return undefined
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined
  if (m[1] === undefined) {
    const suffix = Number(m[2])
    if (suffix <= 0) return undefined
    return { suffix: Math.min(suffix, size) }
  }
  const offset = Number(m[1])
  if (offset >= size) return undefined
  if (m[2] === undefined) return { offset, length: size - offset }
  const length = Number(m[2]) - offset + 1
  if (length <= 0) return undefined
  return { offset, length: Math.min(length, size - offset) }
}

export async function handleMediaRead(request, env, ctx) {
  const url = new URL(request.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ''))
  if (!isReadableKey(key)) return errorResponse('invalid media key', 400)

  const signed = await verifyMediaSignature(env, key, url.searchParams.get('expires'), url.searchParams.get('signature'))
  if (!signed) return errorResponse('signed media URL required', 401)

  if (request.method === 'HEAD') {
    const meta = await env.MEDIA.head(key)
    if (!meta) return errorResponse('not found', 404)
    const headers = new Headers()
    headers.set('Content-Type', contentTypeForKey(key, meta.httpMetadata?.contentType))
    headers.set('Content-Length', String(meta.size))
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(null, { status: 200, headers })
  }

  const rangeHeader = request.headers.get('Range')
  let range = undefined
  if (rangeHeader) {
    const meta = await env.MEDIA.head(key)
    if (!meta) return errorResponse('not found', 404)
    range = parseRangeHeader(rangeHeader, Number(meta.size))
    if (!range) range = undefined
  }
  const obj = await env.MEDIA.get(key, range ? { range } : undefined)
  if (!obj) return errorResponse('not found', 404)
  const ranged = range && obj.range && typeof obj.range.offset === 'number' && typeof obj.range.length === 'number' && obj.range.length !== obj.size
  const headers = new Headers()
  headers.set('Content-Type', contentTypeForKey(key, obj.httpMetadata?.contentType))
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('ETag', obj.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
  headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, ETag')
  if (ranged) {
    const start = obj.range.offset
    const end = Math.min(start + obj.range.length - 1, obj.size - 1)
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + obj.size)
    headers.set('Content-Length', String(end - start + 1))
  } else {
    headers.set('Content-Length', String(obj.size))
  }
  // ?dl=<filename> turns the read into a download (sermons): the WebView/browser
  // saves the file under that name instead of streaming it.
  const dl = url.searchParams.get('dl')
  if (dl && /^[a-z0-9._-]+$/i.test(dl)) {
    headers.set('Content-Disposition', `attachment; filename="${dl}"`)
    headers.set('Content-Length', String(obj.size))
  }
  const status = ranged ? 206 : 200
  return new Response(obj.body, { status, headers })
}
