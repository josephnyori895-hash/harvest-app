// Regression tests: chat reliability (RS-130…RS-133).
// The chat screen carried three defects that only show up under real use:
// a refetch loop, an unguarded localStorage write, and permanently cached
// signed media URLs. Each is asserted structurally so it cannot silently come
// back while the component is being restyled.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('RS-130: the history loader does not depend on msgs (no refetch loop)', () => {
  // `msgs` in the deps array re-created loadConversation on every message, and
  // the mount effect depends on it — an endless /api/chat/history loop.
  assert.doesNotMatch(chat, /\[active, team, currentUser, conversationKey, msgs, saveMessages/)
  assert.match(chat, /const msgsRef = useRef\(msgs\)/)
  assert.match(chat, /mergeMessages\(msgsRef\.current\[k\] \|\| \[\], result\.messages \|\| \[\]\)/)
})

test('RS-131: mergeMessages keeps identity when nothing changed', () => {
  assert.match(chat, /if \(!changed\) return current/)
  assert.match(chat, /JSON\.stringify\(prev\) !== JSON\.stringify\(m\)/)
})

test('RS-132: message persistence cannot throw on quota and is bounded', () => {
  assert.match(chat, /function trimMessagesForStorage\(all: Record<string, any\[\]>, perConversation = 60\)/)
  assert.match(chat, /catch \{\s*\n\s*try \{ localStorage\.setItem\('harvest_msgs'/)
  assert.match(chat, /catch \{ \/\* memory-only this session \*\/ \}/)
})

test('RS-133: signed chat media URLs expire and can recover from a failed load', () => {
  assert.match(chat, /const SIGNED_URL_TTL_MS = 8 \* 60 \* 1000/)
  assert.match(chat, /cachedSignedUrl\(messageId\)/)
  assert.match(chat, /onError=\{\(\) => \{ invalidateSignedUrl\(messageId\); setFailed\(true\) \}\}/)
  assert.match(chat, /Photo unavailable — tap to retry/)
})

test('chat sends still route through the realtime path with REST fallback', () => {
  // Guard against a future refactor quietly dropping the socket path.
  assert.match(chat, /emitSocket\('chat:send'/)
  assert.match(chat, /if \(ackRes && ackRes\.ok\)/)
})
