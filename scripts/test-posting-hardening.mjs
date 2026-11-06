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

// RS-103: a sermon is the heaviest thing a member uploads, so it must travel
// through the same manager as everything else (progress, queue, retry) and it
// must carry a key derived from the recording — not from the button press — or
// re-picking the file after a give-up publishes a duplicate row.
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
assert.match(sermons, /void startBackgroundUpload\(\{/, 'sermon uploads use the background manager')
assert.match(sermons, /idempotency_key: sermonUploadKey\(uploadFile\)/, 'the sermon key comes from the file')
assert.match(sermons, /const sermonUploadKey = \(file: File\) =>/, 'one helper owns the sermon key')
assert.match(sermons, /hash\.toString\(16\)/, 'the key is hex, so the server sanitiser keeps it whole')
assert.ok(sermons.includes('`${file.name}|${file.size}|${file.lastModified || 0}`'), 'identity spans name, size and mtime')
assert.match(sermons, /retryUpload\(failedSermonUpload\.id\)/, 'a failed sermon is retried from the banner')

// RS-135: the sermon picker advertised MP3/M4A/AAC/WAV/OGG and MP4/MKV/3GP/MOV,
// then gated on an exact MIME string (audio/mpeg, audio/mp3, video/mp4). A phone
// reports an empty or generic type for a chosen recording and labels .m4a as
// audio/mp4, so valid recordings were refused before any transfer started.
// Classification is extension-first, with the MIME family only as a fallback.
assert.match(sermons, /sermonKindOf\(f\) !== uploadKind/, 'the picker classifies the pick instead of matching one MIME')
assert.doesNotMatch(sermons, /f\.type === 'audio\/mpeg'/, 'no exact-MIME gate on audio picks')
assert.doesNotMatch(sermons, /f\.type === 'video\/mp4'/, 'no exact-MIME gate on video picks')
assert.match(uploads, /export function sermonKindOf/, 'one helper owns audio-vs-video classification')
assert.match(uploads, /AUDIO_EXTS\.has\(ext\)/, 'a recognised audio extension decides first')
assert.ok(/export function resolveUploadMime[\s\S]*?reported\.split\('\/'\)\[0\] !== extType\.split\('\/'\)\[0\]/.test(uploads), 'a wrong MIME family is overridden by the extension')
assert.match(postCreate, /sermonKindOf\(f\) === 'video'/, 'the composer uses the same classification')

// RS-136: the worship track path had the same type-gate problem. The admin
// console sent the picker's raw MIME (empty, octet-stream, or video/mp4 for an
// .m4a) straight to presign and then replaced the server's refusal with a
// generic sentence; the worship room's picker offered MIME names only, and its
// size hint claimed a 20 MB ceiling the server does not enforce.
const adminMedia = await readFile(new URL('../src/components/AdminMedia.tsx', import.meta.url), 'utf8')
const music = await readFile(new URL('../src/components/Music.tsx', import.meta.url), 'utf8')
assert.match(uploads, /export function resolveUploadMime/, 'one helper resolves the declared content type')
assert.match(adminMedia, /resolveUploadMime\(file, file\.name\)/, 'the admin console resolves the upload type')
assert.match(adminMedia, /JSON\.parse\(text\)\?\.error/, 'the admin console surfaces the server refusal')
assert.doesNotMatch(adminMedia, /contentType: file\.type/, 'no raw picker MIME is sent to presign')
assert.match(uploads, /if \(!reason\) reason = xmlMessage\(up\.body\)/, 'an R2 XML refusal keeps its message')
assert.match(uploads, /xmlMessage\(text\)/, 'a non-JSON refusal keeps its message at presign')
assert.match(music, /\.m4a,/, 'the worship picker lists extensions, not MIME names only')
assert.doesNotMatch(music, /up to 20 MB/, 'the size hint no longer undercuts the server ceiling')
assert.match(music, /up to 50 MB/, 'the size hint matches the server ceiling')

// RS-102: the composer hands off and closes. It must not wait for the manager
// promise — the retry ladder runs 15s -> 10m across five attempts, and a task
// restored from IndexedDB after a restart has no promise to settle at all — and
// closing must not imply the post is already live.
assert.doesNotMatch(postCreate, /\.then\(\(\) => onDone\(\)\)/, 'the composer must not close on the upload promise')
assert.ok(postCreate.includes("showToast('Uploading \u2014 we will tell you if it fails', 'info', 3000)"), 'hand-off says what is actually happening')
{
  const handOff = postCreate.slice(postCreate.indexOf('void startBackgroundUpload('))
  const closeAt = handOff.indexOf('onDone()')
  assert.ok(closeAt > 0, 'the composer closes at hand-off')
  assert.ok(!/\.then\(/.test(handOff.slice(0, closeAt)), 'nothing is chained before the close')
  assert.ok(closeAt < handOff.indexOf('} else {'), 'onDone is not deferred behind a promise')
}

console.log('Posting hardening contract tests passed.')
