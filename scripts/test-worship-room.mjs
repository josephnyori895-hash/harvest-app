// Daily listening is a product promise, not decoration: one tap must never
// dead-end, the app must remember where the member stopped, and the shelf must
// be different tomorrow. These guards fail CI if any of that quietly regresses.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const player = await readFile(new URL('../src/lib/audioPlayer.ts', import.meta.url), 'utf8')
const music = await readFile(new URL('../src/components/Music.tsx', import.meta.url), 'utf8')
const bar = await readFile(new URL('../src/components/NowPlayingBar.tsx', import.meta.url), 'utf8')
const feed = await readFile(new URL('../src/components/FeedCard.tsx', import.meta.url), 'utf8')
const home = await readFile(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const art = await readFile(new URL('../src/components/TrackArt.tsx', import.meta.url), 'utf8')
const uploads = await readFile(new URL('../src/lib/backgroundUploads.ts', import.meta.url), 'utf8')
const composer = await readFile(new URL('../src/components/PostCreate.tsx', import.meta.url), 'utf8')
const admin = await readFile(new URL('../src/components/Admin.tsx', import.meta.url), 'utf8')
const contentRoute = await readFile(new URL('../workers/src/routes/content.js', import.meta.url), 'utf8')
const feedRoute = await readFile(new URL('../workers/src/routes/feed.js', import.meta.url), 'utf8')

test('worship plays as a queue that advances on its own', () => {
  assert.match(player, /export async function playFromQueue\(tracks: PlayerTrack\[\], startIndex = 0\)/)
  assert.match(player, /export async function nextTrack\(\)/)
  assert.match(player, /export async function previousTrack\(\)/)
  // 'ended' advances the queue instead of stopping dead.
  assert.match(player, /audio\.addEventListener\('ended'[\s\S]*?void nextTrack\(\)/)
  assert.match(player, /repeatOne/)
})

test('the app remembers where the member stopped', () => {
  assert.match(player, /const LAST_KEY = 'harvest_last_played'/)
  assert.match(player, /export function getLastPlayed\(\)/)
  assert.match(music, /data-testid="continue-listening"/)
  assert.match(music, /seekTo\(last\.position\)/, 'resume must restore the saved position, not start over')
})

test("today's rotation is date-seeded and playable in one tap", () => {
  assert.match(music, /function seededShuffle<T>\(items: T\[\], seed: number, take: number\): T\[\]/)
  assert.match(music, /const daySeed = Math\.floor\(Date\.now\(\) \/ 86400000\)/)
  assert.match(music, /data-testid="todays-worship"/)
  assert.match(music, /playShelf\(todaysWorship\)/)
  // Play-all goes through the queue, never a one-off playTrack.
  assert.match(music, /playFromQueue\(tracks\.map\(toPlayer\), startIndex\)/)
})

test('the now-playing bar is queue-aware on every screen', () => {
  assert.match(bar, /previousTrack/)
  assert.match(bar, /nextTrack/)
  assert.match(bar, /player\.hasNext/)
  assert.match(bar, /player\.hasPrev/)
  // The bar renders once in App, above the bottom nav.
  assert.match(player, /hasNext\?: boolean/)
})

test('every track surface renders artwork, even without a cover', () => {
  // One shared tile: uploaded cover when present, deterministic generated art
  // otherwise — never a bare grey box or a missing thumbnail.
  assert.match(art, /export default function TrackArt/)
  assert.match(art, /data-generated-artwork/)
  assert.match(art, /linear-gradient\(135deg, hsl\(\$\{hue\} 42% 34%\)/)
  for (const [name, file] of [['music', music], ['now-playing bar', bar], ['feed disc', feed], ['composer', composer]]) {
    assert.match(file, /TrackArt/, `${name} must use TrackArt`)
  }
  // Covers are downscaled before upload, so the stored thumbnail is a thumbnail.
  assert.match(uploads, /async function coverThumbnail\(file: File \| Blob, max = 720, quality = 0\.85\): Promise<File \| Blob>/)
  assert.match(uploads, /const cover = await coverThumbnail\(task\.cover\)/)
})

test('the sponsored project is a campaign card, not a banner', () => {
  // Dark campaign card: one number, a thin gold progress line, one action.
  assert.match(feed, /data-testid="advert-progress"/)
  assert.match(feed, /Harvest project/)
  assert.match(feed, /rounded-full bg-gold text-2xs font-extrabold text-ink/)
  assert.match(feed, /Take part <Icon name="arrow-right"/)
  // A project advert offers both: join this goal, or go find another one.
  assert.match(feed, /export function AdvertCard\(\{ advert, onOpen, onBrowseProjects \}/)
  assert.match(feed, /Take up another project/)
  assert.match(home, /onBrowseProjects=\{\(\) => setTab\('give'\)\}/)
  // Partner adverts are image-forward with their own single CTA.
  assert.match(feed, /Harvest partner/)
  assert.match(feed, /Learn more <Icon name="arrow-right"/)
  assert.match(feed, /aria-label="Sponsored"|>Sponsored</)
  assert.match(home, /<AdvertCard advert=\{p\} onOpen=\{\(\) => setTab\('give'\)\} onBrowseProjects=\{\(\) => setTab\('give'\)\} \/>/)
  // The feed's "Church projects" shelf must delegate to the same campaign card
  // instead of keeping its own light tile with a chip and a tiny bar.
  assert.match(home, /advert=\{\{\s*\n\s*\.\.\.p,\s*\n\s*kind: 'advert',/)
  assert.doesNotMatch(home, /Sponsored · Church project/, 'the bespoke project tile must be gone')
  assert.doesNotMatch(home, /Ends \$\{timeAgo\(project\.deadline\)\}/, 'deadlines are dates, not relative timestamps')
})

test('adverts can use an uploaded photo, stored as a key and signed at render', () => {
  // Admin composer: pick a photo from the device, upload it, append the advert.
  assert.match(admin, /data-testid="advert-photo-composer"/)
  assert.match(admin, /const pre = await presign\(\{/)
  assert.match(admin, /await uploadToMinio\(pre\.url, pre\.fields, photo\)/)
  assert.match(admin, /image_key: res\.data/)
  assert.match(admin, /accept="image\/\*"/)
  // The server accepts the key and the feed signs a fresh URL per render.
  assert.match(contentRoute, /image_key/)
  assert.match(contentRoute, /is not a valid uploaded media key/)
  assert.match(feedRoute, /ad\.image_url \|\| \(ad\.image_key \? await mediaUrlOrNull\(env, ad\.image_key, 6 \* 3600\) : null\)/)
})
