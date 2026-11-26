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

test('1. a song post scrolling into view starts its attached music', () => {
  assert.match(feed, /if \(musicEligible\) void startFeedPlayback\(p\)/)
  assert.match(playback, /if \(!postId \|\| !url\) return false/)
  assert.match(playback, /if \(!getFeedAutoplayPref\(\)\) return false/, 'the member mute must still be respected')
  assert.match(playback, /await startInlineMediaTrack\(\{ id: postId, url \}\)/, 'the visible card starts its own track')
})

test('2. tapping the on-post music control starts and re-enables autoplay', () => {
  assert.match(feed, /startManualFeedPlayback\(p\)/)
  assert.match(playback, /export async function startManualFeedPlayback/)
  assert.match(playback, /setFeedAutoplayPref\(true\)/)
})

test('3. scrolling away pauses the song', () => {
  assert.match(feed, /if \(musicEligible\) stopFeedPlayback\(p\)/)
  assert.match(playback, /export function stopFeedPlayback/)
})

test('4. scrolling back resumes the track at its saved position', () => {
  assert.match(playback, /if \(activePostId === postId && isInlinePlaying\(postId\)\) return true/)
  assert.match(inline, /resumeAt\.set\(previousId, previous\.currentTime \|\| 0\)/)
  assert.match(inline, /const at = resumeAt\.get\(id\)/)
})

test('5. the music control is a persistent mute, not a one-post pause', () => {
  assert.match(feed, /pauseManualFeedPlayback\(p\)/)
  assert.match(playback, /setFeedAutoplayPref\(false\)/)
  assert.doesNotMatch(playback, /armed/)
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

test('13. a blocked first play starts muted and the first gesture unmutes it', () => {
  // Chrome/Safari refuse audible autoplay before a gesture. The feed must not
  // go silent for the session: start muted (always allowed), then unmute on the
  // first tap/keypress instead of waiting for the disc to be tapped.
  assert.match(inline, /audio\.muted = true/)
  assert.match(inline, /export function unmuteInlineMediaAudio/)
  assert.match(playback, /unmuteInlineMediaAudio\(\)/)
  assert.match(playback, /export function retryPendingFeedPlayback/)
  assert.match(playback, /addEventListener\(type, retryPendingFeedPlayback, \{ passive: true \}\)/)
})

test('14. a post taller than the viewport still counts as focused', () => {
  assert.match(feed, /entry\.boundingClientRect\.height > \(window\.innerHeight \|\| 0\) \* 0\.9/)
  assert.match(feed, /tall && entry\.intersectionRatio >= 0\.35/)
})
