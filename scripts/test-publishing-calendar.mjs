import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [migration, route, calendar, admin, sermons, uploads, feed, sermonRoute, home, deps] = await Promise.all([
  read('workers/migrations/0036_publishing_calendar.sql'),
  read('workers/src/routes/publishing.js'),
  read('src/components/PublishingCalendar.tsx'),
  read('src/components/Admin.tsx'),
  read('src/components/Sermons.tsx'),
  read('src/lib/backgroundUploads.ts'),
  read('workers/src/routes/feed.js'),
  read('workers/src/routes/sermons.js'),
  read('src/components/Home.tsx'),
  read('src/components/Departments.tsx'),
])

test('one publication record covers every required content type and state', () => {
  for (const type of ['announcement', 'sermon', 'banner', 'event', 'ministry_update', 'feed_post']) {
    assert.match(migration, new RegExp(`'${type}'`), `${type} must be a publication type`)
  }
  for (const state of ['draft', 'scheduled', 'published', 'expired', 'canceled']) {
    assert.match(migration, new RegExp(`'${state}'`), `${state} must be a publication state`)
  }
  assert.match(migration, /target_id TEXT NOT NULL/)
  assert.match(migration, /source_key TEXT UNIQUE/, 'sermon uploads are idempotent by media key')
  assert.match(migration, /ALTER TABLE posts ADD COLUMN expires_at/)
  assert.match(migration, /ALTER TABLE sermons ADD COLUMN expires_at/)
})

test('scheduled content is published into existing records, not duplicates', () => {
  assert.match(route, /INSERT OR IGNORE INTO posts/)
  assert.match(route, /INSERT OR IGNORE INTO sermons/)
  assert.match(route, /ON CONFLICT\(key\) DO UPDATE SET value=excluded.value/)
  assert.match(route, /INSERT OR IGNORE INTO events/)
  assert.match(route, /INSERT OR IGNORE INTO ministry_updates/)
  assert.match(route, /target_id: pub\.target_id \|\| uuid\(\)/, 'the target id is stable across retries')
  assert.match(route, /status='published'[\s\S]{0,220}AND status IN \('draft','scheduled'\)/, 'publishing claims the record once')
})

test('missed schedules and expiries are swept without waiting for a page load', () => {
  assert.match(route, /status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= \?/)
  assert.match(route, /status='published' AND expires_at IS NOT NULL AND expires_at <= \?/)
  assert.match(route, /runPublishingSweep/)
  assert.match(route, /UPDATE posts SET expires_at=\? WHERE id=\?/)
  assert.match(route, /UPDATE sermons SET expires_at=\? WHERE id=\?/)
  assert.match(route, /UPDATE events SET expires_at=\? WHERE id=\?/)
  assert.match(route, /UPDATE ministry_updates SET expires_at=\? WHERE id=\?/)
  assert.match(route, /expireBanner/)
  assert.match(route, /no newer banner publication is still live/)
})

test('calendar exposes publish, edit, cancel, preview and history in Nairobi time', () => {
  assert.match(calendar, /Publishing calendar/)
  assert.match(calendar, /Publish at \(Nairobi\)/)
  assert.match(calendar, /\/api\/admin\/publishing/)
  assert.match(calendar, /\/publish/)
  assert.match(calendar, /\/cancel/)
  assert.match(calendar, /\/history/)
  assert.match(calendar, /publication-preview/)
  assert.match(calendar, /Confirm cancel/)
  assert.match(calendar, /formatNairobi/)
  assert.match(admin, /PublishingCalendar/)
  assert.match(admin, /\['publishing', 'Schedule'\]/)
})

test('the calendar is ordered by when each item actually went out', () => {
  assert.match(calendar, /function postedAt\(p: Publication\)/, 'one shared timestamp helper keeps order, grouping and labels consistent')
  assert.match(calendar, /if \(p\.status === 'published'\) return p\.published_at \|\| p\.scheduled_at \|\| p\.created_at/, 'published items must rank by published_at, not the earlier schedule slot')
  assert.match(calendar, /if \(p\.status === 'expired'\) return p\.expired_at/, 'expired items rank by when they expired')
  assert.match(calendar, /if \(p\.status === 'canceled'\) return p\.canceled_at/, 'canceled items rank by when they were canceled')
  assert.doesNotMatch(calendar, /Date\.parse\(a\.scheduled_at \|\| a\.published_at/, 'the old schedule-first sort must not return')
  assert.match(calendar, /const stamp = postedAt\(p\)/, 'day groupings must use the same posted time as the ordering')
  assert.match(calendar, /const when = postedAt\(p\)/, 'the card must show the time it went out')
  assert.match(route, /WHEN 'published' THEN published_at[\s\S]{0,220}ELSE scheduled_at/, 'the server query must order the same way before its 300-row limit')
})

test('Nairobi conversion never uses the browser’s local timezone', async () => {
  const helper = await read('src/lib/nairobiTime.ts')
  assert.match(helper, /Africa\/Nairobi/)
  assert.match(helper, /\+03:00/)
})

test('sermon uploads can be scheduled and edited from the calendar', () => {
  assert.match(sermons, /Publish at \(Nairobi\)/)
  assert.match(sermons, /scheduled_at: scheduledAt/)
  assert.match(sermons, /Schedule sermon/)
  assert.match(uploads, /scheduled_at\?: string/)
  assert.match(uploads, /scheduled_at: task\.scheduled_at/)
  assert.match(route, /createSermonPublication/)
  assert.match(route, /source_key/)
})

test('published posts, sermons and events respect expiry', () => {
  assert.match(feed, /p\.expires_at IS NULL OR p\.expires_at > \?/)
  assert.match(sermonRoute, /s\.expires_at IS NULL OR s\.expires_at > \?/)
  assert.match(route, /events[\s\S]{0,400}expires_at IS NULL OR expires_at > \?/)
  assert.match(home, /\/api\/events/)
  assert.match(deps, /\/updates/)
})
