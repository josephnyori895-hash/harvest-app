import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const libMedia = await readFile(new URL('../workers/src/lib/media.js', import.meta.url), 'utf8')
const media = await readFile(new URL('../workers/src/routes/media.js', import.meta.url), 'utf8')

test('chat attachments use a dedicated chat media type (never story)', () => {
  assert.match(chat, /type: 'chat'/)
  assert.doesNotMatch(chat, /presign', \{ method: 'POST', body: JSON\.stringify\(\{ type: 'story'/)
})

test('media lib admits chat type in keys, sizes and content-types', () => {
  assert.match(libMedia, /KEY_RE = .*chat/)
  assert.match(libMedia, /chat: \['image\/jpeg', 'image\/png', 'image\/webp', 'image\/heic'\]/)
  assert.match(libMedia, /chat: 10 \* 1024 \* 1024/)
  assert.match(libMedia, /'track', 'chat', 'sermon_audio'/)
})

test('media routes allow chat for unverified members and refuse confirm', () => {
  const gates = media.match(/type !== 'story' && type !== 'avatar' && type !== 'chat'/g) || []
  assert.ok(gates.length >= 2, 'presign + upload gates must admit chat')
  assert.match(media, /chat attachments are referenced directly by chat messages/)
})

test('KEY_RE is not duplicated divergently (routes re-declare it — both must list chat)', () => {
  const keyRe = /originals\\\/\(avatar\|post\|story\|reel\|track[^=]*?sermon_audio\|sermon_video\)/
  assert.ok(media.match(keyRe) && media.match(keyRe)[0].includes('chat'))
})
