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

test('a chat photo opens full screen and can be downloaded', () => {
  assert.match(chat, /function ChatPhoto\(\{ messageId, onOpen \}/, 'the photo bubble must invite a full-screen open')
  assert.match(chat, /aria-label="Open photo full screen"/, 'the thumbnail must be an accessible open control')
  assert.match(chat, /role="dialog"[\s\S]{0,200}aria-label="Photo viewer"/, 'a full-screen viewer dialog must exist')
  assert.match(chat, /downloadPhoto/, 'the viewer must offer a download action')
  assert.match(chat, /link\.download = `harvest-photo-/, 'download must save a named photo file')
  assert.match(chat, /useModalFocus\(Boolean\(photoViewer\)/, 'the viewer must trap focus and close on Escape')
})

test('chat avatars use the same profile picture as the feed', async () => {
  const route = await readFile(new URL('../workers/src/routes/chat.js', import.meta.url), 'utf8')
  assert.match(route, /async function withSenderAvatars/, 'chat history needs one avatar lookup per page')
  assert.match(route, /SELECT username, avatar_key FROM users WHERE username IN/, 'avatar comes from the same users.avatar_key as the feed')
  assert.match(route, /messages: await withSenderAvatars\(env, rows\.reverse\(\)\)/, 'history must attach sender avatars')
  assert.match(route, /messages: await withSenderAvatars\(env, rows\)/, 'live updates must attach sender avatars too')
  assert.match(chat, /m\.avatar_url \? <img src=\{m\.avatar_url\}/, 'team messages show the profile photo, not initials')
})
