// src/lib/feedPlayback.ts — central coordinator for feed-attached music.
//
// Feed music behaves like feed video: the post that is mostly on screen plays
// its attached track, scrolling away pauses it, and scrolling back resumes at
// the same position. Only one feed track plays at a time, and the worship
// player owns the audio element exclusively while it is running. The on-post
// control is therefore a mute/unmute, and the choice persists.
import { startInlineMediaTrack, stopInlineMediaAudio, isInlinePlaying, unmuteInlineMediaAudio } from './inlineMediaAudio'
import { getFeedAutoplayPref, setFeedAutoplayPref, isGlobalPlayerPlaying, pausePlayer, markAudioUnlocked } from './audioPlayer'

let activePostId: string | null = null
// The post the browser refused to play before the member touched the page.
// Chrome/Safari block sound-on autoplay until a real gesture; without this the
// feed stayed silent for the whole session because every later scroll reused
// the same blocked element. The first tap/keypress anywhere resumes it.
let pendingPost: any = null

const musicId = (p: any): string | null => {
  const id = p?.music?.id
  return id ? String(id) : null
}

/** Is this post still mostly on screen? A pending track must not start after
 *  its post has been scrolled past while the member was doing something else. */
function postStillVisible(p: any): boolean {
  if (typeof document === 'undefined') return false
  const id = String(p?.id ?? p?.key ?? '')
  if (!id) return true
  const selector = `[data-post-id="${id.replace(/["\\]/g, '')}"]`
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return false
  const rect = el.getBoundingClientRect()
  const viewport = window.innerHeight || 0
  if (!viewport || rect.height <= 0) return false
  const shown = Math.max(0, Math.min(rect.bottom, viewport) - Math.max(rect.top, 0))
  return shown / Math.min(rect.height, viewport) >= 0.5
}

/** Start (or resume) the track for a post that scrolled into view. Browser
 *  autoplay policy may reject the first attempt before any interaction; the
 *  card keeps its tap control and the first gesture retries automatically. */
export async function startFeedPlayback(p: any): Promise<boolean> {
  const postId = musicId(p)
  const url = p?.music?.url
  if (!postId || !url) return false
  if (!getFeedAutoplayPref()) return false
  if (isGlobalPlayerPlaying()) return false
  if (activePostId === postId && isInlinePlaying(postId)) return true
  stopFeedPlayback()
  const ok = await startInlineMediaTrack({ id: postId, url })
  activePostId = ok ? postId : null
  pendingPost = ok ? null : p
  return ok
}

/** A real member tap: start this post and make room if worship is playing.
 *  Tapping also re-enables autoplay after a previous mute. */
export async function startManualFeedPlayback(p: any): Promise<boolean> {
  const postId = musicId(p)
  const url = p?.music?.url
  if (!postId || !url) return false
  setFeedAutoplayPref(true)
  if (isGlobalPlayerPlaying()) pausePlayer()
  stopFeedPlayback()
  const ok = await startInlineMediaTrack({ id: postId, url })
  activePostId = ok ? postId : null
  pendingPost = null
  return ok
}

/** The on-post control is the mute: pausing it keeps the feed quiet as the
 *  member scrolls until they tap a music control again. */
export function pauseManualFeedPlayback(p: any): void {
  setFeedAutoplayPref(false)
  pendingPost = null
  stopFeedPlayback(p)
}

export function stopFeedPlayback(p?: any): void {
  // Scoped stop: a card scrolling out pauses only its own track — whether the
  // coordinator started it or the member tapped it through the inline channel
  // (the channel is the source of truth). A video post passing a playing music
  // post never steals or ends that music.
  if (p && p.music?.id) {
    const id = String(p.music.id)
    if (pendingPost && String(pendingPost.music?.id ?? '') === id) pendingPost = null
    if (String(activePostId ?? '') !== id && !isInlinePlaying(id)) return
  }
  stopInlineMediaAudio()
  activePostId = null
}

/** The page has its first real gesture: audio may play now, so resume whichever
 *  post was waiting for it. Safe to call repeatedly. */
export function retryPendingFeedPlayback(): void {
  markAudioUnlocked()
  // A track that autoplay had to start muted becomes audible on this gesture.
  unmuteInlineMediaAudio()
  const p = pendingPost
  if (!p) return
  if (!getFeedAutoplayPref() || isGlobalPlayerPlaying()) { pendingPost = null; return }
  if (!postStillVisible(p)) return
  pendingPost = null
  void startFeedPlayback(p).catch(() => {})
}

if (typeof document !== 'undefined') {
  // pointerdown covers taps and mouse clicks; touchstart is the Android WebView
  // path; keydown covers keyboard/remote navigation. All passive: the feed's
  // scrolling never waits on audio.
  for (const type of ['pointerdown', 'touchstart', 'keydown', 'click']) {
    document.addEventListener(type, retryPendingFeedPlayback, { passive: true })
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopFeedPlayback() })
  window.addEventListener('pagehide', () => stopFeedPlayback())
}
