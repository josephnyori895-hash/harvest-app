import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const rt = await readFile(new URL('../workers/src/realtime.js', import.meta.url), 'utf8')

test('chat send rides the realtime DO with REST fallback for media', () => {
  assert.match(chat, /emitSocket\('chat:send'/)
  assert.match(chat, /emitSocket\('group:join', \{ slug: team\.slug \}\)/)
  assert.match(chat, /emitSocket\('chat:join', \{ peer/)
  assert.match(chat, /if \(ackRes && ackRes\.ok\)/)
  assert.match(chat, /if \(!attach\)/)
})

test('chat incoming messages render through the realtime frame', () => {
  assert.match(chat, /onSocket\('chat:message'/)
  assert.match(chat, /ck !== conversationKey/)
  assert.match(chat, /setMsgs\(c => \{/)
})

test('DO handles chat:send (text) and fans out chat:message', () => {
  assert.match(rt, /case 'chat:send'/)
  assert.match(rt, /event: 'chat:message'/)
})
