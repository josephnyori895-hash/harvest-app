import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')

test('chat rows keep names, verified badges, and unread indicators stable at narrow widths', () => {
  // Inbox row: the name is inside a truncating paragraph so it can never push the
  // badge or timestamp out of the row at narrow widths.
  assert.match(chat, /text-\[15px\] font-extrabold truncate/)
  assert.match(chat, /\{c\.peer_name\}\{c\.peer_verified && <VerifiedBadge \/>\}/)
  // Timestamp is a fixed-position, non-shrinking inline control.
  assert.match(chat, /ml-2 shrink-0 text-2xs/)
  assert.match(chat, /<UnreadBadge count=\{unread\} \/>/)
})

test('People list prevents long names from pushing the verified badge or unread indicator', () => {
  assert.match(chat, /className="flex min-w-0 items-center gap-1\.5 text-\[15px\] font-semibold text-ink"/)
  assert.match(chat, /<span className="truncate">\{u\.name \|\| u\.username\}<\/span>/)
  assert.match(chat, /\{u\.verified && <VerifiedBadge \/>\}/)
})

test('the verified badge is one fixed-size control that cannot shrink or wrap', async () => {
  const badge = await readFile(new URL('../src/components/VerifiedBadge.tsx', import.meta.url), 'utf8')
  // Chat must use the shared seal. A local copy is how this app ended up with
  // two different verification marks, and the copy is what this guard used to
  // pin — the copy is gone, so the guard now pins the shared component.
  assert.match(chat, /import \{ VerifiedBadge \} from '\.\/VerifiedBadge'/)
  assert.doesNotMatch(chat, /function VerifiedBadge/, 'a local badge copy would drift from the rest of the app')
  // Fixed box, and it refuses to shrink inside a long, truncating row.
  assert.match(badge, /width=\{size\}/)
  assert.match(badge, /height=\{size\}/)
  assert.match(badge, /shrink-0/)
})

// The screen used to be built on Instagram's dark palette while every other
// screen was token-based, so it rendered as a black slab. Colour must now come
// from the token layer only, and dark mode stays a variable swap.
test('chat draws colour from design tokens, not a hardcoded dark palette', () => {
  // (A translucent bg-white/15 inside an accent bubble is fine; a solid
  // bg-white surface is what made the screen look pasted-on.)
  for (const legacy of [/bg-stone-\d/, /text-stone-\d/, /border-stone-\d/, /bg-black\b/, /bg-white['"\s]/, /from-purple-6\d\d/, /to-fuchsia-6\d\d/]) {
    assert.doesNotMatch(chat, legacy, `legacy palette class leaked back in: ${legacy}`)
  }
  assert.match(chat, /bg-surface/, 'screen must paint the surface token')
  assert.match(chat, /bg-surface-raised/, 'cards and own chrome must use the raised surface')
  assert.match(chat, /bg-accent text-white/, 'the send action and own bubbles use the accent token')
})

test('chat respects the 12px type floor and uses the icon set instead of emoji chrome', () => {
  assert.doesNotMatch(chat, /text-\[(9|10|11)px\]/, 'nothing below 12px ships')
  for (const glyph of ['⚙️', '💬', '👥', '⛪', '🏛', '☆', '★', '⌕', '✕', '↩', '⧉', '🗑']) {
    assert.ok(!chat.includes(glyph), `emoji/glyph chrome should be an <Icon>, found: ${glyph}`)
  }
  // '📷' survives only as the stored text sentinel for a photo-only message
  // (wire format); it must never be rendered as a JSX child.
  assert.doesNotMatch(chat, />📷/, 'photo placeholder must render as an <Icon>')
})
