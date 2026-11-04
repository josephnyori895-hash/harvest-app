import assert from 'node:assert/strict'
import {
  isStagedUpload, newStagedUploadId, hasStorageCredentials, stageChunk, listStagedChunks,
  completeStagedChunks, abortStagedChunks, purgeStaleStagedChunks, STAGED_CHUNK_PREFIX,
} from '../src/lib/media.js'

// FixedLengthStream is a Workers runtime primitive; Node has no equivalent that
// enforces the byte count, so a TransformStream stands in for the stream shape.
if (typeof globalThis.FixedLengthStream === 'undefined') {
  globalThis.FixedLengthStream = class FixedLengthStream {
    constructor(size) {
      this.size = size
      const ts = new TransformStream()
      this.readable = ts.readable
      this.writable = ts.writable
    }
  }
}

// In-memory stand-in for the R2 binding. `put` accepts the same value shapes the
// Worker uses: a typed array (a staged part) and a ReadableStream (the join).
function fakeBucket() {
  const objects = new Map()
  const meta = new Map()
  return {
    objects,
    meta,
    async put(key, value, opts = {}) {
      const bytes = value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : new Uint8Array(value)
      objects.set(key, bytes)
      meta.set(key, { ...opts, uploaded: new Date() })
      return { key, size: bytes.byteLength }
    },
    async get(key) {
      const bytes = objects.get(key)
      if (!bytes) return null
      return { body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }), size: bytes.byteLength }
    },
    async head(key) {
      const bytes = objects.get(key)
      return bytes ? { key, size: bytes.byteLength, customMetadata: meta.get(key)?.customMetadata, httpMetadata: meta.get(key)?.httpMetadata } : null
    },
    async list({ prefix = '', cursor } = {}) {
      const all = [...objects.keys()].filter(k => k.startsWith(prefix)).sort()
      const from = cursor ? Number(cursor) : 0
      const page = all.slice(from, from + 2)
      return {
        objects: page.map(k => ({ key: k, size: objects.get(k).byteLength, uploaded: meta.get(k)?.uploaded })),
        truncated: from + page.length < all.length,
        cursor: String(from + page.length),
      }
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) { objects.delete(key); meta.delete(key) }
      return { deleted: Array.isArray(keys) ? keys.length : 1 }
    },
  }
}

const unconfigured = { MEDIA: fakeBucket() }
const configured = { MEDIA: fakeBucket(), CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }

// ── backend selection ──────────────────────────────────────────────────────
assert.equal(hasStorageCredentials(unconfigured), false)
assert.equal(hasStorageCredentials(configured), true)
const uploadId = newStagedUploadId()
assert.match(uploadId, /^st_[0-9a-f]{32}$/)
assert.equal(isStagedUpload(uploadId), true)
assert.equal(isStagedUpload('bucket-upload-id-123'), false)

const env = unconfigured
const key = 'originals/sermon_video/2026/11/abc123def456.mp4'
const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 7, 8, 9])]

// ── staging ────────────────────────────────────────────────────────────────
for (let i = 0; i < parts.length; i++) {
  const { etag } = await stageChunk(env, { uploadId, partNumber: i + 1, body: parts[i].buffer })
  assert.equal(etag, `staged-${parts[i].byteLength}`, 'a staged part reports its size as its etag')
}

const listed = await listStagedChunks(env, uploadId)
assert.deepEqual(listed.map(p => p.partNumber), [1, 2, 3], 'parts list in part order, not key order')
assert.deepEqual(listed.map(p => p.size), [3, 2, 4])
// Keys are zero-padded so part 10 never sorts before part 9.
assert.ok(listed[0].key.startsWith(`${STAGED_CHUNK_PREFIX}${uploadId}/`))
assert.match(listed[0].key, /\/000001$/)

// ── completion joins the parts into the object the app reads ────────────────
const done = await completeStagedChunks(env, { key, uploadId, contentType: 'video/mp4', ownerId: 'user-1' })
assert.deepEqual([...env.MEDIA.objects.get(key)], [1, 2, 3, 4, 5, 6, 7, 8, 9], 'assembled bytes are the parts in order')
assert.equal(done.size, 9)
const head = await env.MEDIA.head(key)
assert.equal(head.size, 9, 'stored object carries the full sermon size')
assert.equal(head.httpMetadata.contentType, 'video/mp4')
assert.equal(head.customMetadata.ownerId, 'user-1', 'owner metadata survives, so /confirm can prove ownership')
assert.equal((await listStagedChunks(env, uploadId)).length, 0, 'temp parts are released once joined')

// ── a gap in the sequence is refused, not silently truncated ───────────────
const gapId = newStagedUploadId()
await stageChunk(env, { uploadId: gapId, partNumber: 1, body: new Uint8Array([1]).buffer })
await stageChunk(env, { uploadId: gapId, partNumber: 3, body: new Uint8Array([3]).buffer })
await assert.rejects(
  () => completeStagedChunks(env, { key: 'originals/sermon_video/2026/11/gap.mp4', uploadId: gapId, contentType: 'video/mp4', ownerId: 'user-1' }),
  /chunk 2 is missing/,
)
assert.equal(env.MEDIA.objects.has('originals/sermon_video/2026/11/gap.mp4'), false, 'nothing is published from a partial upload')
assert.equal((await listStagedChunks(env, gapId)).length, 2, 'parts survive a failed join, so a retry resumes')

// ── abort and stale cleanup ────────────────────────────────────────────────
await abortStagedChunks(env, gapId)
assert.equal((await listStagedChunks(env, gapId)).length, 0)

const fresh = newStagedUploadId()
const stale = newStagedUploadId()
await stageChunk(env, { uploadId: fresh, partNumber: 1, body: new Uint8Array([9]).buffer })
await stageChunk(env, { uploadId: stale, partNumber: 1, body: new Uint8Array([9]).buffer })
// Age one session by two days, exactly what a killed app leaves behind.
const staleKey = [...env.MEDIA.objects.keys()].find(k => k.includes(stale))
env.MEDIA.meta.get(staleKey).uploaded = new Date(Date.now() - 48 * 3600_000)
const purged = await purgeStaleStagedChunks(env)
assert.equal(purged, 1, 'abandoned parts are collected')
assert.equal((await listStagedChunks(env, stale)).length, 0)
assert.equal((await listStagedChunks(env, fresh)).length, 1, 'an upload still in flight is untouched')

console.log('Media staged-chunk upload contract tests passed.')
