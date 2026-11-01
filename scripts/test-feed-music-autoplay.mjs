import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')
const media = await readFile(new URL('../src/components/FeedMediaPreview.tsx', import.meta.url), 'utf8')
const inline = await readFile(new URL('../src/lib/inlineMediaAudio.ts', import.meta.url), 'utf8')

test('feed music autoplay covers video posts too (no manual-play skip)', () => {
  assert.doesNotMatch(feed, /if \(p\.video\) return/)
})

test('scroll-into-view (ratio >= 0.6) arms autoPlay + inline music', () => {
  assert.match(feed, /entry\.isIntersecting && entry\.intersectionRatio >= 0\.6/)
  assert.match(feed, /setAutoPlayVideo\(true\)/)
  assert.match(feed, /setAutoPlayVideo\(false\)/)
  assert.match(feed, /audioAutoplayReady\(\)/)
})

test('video posts with soundtrack render FeedMediaPreview with autoPlay', () => {
  assert.match(feed, /<FeedMediaPreview src=\{p\.video\} poster=\{p\.img\} autoPlay=\{autoPlayVideo\} \/>/)
})

test('media stage plays when autoPlay flips on, returns to poster when off', () => {
  assert.match(media, /autoPlay\?: boolean/)
  assert.match(media, /if \(autoPlay\) \{ setVideoFailed\(false\); setPlaying\(true\) \} else \{ setPlaying\(false\) \}/)
})

test('inline media play marks the app-level audio unlocked', () => {
  assert.match(inline, /markAudioUnlocked\(\)/)
})
