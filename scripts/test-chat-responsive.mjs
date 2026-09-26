import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('chat rows keep names, verified badges, and unread indicators stable at narrow widths', () => {
  assert.match(chat, /className="flex min-w-0 items-center gap-1\.5"/)
  assert.match(chat, /<span className="truncate">\{c\.peer_name\}<\/span>/)
  assert.match(chat, /\{c\.peer_verified && <VerifiedBadge \/>\}/)
  assert.match(chat, /shrink-0 text-\[10px\]/)
})

test('People list prevents long names from pushing the verified badge or unread indicator', () => {
  assert.match(chat, /className="flex min-w-0 items-center gap-1\.5 font-semibold/)
  assert.match(chat, /<span className="truncate">\{u\.name \|\| u\.username\}<\/span>/)
  assert.match(chat, /\{u\.verified && <VerifiedBadge \/>\}/)
})

test('verified badge is a fixed-size non-shrinking inline control', () => {
  assert.match(chat, /inline-flex shrink-0 items-center justify-center/)
  assert.match(chat, /h-\[18px\] w-\[18px\]/)
  assert.match(chat, /h-5 w-5 text-\[12px\]/)
})
