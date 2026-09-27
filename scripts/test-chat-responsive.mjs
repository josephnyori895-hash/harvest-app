import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('chat rows keep names, verified badges, and unread indicators stable at narrow widths', () => {
  // Inbox row: the name is inside a truncating paragraph so it can never push the
  // badge or timestamp out of the row at narrow widths.
  assert.match(chat, /text-\[15px\] truncate/)
  assert.match(chat, /\{c\.peer_name\}\{c\.peer_verified && <VerifiedBadge \/>\}/)
  // Timestamp is a fixed-position, non-shrinking inline control.
  assert.match(chat, /ml-2 shrink-0 text-\[10px\]/)
  assert.match(chat, /<UnreadBadge count=\{unread\} \/>/)
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
