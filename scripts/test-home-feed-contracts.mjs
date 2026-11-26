// Pins the Home feed fixes RS-217–RS-229 (H1–H13).
//
// These are structural contracts against the shipped source, not behaviour
// tests: they cannot prove a phone renders 40 px targets, but they make the
// thirteen defects impossible to reintroduce silently. The one assertion that
// does execute code is H3 — the broken pattern was a regex literal that could
// never match, so the pattern is read out of Home.tsx and run against names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const home = readFileSync(join(here, '..', 'src', 'components', 'Home.tsx'), 'utf8')
const app = readFileSync(join(here, '..', 'src', 'App.jsx'), 'utf8')
const feedCard = readFileSync(join(here, '..', 'src', 'components', 'FeedCard.tsx'), 'utf8')
const api = readFileSync(join(here, '..', 'src', 'lib', 'api.ts'), 'utf8')
const BACKSLASH = String.fromCharCode(92)

test('RS-217 (H1): comment/delete/share scope comes from the raw row kind, not the label', () => {
  assert.ok(home.includes("sourceKind: p.kind === 'reel' ? 'reel' : 'post'"), 'the mapped card must carry the server kind')
  assert.ok(home.includes('onComment={() => setCommentTarget(commenting ? null : { scope: p.sourceKind,'), 'comments must open with the raw kind')
  assert.ok(home.includes('onToggleMenu={() => setMenuPost(menuPost?.key === key ? null : { key, kind: p.sourceKind,'), 'the options sheet must carry the raw kind for delete')
  assert.ok(home.includes('kind: p.sourceKind })'), 'share links must carry the raw kind')
  assert.ok(!home.includes("p.kind === 'Video' || p.kind === 'reel' ? 'reel' : 'post'"), 'the label must never decide scope')
})

test('calendar text posts do not render a fake 4:5 media stage', () => {
  assert.match(feedCard, /\{\(p\.video \|\| p\.img\) && \(/, 'media must render only when the post actually has media')
  assert.doesNotMatch(feedCard, /Photo on its way/, 'a text-only calendar post is not a pending photo')
  assert.doesNotMatch(feedCard, /Image pending review/, 'the feed must not label an absent image as pending review')
})

test('RS-218 (H2): a successful empty page says so and offers the composer', () => {
  assert.ok(home.includes('allUpdates.length === 0 &&'))
  assert.ok(home.includes('No community updates yet'))
  assert.ok(home.includes('When someone shares a post or a video it appears here'))
  assert.ok(home.includes('Share something'), 'the empty state needs a way out, not just an apology')
  assert.ok(home.includes("onClick={() => setTab('post')}"), 'the shortcut must open the composer')
})

test('RS-219 (H3): pastor discovery matches a human name, not a literal backslash', () => {
  const line = home.split('\n').find(l => l.includes('(pastor|pst|rev)') && l.includes('.test('))
  assert.ok(line, 'the pastor discovery filter must exist')
  const start = line.indexOf('/(^|')
  const end = line.indexOf('/i.test(', start)
  assert.ok(start >= 0 && end > start, 'the filter must be one regex literal')
  const patternText = line.slice(start, end + 2)
  assert.ok(!patternText.includes(BACKSLASH + BACKSLASH), 'a doubled backslash matches a literal backslash')
  const pattern = new Function(`return ${patternText}`)()
  for (const name of ['Pastor John', 'Pst Mary', 'Rev. Kim', 'pastor_john']) {
    assert.equal(pattern.test(name), true, `${name} must be discoverable`)
  }
  for (const name of ['Trevor Kimani', 'Sebastian Otieno', 'Pastoral Team']) {
    assert.equal(pattern.test(name), false, `${name} must not be treated as a pastor`)
  }
  assert.ok(line.includes("${String(u.username || '')} ${String(u.name || '')}"), 'username and display name must share the rule')
})

test('RS-220 (H4): a background post merges into the head instead of resetting page one', () => {
  assert.ok(home.includes('const bumpFeed = () => { void mergeHeadRef.current() }'), 'the feed-updated listener must merge, not reset')
  assert.ok(home.includes("addEventListener('harvest:feed-updated' as any, bumpFeed)"))
  assert.ok(home.includes('const fresh: any[] = []'))
  assert.ok(home.includes('else next[at] = { ...next[at], ...p }'), 'rows already on screen must be refreshed in place')
  assert.ok(home.includes('return fresh.length ? [...fresh, ...next] : next'), 'only new rows may be prepended')
})

test('RS-221 (H5): load-more dedupes against what is already mounted', () => {
  assert.ok(home.includes('const seen = new Set(next.map((p: any) => `api_${p.kind}_${p.id}`))'), 'the set must be seeded from prev')
  assert.ok(!home.includes('const seen = new Set<string>()'), 'an empty set only dedupes inside the incoming page')
})

test('RS-222 (H6): API-less builds show a notice, never endless skeletons', () => {
  assert.ok(home.includes('Community updates need the Harvest server'))
  assert.ok(home.includes('Boolean(api) && !feedLoaded && !feedLoadFailed && [0, 1].map'), 'skeletons must be gated on having an API at all')
})

test('RS-223 (H7): a JSON error body reaches the toast as its message', () => {
  assert.ok(api.includes('const parsed = JSON.parse(body)'))
  assert.ok(api.includes("typeof parsed?.error === 'string' && parsed.error"))
  assert.ok(!api.includes('if (body) message = body'), 'the raw body must never be the message')
  assert.ok(api.includes('body.length > 200 ?'), 'an HTML error page is not a sentence')
})

test('Ask for prayer lands in the full Chat screen, not the quick-reply card', () => {
  assert.match(home, /onOpenDm\?\.\(\{ id: String\(pastor\.id\)/, 'the prayer action targets the pastor')
  assert.match(app, /const openFullDm = \(user\) =>/, 'there is a full-chat DM opener')
  assert.match(app, /setDmSheet\(false\)[\s\S]{0,180}?setTab\('chat'\)/, 'the full opener closes the mini card and changes tab')
  assert.match(app, /onOpenDm=\{openFullDm\}/, 'Home is wired to the full-chat opener')
})

test('tapping Home waits for the fresh head before landing on the latest update', () => {
  assert.match(home, /const \[focusArrivedTick, setFocusArrivedTick\]/, 'the explicit-refresh acknowledgement is missing')
  assert.match(home, /if \(homeFocusPendingRef\.current\) setFocusArrivedTick/, 'the pending scroll must wait for the request to finish')
  assert.match(home, /\}, \[feedLoaded, focusArrivedTick\]\)/, 'the scroll must key off the completed refresh, not the old feed')
  assert.match(feedCard, /data-created-at=\{p\.created_at \|\| ''\}/, 'cards expose the timestamp used to find the newest update')
  assert.match(home, /cards\.reduce/, 'the feed is ranked, so the newest card is selected by time, not DOM order')
  assert.match(home, /home\.closest\('\.app-content'\)/, 'scroll the real app column scroller, not the non-scrolling Home root')
  assert.match(app, /if \(tab === 'home'\) return/, 'tab scroll-memory must not restore an old feed position over the Home landing')
  assert.doesNotMatch(home, /const target = c\.querySelector\('\[data-post-id\]'\)/, 'first card is not necessarily the latest')
})

test('RS-224 (H8): pull-to-refresh needs a vertical pull and a closed screen', () => {
  assert.ok(home.includes('const startXRef = useRef<number | null>(null)'))
  assert.ok(home.includes('const overlaysOpen = Boolean('))
  assert.ok(home.includes('if (overlaysOpen) { startYRef.current = null; startXRef.current = null; return }'))
  assert.ok(home.includes('dy > 80 && dx < 40'), 'a diagonal swipe is not a refresh')
})

test('RS-225 (H9): quick chips, Refresh and Retry all meet the 40 px rule', () => {
  assert.ok(home.includes('inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-raised px-3.5'), 'quick-link chips')
  assert.ok(home.includes('disabled={!api} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full'), 'Refresh')
  assert.ok(home.includes('className="inline-flex min-h-11 items-center px-1 text-xs font-bold underline"'), 'the feed error Retry')
  assert.ok(!home.includes('min-h-9 shrink-0'), 'the old 36 px Refresh is gone')
})

test('RS-226 (H10): offline reads as a connection problem, not a server fault', () => {
  assert.ok(home.includes("setFeedFailedOffline(!navigator.onLine || e?.name === 'TypeError')"))
  assert.ok(home.includes("kind={feedFailedOffline ? 'network' : 'error'}"))
  assert.ok(home.includes('You appear to be offline. Reconnect and try again.'))
})

test('RS-227 (H11): relative timestamps age while the screen stays mounted', () => {
  assert.ok(home.includes('setInterval(() => setClockNow(Date.now()), 60_000)'))
  assert.ok(home.includes('return () => window.clearInterval(id)'), 'the ticker must stop on unmount')
  assert.ok(home.includes('[livePosts, clockNow]'), 'the memo must recompute on the tick')
  assert.ok(home.includes('timeAgo(p.created_at, clockNow)'), 'the stamp must use the ticked clock')
})

test('RS-228 (H12): the loading region is busy and announces itself', () => {
  assert.ok(home.includes('aria-busy={Boolean(api) && !feedLoaded && !feedLoadFailed}'))
  assert.ok(home.includes(`role="status" aria-live="polite" className="sr-only">{!api ? 'Community updates are unavailable in this build'`))
})

test('RS-229 (H13): the mounted window is bounded and says when it is full', () => {
  assert.ok(home.includes('const FEED_MAX_LOADED = 120'))
  assert.ok(home.includes('if (next.length >= FEED_MAX_LOADED) break'))
  assert.ok(home.includes('setFeedHasMore(atCap ? false : Boolean(d?.hasMore))'))
  assert.ok(home.includes('Showing the latest {FEED_MAX_LOADED} updates.'))
})

// Multi-photo posts and the camera entry point in the composer.
test('a post can carry several photos', () => {
  const post = readFileSync(join(here, '..', 'src', 'components', 'PostCreate.tsx'), 'utf8')
  const uploads = readFileSync(join(here, '..', 'src', 'lib', 'backgroundUploads.ts'), 'utf8')
  const media = readFileSync(join(here, '..', 'workers', 'src', 'routes', 'media.js'), 'utf8')
  const feed = readFileSync(join(here, '..', 'workers', 'src', 'routes', 'feed.js'), 'utf8')
  const migration = readFileSync(join(here, '..', 'workers', 'migrations', '0042_post_media.sql'), 'utf8')

  assert.match(migration, /ALTER TABLE posts ADD COLUMN media_keys TEXT/, 'album posts need their own column')
  assert.match(media, /mediaKeys\.length > 1 \? JSON\.stringify\(mediaKeys\)/, 'the confirm route must store the album list')
  assert.match(media, /k\.startsWith\('originals\/post\/'\)/, 'only post uploads may join an album')
  assert.match(feed, /p\.media_keys/, 'the feed must select the album list')
  assert.match(feed, /media_urls: mediaUrls/, 'the feed must return signed album URLs')
  assert.match(post, /multiple=\{type === 'post'\}/, 'the picker must allow selecting several photos')
  assert.match(post, /extra_files: type === 'post' && extras\.length/, 'the composer must hand the extra photos to the uploader')
  assert.match(post, /capture="environment"/, 'the composer needs a camera entry point')
  assert.match(post, /data-testid="create-album"/, 'the album strip is missing')
  assert.match(uploads, /extra_files\?: File\[\]/, 'the upload task needs the extra-photo list')
  assert.match(uploads, /media_keys: \[audioKey, \.\.\.extraKeys\]/, 'confirm must carry the album keys')
  assert.match(feedCard, /function FeedAlbum/, 'the feed needs an album carousel')
  assert.match(home, /media: Array\.isArray\(p\.media_urls\)/, 'Home must map the album URLs onto the card')
})
