// Comments are one store with a scope per commentable kind. These checks pin
// the wiring: every kind is addressable, the counter always lands on the table
// that owns the row, and the sermons screen can page past the first page while
// showing the true library size.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feed = await readFile(new URL('../workers/src/routes/feed.js', import.meta.url), 'utf8')
const comments = await readFile(new URL('../src/components/Comments.tsx', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const sermonRoute = await readFile(new URL('../workers/src/routes/sermons.js', import.meta.url), 'utf8')
const migration = await readFile(new URL('../workers/migrations/0032_sermon_comments.sql', import.meta.url), 'utf8')

test('one comment store serves posts, reels and sermons', () => {
  assert.match(feed, /sermon: \{ missing: 'sermon not found', table: 'sermons', sql: 'SELECT id, user_id FROM sermons WHERE id=\?' \}/)
  assert.match(feed, /const commentScope = raw => \(raw === 'reel' \|\| raw === 'sermon' \? raw : 'post'\)/)
  assert.match(feed, /SELECT id, user_id FROM posts WHERE id=\? AND approved_at IS NOT NULL/)
  assert.match(feed, /SELECT id, user_id FROM reels WHERE id=\? AND approved_at IS NOT NULL/)
})

test('counters follow the kind instead of defaulting to posts', () => {
  assert.match(feed, /const col = COMMENT_TARGETS\[scope\]\.table/)
  assert.match(feed, /UPDATE \$\{col\} SET comments = comments \+ 1 WHERE id=\?/)
  assert.match(feed, /UPDATE \$\{col\} SET comments = MAX\(comments - \?, 0\) WHERE id=\?/)
  // The like routes legitimately keep a two-table pick (posts|reels only), so
  // the "no ad-hoc picks" rule applies to the comments section alone.
  const commentsBlock = feed.slice(feed.indexOf('const COMMENT_TARGETS'), feed.indexOf('Story views'))
  assert.ok(!/scope === 'reel' \? 'reels' : 'posts'/.test(commentsBlock), 'no ad-hoc table picks left in the comment routes')
})

test('sermon comments are reachable from the sheet and from a sermon row', () => {
  assert.match(comments, /scope: 'post' \| 'reel' \| 'sermon'/)
  assert.match(sermons, /scope="sermon"/)
  assert.match(sermons, /<Comments/)
  assert.match(sermons, /bumpComments\(String\(commentTarget\.id\), delta\)/)
})

test('the sermons list is paged and reports the real total', () => {
  assert.match(sermonRoute, /LIMIT \? OFFSET \?/)
  assert.match(sermonRoute, /SELECT COUNT\(\*\) AS total FROM sermons/)
  assert.match(sermonRoute, /return jsonResponse\(\{ sermons: out, total, hasMore:/)
  assert.match(sermonRoute, /s\.comments/)
  // ASCII-only probes: the button label uses a middot that must not become part
  // of the contract.
  assert.match(sermons, /\{total - sermons\.length\} to go/)
  assert.match(sermons, /sermons\.length >= total/)
  assert.match(sermons, /offset: sermons\.length, limit: PAGE/)
})

test('migration widens the scope check and adds the sermon counter', () => {
  assert.match(migration, /CHECK \(scope IN \('post','reel','sermon'\)\)/)
  assert.match(migration, /ALTER TABLE sermons ADD COLUMN comments INTEGER NOT NULL DEFAULT 0/)
  assert.match(migration, /INSERT INTO post_comments_new[\s\S]*FROM post_comments/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_comments_post/)
})
