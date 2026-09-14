import fs from 'node:fs/promises'
import { getStore } from '@netlify/blobs'
import { v4 as uuid } from 'uuid'
import dotenv from 'dotenv'
import { mediaUrl } from './mediaToken.js'
dotenv.config()

export const BUCKET = 'harvest-media'
export const mediaStore = getStore(BUCKET)

const MAX_BYTES = { image: 5 * 1024 * 1024, video: 5 * 1024 * 1024, audio: 5 * 1024 * 1024 }
const ALLOW_CT = {
  post: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  story: ['image/jpeg', 'image/png', 'image/webp'],
  reel: ['video/mp4', 'video/quicktime', 'video/webm'],
  track: ['audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/wav'],
}

export function validatePresign({ type, contentType, bytes }) {
  if (!['post', 'story', 'reel', 'track'].includes(type)) throw Object.assign(new Error('invalid type'), { statusCode: 400 })
  const allowed = ALLOW_CT[type]
  if (!allowed.includes(contentType)) throw Object.assign(new Error(`contentType not allowed for ${type}: ${contentType}`), { statusCode: 400 })
  const max = type === 'reel' ? MAX_BYTES.video : type === 'track' ? MAX_BYTES.audio : MAX_BYTES.image
  if (bytes > max) throw Object.assign(new Error(`bytes ${bytes} > max ${max} for ${type}`), { statusCode: 400 })
  return max
}

export async function presignedPost({ type, contentType, bytes, ext }) {
  const max = validatePresign({ type, contentType, bytes })
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const safeExt = (ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
    (contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : type === 'reel' ? 'mp4' : type === 'track' ? 'mp3' : 'jpg')
  const key = `originals/${type}/${yyyy}/${mm}/${uuid()}.${safeExt}`
  return {
    url: '/api/media/upload',
    fields: { key, contentType },
    key,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    maxBytes: max,
  }
}

export async function presignedGetOrNull(key, ttlSeconds) {
  if (!key) return null
  try {
    const metadata = await mediaStore.getMetadata(key)
    if (!metadata) return null
    // Signed, short-lived URL: <img>/<video> cannot send a bearer token.
    return mediaUrl(key, ttlSeconds)
  } catch {
    return null
  }
}

export async function removeObjectOrIgnore(key) {
  if (!key) return false
  try {
    const existing = await mediaStore.getMetadata(key)
    if (!existing) return false
    await mediaStore.delete(key)
    return true
  } catch (error) {
    console.warn(`[blobs] unable to remove ${key}: ${error?.message || error}`)
    return false
  }
}

// Small compatibility surface for existing routes and workers while the app
// migrates off MinIO. Bucket arguments are accepted and ignored.
function normalizeMetadata(metadata = {}) {
  const out = {}
  for (const [rawKey, value] of Object.entries(metadata)) {
    if (rawKey === 'Content-Type') out.contentType = value
    else out[rawKey[0].toLowerCase() + rawKey.slice(1)] = value
  }
  return out
}

export const minio = {
  async statObject(_bucket, key) {
    const metadata = await mediaStore.getMetadata(key)
    if (!metadata) throw new Error('not found')
    return metadata
  },
  async removeObject(_bucket, key) {
    await mediaStore.delete(key)
  },
  async putObject(_bucket, key, data, _size, metadata = {}) {
    await mediaStore.set(key, data, { metadata: normalizeMetadata(metadata) })
  },
  async fGetObject(_bucket, key, filePath) {
    const data = await mediaStore.get(key, { type: 'arrayBuffer' })
    if (!data) throw new Error(`object not found: ${key}`)
    await fs.writeFile(filePath, Buffer.from(data))
  },
  async fPutObject(_bucket, key, filePath, metadata = {}) {
    const data = await fs.readFile(filePath)
    await mediaStore.set(key, data, { metadata: normalizeMetadata(metadata) })
  },
}

export async function ensureBucket() {
  // Netlify Blobs stores are provisioned automatically; no bucket creation is required.
}
