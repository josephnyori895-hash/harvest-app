import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')
const stories = await readFile(new URL('../src/components/Stories.tsx', import.meta.url), 'utf8')
const music = await readFile(new URL('../src/components/Music.tsx', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const inline = await readFile(new URL('../src/lib/inlineMediaAudio.ts', import.meta.url), 'utf8')

// Attached-media music (feed chip + stories) must live on the shared inline
// channel — the Worship Room global player stays separate for real worship.
test('feed music chip uses the shared inline-audio channel', () => {
  assert.match(feed, /toggleInlineMediaTrack/)
  assert.match(feed, /stopInlineMediaAudio/)
  assert.match(feed, /subscribeInlineMediaAudio/)
  assert.match(feed, /isInlinePlaying/)
  assert.doesNotMatch(feed, /playTrack|pausePlayer|isPlayingId/)
})

test('story viewer and composer preview use the shared inline-audio channel', () => {
  assert.match(stories, /toggleInlineMediaTrack/)
  assert.match(stories, /stopInlineMediaAudio/)
  assert.doesNotMatch(stories, /playTrack|pausePlayer/)
})

test('worship room player remains on the global player (separate channel)', () => {
  assert.match(music, /playTrack/)
  assert.match(sermons, /playTrack/)
})

test('inline audio channel exposes playing-state helper', () => {
  assert.match(inline, /isInlinePlaying/)
})
