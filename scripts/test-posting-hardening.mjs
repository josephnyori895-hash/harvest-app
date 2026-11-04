import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const media = await readFile(new URL('../workers/src/routes/media.js', import.meta.url), 'utf8')
const postCreate = await readFile(new URL('../src/components/PostCreate.tsx', import.meta.url), 'utf8')
const uploads = await readFile(new URL('../src/lib/backgroundUploads.ts', import.meta.url), 'utf8')

// Confirm must verify the uploaded original belongs to the caller before it can
// become a post/reel/story/track/sermon.
assert.match(media, /media does not belong to this account/)
assert.match(media, /const ownerId = String\(obj\.customMetadata\?\.ownerId/)
assert.match(media, /if \(ownerId !== String\(fresh\.id\) && fresh\.role !== 'admin'\)/)

// Reel posters must be validated before both direct publication and moderation
// queueing. A malformed, missing, or foreign poster must never be attached.
assert.match(media, /validatedPosterKey/)
assert.match(media, /poster does not belong to this account/)
assert.match(media, /type === 'reel' \? validatedPosterKey : null/)

// Retried confirm calls must not create duplicate DB records: the shared
// lookup finds any prior registration and returns the ORIGINAL result.
assert.match(media, /findRegisteredUpload/)
assert.match(media, /SELECT id, status, created_at FROM pending_queue WHERE original_key=\?/)
assert.match(media, /SELECT id FROM reels WHERE hls_master_key=\?/)
assert.match(media, /SELECT id FROM tracks WHERE original_key=\?/)

// Composer must provide a review step and enforce the same caption limit in
// the UI before handing work to the background uploader. The review step is the
// live canvas itself (media + caption + music on one screen) — the old separate
// "Final preview" modal duplicated it and was removed.
assert.match(postCreate, /aspectRatio: \(type === 'post' && imgRatio\)/, 'photo posts preview at their natural feed ratio')
assert.match(postCreate, /stageRatio\(type\)/, 'stories and reels keep the 9:16 canvas')
assert.doesNotMatch(postCreate, /Final preview/, 'no duplicate preview modal')
assert.match(postCreate, /maxLength=\{2000\}/)
assert.match(postCreate, /caption\.trim\(\)\.length > 2000/)
assert.match(postCreate, /startBackgroundUpload/)

// Edge-to-edge guarantee: the photo/video stage never letterboxes — media
// covers its canvas exactly the way the feed crops it (zoom-to-fill, never
// object-contain with cream/black bars around it). The sermon audio stage's
// inline video preview is out of scope: it is a small embedded control, not
// the canvas the member reviews before sharing.
assert.match(postCreate, /alt="Selected media preview"/)
assert.ok(!/Selected media preview"\n?\s*className="[^"]*object-contain/.test(postCreate), 'the composer stage must not letterbox media')
assert.match(postCreate, /h-full w-full object-cover/)

// Background transfer must honor the presigned HTTP method and carry signed
// fields as headers for direct R2 uploads.
assert.match(uploads, /String\(presign\.method \|\| 'POST'\)/, 'presigned method is honored for form uploads')
assert.match(uploads, /xhrSend\(String\(presign\.url\), 'PUT', file, headers/, 'direct R2 uploads keep their signed headers')
assert.match(uploads, /up = await xhrSend\(`\$\{API\}\$\{presign\.url\}`/, 'non-direct presigns still post to the Worker path')

// Anything past one chunk goes through the Worker, which is what stopped the
// single long PUT that died as an opaque XHR "network error" on mobile.
assert.match(uploads, /if \(file\.size > CHUNK_THRESHOLD\) \{\s*\n\s*try \{\s*\n\s*return await uploadChunked\(/, 'big transfers are chunked')
// A server without multipart credentials must not refuse what its proxy can
// still carry — chunk-start 501 falls through to the presign path.
assert.ok(/credentials are not configured/i.test(uploads), 'chunk-501 falls back to the presign path for proxy-sized files')

// Binding-backed staged chunks: without S3 keys on the server the multipart
// session runs on the R2 binding itself, so big sermons still land.
const mediaLib = await readFile('workers/src/lib/media.js', 'utf8')
assert.ok(mediaLib.includes('STAGED_CHUNK_PREFIX'), 'staged-chunk backend exists for credential-free servers')
assert.match(mediaLib, /isStagedUpload/, 'staged sessions are identified by their upload id')
assert.ok(mediaLib.includes('FixedLengthStream'), 'staged joins stream part by part, not into memory')
assert.match(mediaLib, /purgeStaleStagedChunks/, 'abandoned staged parts are garbage-collected')
assert.ok((await readFile('workers/src/routes/pending.js', 'utf8')).includes('purgeStaleStagedChunks'), 'the cron cleanup actually calls the purge')
assert.match(uploads, /api\/media\/multipart\/part/, 'chunks are posted to the Worker')
assert.match(uploads, /api\/media\/multipart\/status/, 'a retry asks which parts already landed')
assert.match(uploads, /api\/media\/multipart\/complete/, 'parts are joined server-side')
assert.match(uploads, /if \(state\.done\[String\(n\)\]\)/, 'stored parts are skipped on resume')
assert.match(uploads, /up = await xhrSend\(`\$\{API\}\/api\/media\/upload`, 'POST', form/, 'an unreachable R2 falls back to the same-origin proxy')

console.log('Posting hardening contract tests passed.')
