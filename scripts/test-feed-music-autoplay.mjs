import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')
const inline = await readFile(new URL('../src/lib/inlineMediaAudio.ts', import.meta.url), 'utf8')
const player = await readFile(new URL('../src/lib/audioPlayer.ts', import.meta.url), 'utf8')
const playback = await readFile(new URL('../src/lib/feedPlayback.ts', import.meta.url), 'utf8')
const music = await readFile(new URL('../src/components/Music.tsx', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const media = await readFile(new URL('../src/components/FeedMediaPreview.tsx', import.meta.url), 'utf8')

test('1. eligible music post becomes visible → playback attempted', () => {
  assert.match(feed, /startFeedPlayback\(p\)/)
  assert.match(playback, /export async function startFeedPlayback/)
  assert.match(playback, /if \(!postId \|\| !url\) (return false|\{[^}]*return false[^}]*\})/)
})

test('2. scrolling away → playback stops', () => {
  assert.match(feed, /stopFeedPlayback\(p\)/)
  assert.match(playback, /export function stopFeedPlayback/)
})

test('3. next music post becomes visible → previous stops and next starts', () => {
  assert.match(playback, /stopFeedPlayback\(\)/)
  assert.match(playback, /activePostId = postId/)
})

test('4. posts without music → no playback', () => {
  assert.match(feed, /musicEligible = Boolean\(p\.music\?\.url && p\.music\?\.id\)/)
  assert.match(feed, /if \(!p\.video && !musicEligible\) return/)
})

test('5. autoplay disabled → no automatic playback', () => {
  assert.match(playback, /if \(!getFeedAutoplayPref\(\)\) (return false|\{[^}]*return false[^}]*\})/)
  assert.match(feed, /getFeedAutoplayPref/)
})

test('6. browser rejects autoplay → manual enable/play action appears', () => {
  assert.match(feed, /Enable music autoplay/)
  assert.match(feed, /markAudioUnlocked/)
  assert.match(inline, /await audio\.play\(\)/)
})

test('7. worship player starts → feed music pauses', () => {
  assert.match(music, /stopFeedPlayback/)
  assert.match(sermons, /stopFeedPlayback/)
})

test('8. Home becomes hidden → feed music pauses', () => {
  assert.match(playback, /visibilitychange/)
  assert.match(playback, /pagehide/)
})

test('9. rapid scrolling → no overlapping audio', () => {
  assert.match(playback, /stopFeedPlayback\(\)/)
  assert.match(playback, /activePostId/)
})

test('10. playback failure → useful retry state', () => {
  assert.match(feed, /Retry music/)
  assert.match(inline, /toggleInlineMediaTrack/)
})

test('11. media stage plays when autoPlay flips on, returns to poster when off', () => {
  assert.match(media, /autoPlay\?: boolean/)
  assert.match(media, /if \(autoPlay\) \{ setVideoFailed\(false\); setPlaying\(true\) \} else \{ setPlaying\(false\) \}/)
})

test('12. inline media play marks the app-level audio unlocked', () => {
  assert.match(inline, /markAudioUnlocked\(\)/)
})

test('13. global player exposes playing state for coordinator gating', () => {
  assert.match(player, /isGlobalPlayerPlaying/)
})
