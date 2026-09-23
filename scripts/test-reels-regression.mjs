import assert from 'node:assert/strict'
import fs from 'node:fs'

const reels = fs.readFileSync('src/components/Reels.tsx', 'utf8')
const feed = fs.readFileSync('workers/src/routes/feed.js', 'utf8')

assert.match(reels, /bg-gradient-to-t from-black\/72 via-black\/28 to-transparent/)
assert.match(reels, /h-40 sm:h-44/)
assert.match(reels, /h-11 w-11/)
assert.match(reels, /loadingMoreReels/)
assert.match(reels, /r\.hasMore \?\? mapped\.length >= 20/)
assert.match(reels, /onPointerUp=\{onVideoTap\}/)
assert.match(reels, /setPaused\(true\)/)
assert.doesNotMatch(reels, /onClick=\{onVideoTap\}/)
assert.match(reels, /await uploadToMinio\(preD\.url/)
assert.doesNotMatch(reels, /onClick=\{\(\) => setMuted\(false\)\}/)
assert.doesNotMatch(reels, /Harvest Videos/)
assert.doesNotMatch(reels, /Community life/)

assert.match(feed, /hasMore: rows\.length === limit/)
assert.match(feed, /music: r\.music_track_id/)
assert.match(feed, /cover_thumb_key/)

console.log('Reels regression checks: PASS')

assert.match(reels, /Save video/)
assert.match(reels, /More actions/)
assert.match(reels, /saved\[key\]/)

assert.match(reels, /\/api\/reels\/\\${encodeURIComponent\(String\(cur\.id\)\)}\/save/)
assert.match(reels, /Saved Videos/)
