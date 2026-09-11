import * as Minio from 'minio'
import dotenv from 'dotenv'
dotenv.config()

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`[config] Missing required environment variable: ${name}`)
  return value
}

const endPoint = requiredEnv('MINIO_ENDPOINT')
const port = parseInt(process.env.MINIO_PORT || '9000', 10)
const useSSL = (process.env.MINIO_USE_SSL || 'false') === 'true'
const accessKey = requiredEnv('MINIO_ACCESS_KEY')
const secretKey = requiredEnv('MINIO_SECRET_KEY')
export const BUCKET = process.env.MINIO_BUCKET || 'harvest-media'

export const minio = new Minio.Client({ endPoint, port, useSSL, accessKey, secretKey })

export async function ensureBucket() {
  const exists = await minio.bucketExists(BUCKET).catch(() => false)
  if (!exists) {
    await minio.makeBucket(BUCKET, '')
    console.log(`[s3] bucket created ${BUCKET}`)
  }
  // Keep the bucket private; callers receive short-lived presigned URLs.
}

const MAX_BYTES = { image: 8*1024*1024, video: 80*1024*1024, audio: 15*1024*1024 }
const ALLOW_CT = {
  post: ['image/jpeg','image/png','image/webp','image/heic'],
  story: ['image/jpeg','image/png','image/webp'],
  reel: ['video/mp4','video/quicktime','video/webm'],
  track: ['audio/mpeg','audio/mp3','audio/m4a','audio/x-m4a','audio/wav'],
}

export function validatePresign({ type, contentType, bytes }) {
  if (!['post','story','reel','track'].includes(type)) throw Object.assign(new Error('invalid type'), { statusCode: 400 })
  const allowed = ALLOW_CT[type]
  if (!allowed.includes(contentType)) throw Object.assign(new Error(`contentType not allowed for ${type}: ${contentType}`), { statusCode: 400 })
  const max = type==='reel' ? MAX_BYTES.video : type==='track' ? MAX_BYTES.audio : MAX_BYTES.image
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > max) throw Object.assign(new Error(`bytes must be between 1 and ${max} for ${type}`), { statusCode: 400 })
  return max
}

export async function presignedPost({ type, contentType, bytes, ext }) {
  const max = validatePresign({ type, contentType, bytes })
  const uuid = (await import('uuid')).v4()
  const now = new Date()
  const yyyy = String(now.getFullYear()), mm = String(now.getMonth()+1).padStart(2,'0')
  // Never trust the client extension for the object suffix.
  const safeExt = contentType.includes('png') ? 'png'
    : contentType.includes('webp') ? 'webp'
    : contentType.includes('heic') ? 'heic'
    : type==='reel' ? 'mp4'
    : type==='track' ? 'mp3' : 'jpg'
  const key = `originals/${type}/${yyyy}/${mm}/${uuid}.${safeExt}`
  const policy = minio.newPostPolicy()
  policy.setBucket(BUCKET)
  policy.setKey(key)
  policy.setExpires(new Date(Date.now()+15*60*1000))
  policy.setContentType(contentType)
  policy.setContentLengthRange(1, max)
  const data = await minio.presignedPostPolicy(policy)
  return { url: data.postURL, fields: data.formData, key, expiresAt: new Date(Date.now()+15*60*1000).toISOString(), maxBytes: max }
}

export async function presignedGet(key, expirySec=900) {
  return minio.presignedGetObject(BUCKET, key, expirySec)
}

export async function presignedGetOrNull(key, expirySec=900) {
  if (!key) return null
  try { return await presignedGet(key, expirySec) } catch { return null }
}
