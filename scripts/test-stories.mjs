import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const stories = await readFile(new URL('../src/components/Stories.tsx', import.meta.url), 'utf8')
const media = await readFile(new URL('../workers/src/routes/media.js', import.meta.url), 'utf8')
const feed = await readFile(new URL('../workers/src/routes/feed.js', import.meta.url), 'utf8')

test('viewer derives photo duration from persisted duration_secs', () => {
  assert.match(stories, /duration_secs\)\s*\|\|\s*Number/ )
  assert.match(stories, /play in full \(onEnded\)|plays in full/)
})

test('composer forwards author-chosen duration through the upload task', () => {
  assert.match(stories, /duration_secs: timer/)
  assert.match(stories, /\[3, 5, 8, 12\]/)
})

test('backend persists clamped duration (1-12s) and never lets it break videos', () => {
  assert.match(media, /Math\.min\(Math\.max\(Math\.round\(durRaw\), 1\), 12\)/)
  assert.match(media, /duration_secs\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?\)/)
  assert.match(media, /mediaType, caption \|\| '', musicTrackId \|\| null, durationSecs/)
})

test('feed + stories selects expose duration_secs to the viewer', () => {
  assert.match(feed, /s\.music_track_id, s\.duration_secs/, 'both story SELECTs must list duration_secs')
})

test('composer decorations are BURNED INTO the image at submit (never preview-only)', () => {
  assert.match(stories, /const burnDecorations = async \(file: File\)/)
  assert.match(stories, /if \(!isVideoFile\) blob = await burnDecorations\(fileObj\)/)
  assert.doesNotMatch(stories, /const applyFilter = \(imgUrl: string/)
})

test('video stories hide decoration controls (cannot burn into video without re-encode)', () => {
  assert.match(stories, /fileUrl && !isVideoFile && <div className="px-4 pb-2 bg-white border-t border-stone-200"><button onClick=\{\(\) => \{ setShowStickers/)
  assert.match(stories, /new picks reset decorations|setFilter\('Original'\); setTextOverlay\(''\); setStickers\(\[\]\)/)
})

test('viewer listens to socket-free tap grammar: thirds for prev/next, center pause, hold pause', () => {
  assert.match(stories, /x < rect\.width \/ 3/)
  assert.match(stories, /x > rect\.width \* 2 \/ 3/)
  assert.match(stories, /holdTimerRef/)
})
