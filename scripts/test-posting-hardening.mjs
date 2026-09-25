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

// Retried confirm calls must not create duplicate DB records.
assert.match(media, /this upload has already been submitted/)
assert.match(media, /SELECT 1 AS found FROM pending_queue WHERE original_key=\?/)
assert.match(media, /SELECT 1 AS found FROM reels WHERE hls_master_key=\?/)
assert.match(media, /SELECT 1 AS found FROM tracks WHERE original_key=\?/)

// Composer must provide a review step and enforce the same caption limit in
// the UI before handing work to the background uploader.
assert.match(postCreate, /Final preview/)
assert.match(postCreate, /maxLength=\{2000\}/)
assert.match(postCreate, /caption\.trim\(\)\.length > 2000/)
assert.match(postCreate, /startBackgroundUpload/)

// Background transfer must honor the presigned HTTP method and carry signed
// fields as headers for direct R2 uploads.
assert.match(uploads, /const method = String\(presign\.method/)
assert.match(uploads, /directHeaders/)
assert.match(uploads, /direct \? file : form/)

console.log('Posting hardening contract tests passed.')
