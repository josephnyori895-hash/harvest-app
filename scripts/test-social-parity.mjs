// Pins the Instagram-parity pass: tagging people and adding a location to a
// post, and voice notes, forwarding, unsending and searching inside a chat.
//
// Structural contracts against the shipped source. The server assertions make
// sure the metadata the composer sends has a column to land in and a
// notification path for the tagged member — the two halves that silently drift
// apart if only the UI is changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8')

const postCreate = read('src', 'components', 'PostCreate.tsx')
const feedCard = read('src', 'components', 'FeedCard.tsx')
const home = read('src', 'components', 'Home.tsx')
const chat = read('src', 'components', 'Chat.tsx')
const reels = read('src', 'components', 'Reels.tsx')
const uploads = read('src', 'lib', 'backgroundUploads.ts')
const mediaRoute = read('workers', 'src', 'routes', 'media.js')
const feedRoute = read('workers', 'src', 'routes', 'feed.js')
const pendingRoute = read('workers', 'src', 'routes', 'pending.js')
const chatRoute = read('workers', 'src', 'routes', 'chat.js')
const tagLib = read('workers', 'src', 'lib', 'postTags.js')
const migration = read('workers', 'migrations', '0045_post_meta.sql')

test('a photo post can tag people and carry a location', () => {
  assert.match(postCreate, /data-testid="create-post-extras"/)
  assert.match(postCreate, /Tag people/)
  assert.match(postCreate, /Add location/)
  assert.match(postCreate, /data-testid="create-tagged-list"/)
  assert.match(postCreate, /tagged_users: type === 'post' && tagged\.length \? tagged\.map\(t => t\.username\) : undefined/)
  assert.match(postCreate, /location: type === 'post' \? location\.trim\(\) \|\| undefined : undefined/)
  assert.match(postCreate, /\$\{API\}\/api\/users/, 'the tag sheet searches the member directory')
})

test('the composer carries both extras through the background upload to confirm', () => {
  assert.match(uploads, /location\?: string/)
  assert.match(uploads, /tagged_users\?: string\[\]/)
  assert.match(uploads, /location: task\.location/)
  assert.match(uploads, /tagged_users: task\.tagged_users/)
})

test('storage and approval keep the extras and notify the named members', () => {
  assert.match(migration, /ALTER TABLE posts ADD COLUMN location TEXT/)
  assert.match(migration, /ALTER TABLE posts ADD COLUMN tagged_users TEXT/)
  assert.match(migration, /ALTER TABLE pending_queue ADD COLUMN tagged_users TEXT/)
  assert.match(mediaRoute, /normaliseLocation\(body\.location\)/)
  assert.match(mediaRoute, /normaliseTagged\(body\.tagged_users\)/)
  assert.match(mediaRoute, /notifyPostTags\(env, fresh, \{[^}]*kind: 'post'/)
  assert.match(pendingRoute, /item\.location \|\| null, item\.tagged_users \|\| null/)
  assert.match(tagLib, /type: 'mention'/)
  assert.match(tagLib, /@\(\[a-z0-9\._-\]\{2,32\}\)/i, 'caption @mentions are collected too')
})

test('the feed returns and renders the location and tags', () => {
  assert.match(feedRoute, /p\.location, p\.tagged_users/)
  assert.match(feedRoute, /location: r\.location \|\| null/)
  assert.match(feedRoute, /tagged,/)
  assert.match(home, /loc: p\.location \|\|/)
  assert.match(home, /tagged: Array\.isArray\(p\.tagged\)/)
  assert.match(feedCard, /data-testid="feed-tagged"/)
  assert.match(feedCard, /\[#@\]\(\[\\p\{L\}\\p\{N\}_\.\]\+\)/u, 'caption mentions are highlighted like hashtags')
})

test('chat voice notes record, upload as audio and play in the bubble', () => {
  assert.match(chat, /VOICE_MIME_TYPES/)
  assert.match(chat, /new MediaRecorder/)
  assert.match(chat, /getUserMedia\(\{ audio: true \}\)/)
  assert.match(chat, /function ChatAudio/)
  assert.match(chat, /media_type === 'audio' && m\.media_key/)
  assert.match(chat, /media_type: media_key \? attachKind : undefined/)
  assert.match(chatRoute, /function mediaPlaceholder/)
  assert.match(chatRoute, /🎤 Voice message/)
})

test('reels are a vertical snap pager, one video per page', () => {
  assert.match(reels, /snap-y snap-mandatory/)
  assert.match(reels, /data-testid="reels-pager"/)
  assert.match(reels, /Math\.round\(el\.scrollTop \/ el\.clientHeight\)/, 'the visible page decides the active reel')
  assert.match(reels, /idxFromScroll\.current/, 'a user scroll must not fight a programmatic one')
  assert.match(reels, /data-reel-index=\{i\}/)
  assert.doesNotMatch(reels, /onTouchEnd=\{onTouchEnd\}/, 'custom swipe thresholds are replaced by native snap scrolling')
})

test('a reel caption expands and its progress bar scrubs', () => {
  assert.match(reels, /setCapExpanded/)
  assert.match(reels, /role="slider"/)
  assert.match(reels, /data-seek/)
  assert.match(reels, /v\.currentTime = ratio \* v\.duration/)
})

test('chat can forward, unsend and search inside the conversation', () => {
  assert.match(chat, /const forwardMessage = async/)
  assert.match(chat, /title="Forward to"/)
  assert.match(chat, /Unsend/)
  assert.match(chatRoute, /you can only unsend your own messages/)
  assert.match(chatRoute, /const isSender = String\(m\.rows\[0\]\.sender_username/)
  assert.match(chat, /Search this conversation/)
  assert.match(chat, /const displayThread = searchNeedle/)
})
