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

test('the sponsored project is a campaign card, not a banner', () => {
  assert.match(feed, /data-testid="advert-progress"/)
  assert.match(feed, /% funded/)
  assert.match(feed, /Sponsor.*Project|Sponsored · Project/)
  assert.match(feed, /Support this project/)
  assert.match(home, /<AdvertCard advert=\{p\} onOpen=\{\(\) => setTab\('give'\)\} \/>/)
})
