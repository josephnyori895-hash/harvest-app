// Guard: feed media must read as part of the post, never as an image inside a
// frame. Two regressions are pinned here — a stage narrower than the post
// (card surface showing either side) and a letterbox band in any colour.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const video = await readFile(new URL('../src/components/FeedMediaPreview.tsx', import.meta.url), 'utf8')
const card = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')

test('media bounds: photos keep the 4:5 floor, video keeps its natural 9:16 shape, 1.91 ceiling', () => {
  // A 9:16 recording clamped to the 4:5 photo floor was cropped top and bottom
  // in the feed — the vertical-video defect from audit item B.
  assert.match(video, /const MIN_VIDEO_RATIO = 9 \/ 16/)
  assert.match(video, /const MAX_RATIO = 1\.91/)
  assert.match(video, /const clampRatio = \(ratio: number\) => Math\.min\(Math\.max\(ratio, MIN_VIDEO_RATIO\), MAX_RATIO\)/)
  assert.match(card, /Math\.min\(Math\.max\(ratio, 0\.8\), 1\.91\)/, 'photo portrait floor stays 4:5')
})

test('portrait video is not re-cropped by the stage height cap', () => {
  // The ratio fix is worthless if a 70vh clamp trims the frame afterwards:
  // portrait stages must allow the taller natural shape.
  assert.match(video, /const stageMaxHeight = \(ratio: number \| null\) => \(ratio && ratio < 1 \? '88vh' : '70vh'\)/)
  assert.ok(video.includes('maxHeight: stageMaxHeight(boundedRatio)'), 'the stage applies the portrait cap')
  assert.ok(!/max-h-\[70vh\]/.test(video), 'no leftover fixed 70vh clamp on media children')
})

test('the video stage spans the full post width and honours the bounded ratio', () => {
  assert.ok(video.includes('aspectRatio: String(boundedRatio)'))
  assert.ok(video.includes("width: '100%'"), 'stage must span the post width')
  assert.ok(!video.includes('mx-auto'), 'a centred stage is how the frame gap returns')
})

test('photos and videos both fill the stage (crop, never letterbox)', () => {
  assert.ok(card.includes('object-cover'), 'photos fill the post and crop the excess')
  assert.ok(video.includes('object-cover'), 'videos fill the post and crop the excess')
  assert.ok(!video.includes('object-contain'), 'object-contain is a letterbox band by definition')
  assert.ok(!video.includes('bg-ink'), 'no dark band defining the media edge')
})

test('media never letterboxes against the post surface (the white-frame regression)', () => {
  assert.ok(!video.includes('min(100%,'), 'stage width must not be vh-capped')
  assert.ok(!card.includes('min(100%,'), 'photo width must not be vh-capped')
  assert.ok(video.includes('bg-surface-sunken'), 'idle backdrop is the same surface family as the post')
})

test('the post itself is chromeless: no card border, radius or shadow', () => {
  const article = card.slice(card.indexOf('export default function FeedCard'))
  assert.ok(article.includes('className="bg-surface"'), 'article carries no frame')
  assert.ok(!/rounded-card[^>]*shadow/.test(article), 'the post is not a floating card')
})

test('the action row is icon-only and monochrome', () => {
  const actions = card.slice(card.indexOf('actions — icon only'), card.indexOf('text stack — count'))
  assert.ok(!/WhatsApp<\//.test(actions), 'no text label inside the WhatsApp control')
  assert.ok(!/text-(green|purple|gold)-\d00/.test(actions), 'colours are not used to decorate buttons')
  assert.ok(actions.includes('fill-current text-danger'), 'the only colour is the liked heart')
})
