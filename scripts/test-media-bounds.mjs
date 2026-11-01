import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../src/components/FeedMediaPreview.tsx', import.meta.url), 'utf8')

test('media bounds: portrait floor is 9:16 (0.5625), ceiling 1.91', () => {
  assert.match(feed, /const MIN_RATIO = 0\.5625/)
  assert.match(feed, /const MAX_RATIO = 1\.91/)
  assert.match(feed, /const clampRatio = \(ratio: number\) => Math\.min\(Math\.max\(ratio, MIN_RATIO\), MAX_RATIO\)/)
})

test('media stage honours the bounded ratio (no silent crop below portrait floor)', () => {
  assert.ok(feed.includes('aspectRatio: String(boundedRatio)'))
  assert.ok(feed.includes('width: `min(100%, ${Math.round(boundedRatio * 70)}vh)`'))
  assert.ok(feed.includes('object-contain'))
})
