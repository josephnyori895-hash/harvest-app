// Group 2A regression tests — upload reliability (RS-102 / RS-103 / RS-121).
// Source-contract layer; runtime browser repro accompanies this gate.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const post = await readFile(new URL('../src/components/PostCreate.tsx', import.meta.url), 'utf8')
const bu = await readFile(new URL('../src/lib/backgroundUploads.ts', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('1. PostCreate closes the composer at hand-off and never waits on the upload', () => {
  // RS-102, ruling 2026-11-04: the earlier contract kept the composer open until
  // the manager settled. That froze the composer across the whole retry ladder
  // (15s -> 10m, five attempts) with no progress in view, and a task restored
  // from IndexedDB after a restart has no promise to settle at all. The contract
  // is now: hand off, say what is happening, close, and let the manager's own
  // surfaces report failure.
  assert.doesNotMatch(post, /\.then\(\(\) => onDone\(\)\)/, 'no coupling to the upload promise')
  const idx = post.indexOf('void startBackgroundUpload({')
  assert.ok(idx > -1, 'the transfer goes to the background manager')
  const after = post.slice(idx, idx + 2600)
  assert.ok(after.includes('onDone()'), 'the composer closes at hand-off')
  assert.ok(!/\.then\(/.test(after.slice(0, after.indexOf('onDone()'))), 'nothing is awaited before the close')
  assert.ok(after.includes('Uploading \u2014 we will tell you if it fails'), 'closing must not imply the post is live')
  // The failure path still has an owner: the manager toasts and records it.
  assert.match(bu, /failed \u2014 tap Retry to try again/, 'terminal failure is reported by the manager')
  assert.match(bu, /void pushHistory\(\{ id, label: rec\.label, status: \'failed\'/, 'terminal failure lands in upload history')
})

test('2. Background manager promise resolves on success / rejects on terminal failure, stays pending while waiting', () => {
  assert.match(bu, /type DeferredHandle = \{ promise: Promise<void>; resolve: \(\) => void; reject: \(e: Error\) => void \}/)
  assert.match(bu, /const getDeferred = \(id: string\): DeferredHandle => \{/)
  assert.match(bu, /const deferred = getDeferred\(id\)/)
  assert.match(bu, /deferred\.resolve\(\)/)
  assert.match(bu, /deferred\.reject\(new Error\(detail\)\)/)
  // Waiting branch must not settle the task promise.
  const waitingBlock = bu.slice(bu.indexOf("if (rec.attempts < MAX_ATTEMPTS && isRetryable(e))"), bu.indexOf("const detail = String"))
  assert.ok(!/deferred\./.test(waitingBlock), 'waiting must not settle the task promise')
})

test('3. Sermons upload migrated to shared background manager with metadata preserved', () => {
  assert.match(sermons, /void startBackgroundUpload\(\{/)
  assert.ok(!/const pres = await fetch\(API \+ '\/api\/media\/presign'/.test(sermons), 'inline presign must be gone')
  assert.match(sermons, /kind,\s*\n?\s*file: uploadFile,/)
  assert.match(sermons, /title: uploadTitle/)
  assert.match(sermons, /artist: uploadSpeaker/)
  assert.match(sermons, /scripture: uploadScripture/)
  assert.match(sermons, /description: uploadDescription/)
})

test('3b. a finished background upload refreshes the list without blanking it', () => {
  assert.match(sermons, /window\.addEventListener\('harvest:sermons-updated' as any, bump\)/)
  assert.match(sermons, /const bump = \(\) => \{ void load\(true, \{ limit: PAGE \}\) \}/)
})

test('4. Chat presign carries an idempotency key (RS-121)', () => {
  assert.match(chat, /idempotencyKey: idempotencyKey \|\| `chat_\$\{tempId\}`/)
})
