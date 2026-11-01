import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')
const inline = await readFile(new URL('../src/lib/inlineMediaAudio.ts', import.meta.url), 'utf8')

test('feed music autoplay covers video posts too (no manual-play skip)', () => {
  assert.doesNotMatch(feed, /if \(p\.video\) return/)
})

test('inline media play marks the app-level audio unlocked', () => {
  assert.match(inline, /markAudioUnlocked\(\)/)
})
