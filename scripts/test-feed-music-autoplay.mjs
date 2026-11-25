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

test('1. a song post becoming visible never starts audio on its own', () => {
  assert.match(feed, /if \(musicEligible\) void startFeedPlayback\(p\)/)
  assert.match(playback, /if \(!postId \|\| !url \|\| !armed\.has\(postId\)\) return false/)
  assert.doesNotMatch(playback, /getFeedAutoplayPref|audioAutoplayReady/)
})

test('2. tapping the on-post music control arms and starts that post', () => {
  assert.match(feed, /startManualFeedPlayback\(p\)/)
  assert.match(playback, /export async function startManualFeedPlayback/)
  assert.match(playback, /armed\.add\(postId\)/)
})

test('3. scrolling away pauses the song', () => {
  assert.match(feed, /if \(musicEligible\) stopFeedPlayback\(p\)/)
  assert.match(playback, /export function stopFeedPlayback/)
})

test('4. scrolling back resumes an armed post at its saved position', () => {
  assert.match(playback, /const armed = new Set<string>\(\)/)
  assert.match(inline, /resumeAt\.set\(previousId, previous\.currentTime \|\| 0\)/)
  assert.match(inline, /const at = resumeAt\.get\(id\)/)
})

test('5. pausing a post disarms only that post, not every song in the feed', () => {
  assert.match(feed, /pauseManualFeedPlayback\(p\)/)
  assert.match(playback, /armed\.delete\(postId\)/)
  assert.doesNotMatch(feed, /setFeedAutoplayPref/)
})

test('6. a browser that refuses playback shows a retry state, not a dead control', () => {
  assert.match(feed, /music\.failed \? `Retry /)
  assert.match(feed, /<Icon name="alert"/)
  assert.match(inline, /await audio\.play\(\)/)
})

test('7. music title and artist sit below the username, never over the media', () => {
  assert.match(feed, /data-music-control/)
  assert.match(feed, /<span className="truncate">\{p\.music\?\.title \|\| 'Original audio'\}<\/span>/)
  assert.match(feed, /p\.music\?\.artist && <span className="truncate font-semibold text-ink-subtle">· \{p\.music\.artist\}<\/span>/)
  assert.doesNotMatch(feed, /<MusicControl|data-music-disc/)
  assert.doesNotMatch(feed, /absolute[^\n]*data-music-control/, 'the track row is not an overlay on the post')
})

test('8. only one feed track plays; worship has priority unless the member taps', () => {
  assert.match(playback, /stopFeedPlayback\(\)/)
  assert.match(playback, /activePostId = ok \? postId : null/)
  assert.match(playback, /if \(isGlobalPlayerPlaying\(\)\) return false/)
  assert.match(playback, /if \(isGlobalPlayerPlaying\(\)\) pausePlayer\(\)/)
})

test('9. worship and sermons still take over from feed audio', () => {
  assert.match(music, /stopFeedPlayback/)
  assert.match(sermons, /stopFeedPlayback/)
})

test('10. leaving the app pauses feed audio', () => {
  assert.match(playback, /visibilitychange/)
  assert.match(playback, /pagehide/)
})

test('11. videos keep their muted-safe viewport autoplay', () => {
  assert.match(feed, /if \(p\.video\) setAutoPlayVideo\(true\)/)
  assert.match(media, /if \(autoPlay\) \{ setVideoFailed\(false\); setPlaying\(true\) \}/)
})

test('12. the global player still exposes playing state for priority checks', () => {
  assert.match(player, /isGlobalPlayerPlaying/)
})
