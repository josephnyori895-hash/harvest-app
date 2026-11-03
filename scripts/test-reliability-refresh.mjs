// Regression tests: reliability group 1 (refresh + failed-attachment).
// Covers RS-101/RS-102/RS-103-listener/RS-104/RS-120-122 from docs/BUG-REGISTER.md.
// Contract tests: the source must wire the produce→consume seam on both ends.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const bu = await readFile(new URL('../src/lib/backgroundUploads.ts', import.meta.url), 'utf8')
const home = await readFile(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const reels = await readFile(new URL('../src/components/Reels.tsx', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('1. background post/reel upload dispatches harvest:feed-updated (producer side)', () => {
  assert.match(bu, /task\.kind === 'post' \|\| task\.kind === 'reel'\) window\.dispatchEvent\(new Event\('harvest:feed-updated'\)\)/)
})

test('2. background sermon upload dispatches harvest:sermons-updated', () => {
  assert.match(bu, /task\.kind === 'sermon_audio' \|\| task\.kind === 'sermon_video'\) window\.dispatchEvent\(new Event\('harvest:sermons-updated'\)\)/)
})

test('3. Home consumes harvest:feed-updated → feed refetch', () => {
  assert.match(home, /addEventListener\('harvest:feed-updated' as any, bumpFeed\)/)
  assert.match(home, /const bumpFeed = \(\) => setFeedTick\(x => x \+ 1\)/)
  assert.match(home, /harvest:feed-updated' as any, bumpFeed\)/)
})

test('4. Home refetches feed when signed URLs may have expired on tab return', () => {
  assert.match(home, /visibilitychange'[\s\S]{0,40}onVis\)/)
  assert.match(home, /Date\.now\(\) - lastFeedFetchRef\.current < 540_000/)
  assert.match(home, /lastFeedFetchRef\.current = Date\.now\(\)/, 'ref-timestamp must be recorded on fetch completion AND failure')
  assert.match(home, /\.catch\(\(e: any\) => \{[\s\S]*?lastFeedFetchRef\.current = Date\.now\(\)[\s\S]*?\}\)/)
})

test('5. Reels consumes harvest:feed-updated → reels refetch', () => {
  assert.match(reels, /addEventListener\('harvest:feed-updated' as any, bump\)/)
  assert.match(reels, /setReelsLoadKey\(x => x \+ 1\)/)
  assert.match(reels, /\}, \[useServer, reelsLoadKey\]\)/)
})

test('6. Sermons consumes harvest:sermons-updated → list refetch', () => {
  assert.match(sermons, /addEventListener\('harvest:sermons-updated' as any, bump\)/)
  // Silent refetch: an upload landing must never blank the list the member is
  // already reading (see test-group2-upload for the same contract).
  assert.match(sermons, /const bump = \(\) => \{ void load\(true, \{ limit: PAGE \}\) \}/)
  assert.match(sermons, /\}, \[load\]\)/)
})

test('7. Chat send registers the pending file for retry before the transfer starts', () => {
  assert.match(chat, /if \(attach\) failedFileRef\.current = \{ tempId, file: attach \}/)
})

test('8. Chat clears the retry file on every success path', () => {
  assert.match(chat, /failedFileRef\.current = null/)
  assert.ok((chat.match(/failedFileRef\.current = null/g) || []).length >= 2, 'REST and socket success paths both clear the ref')
})

test('9. Chat retry resends with the preserved file — never a bare text placeholder', () => {
  assert.match(chat, /void send\(body, file, `chat_/)
  assert.match(chat, /const send = async \(bodyOverride\?: string, fileOverride\?: File \| null, idempotencyKey\?: string\) =>/)
  assert.match(chat, /const attach = fileOverride !== undefined \? fileOverride : attachRef\.current/)
})

test('10. Chat flags a lost attachment instead of silently converting to text', () => {
  assert.match(chat, /message\.media_type && !file/)
  assert.match(chat, /The attachment was lost when the message failed — please attach it again\./)
})
