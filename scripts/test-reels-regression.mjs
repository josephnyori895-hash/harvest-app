import assert from 'node:assert/strict'
import fs from 'node:fs'

const reels = fs.readFileSync('src/components/Reels.tsx', 'utf8')
const app = fs.readFileSync('src/App.jsx', 'utf8')
const feed = fs.readFileSync('workers/src/routes/feed.js', 'utf8')

assert.match(reels, /bg-gradient-to-t from-black\/72 via-black\/28 to-transparent/)
assert.match(reels, /h-40 sm:h-44/) 
// Visual usability: poster/video should fill the available reel viewport without distortion,
// while the text overlay stays confined to the lower caption-safe area.
assert.match(reels, /max-w-full max-h-full w-auto h-auto object-contain/)
assert.match(reels, /poster=\{!posterFailed \? \(cur\.img \|\| generatedPoster \|\| undefined\) : \(generatedPoster \|\| undefined\)\}/)
assert.match(reels, /transition-opacity duration-200 \$\{videoReady \? 'opacity-100' : 'opacity-0'\}/)
assert.match(reels, /h-40 sm:h-44 bg-gradient-to-t from-black\/72 via-black\/28 to-transparent pointer-events-none/)
assert.match(reels, /left-4 right-20 bottom-4 sm:left-6 sm:right-24 sm:bottom-5 z-10/)
assert.match(reels, /max-w-\[min\(36rem,calc\(100vw-7rem\)\)\]/)
assert.match(reels, /line-clamp-2/)
assert.match(reels, /right-3 sm:right-5 bottom-5 sm:bottom-7 z-10 flex w-12 flex-col/)
assert.match(reels, /h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black\/25 backdrop-blur-sm/)
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

assert.match(app, /Search creator or caption/)
assert.match(app, /7 days/)
assert.match(app, /30 days/)
assert.match(app, /saved_at/)
