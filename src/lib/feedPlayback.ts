// src/lib/feedPlayback.ts — central coordinator for feed-attached music.
//
// One active feed music post at a time. Autoplay is gated by the member's
// opt-in pref + the browser interaction flag; the global worship/sermon player
// owns the audio element exclusively while it plays, so feed music yields.
import { startInlineMediaTrack, stopInlineMediaAudio, isInlinePlaying } from './inlineMediaAudio'
import { audioAutoplayReady, markAudioUnlocked, isGlobalPlayerPlaying, getFeedAutoplayPref } from './audioPlayer'

let activePostId: string | null = null

export function getActiveFeedPostId(): string | null {
  return activePostId
}

export function feedPostHasTrack(p: any): boolean {
  return Boolean(p?.music?.id && p?.music?.url)
}

export function stopFeedPlayback(p?: any): void {
  // Scoped stop: a card scrolling out pauses only its own track — either the
  // one it armed through the coordinator, or the one it manually started via
  // the inline channel (chip start bypasses the coordinator, so the channel
  // is the source of truth). A video post passing a playing music post never
  // steals/ends that music.
  if (p && p.music?.id) {
    const id = String(p.music.id)
    if (String(activePostId ?? '') !== id && !isInlinePlaying(id)) return
  }
  stopInlineMediaAudio()
  activePostId = null
}

export async function startFeedPlayback(p: any): Promise<boolean> {
  const postId = String(p?.music?.id || '')
  const url = p?.music?.url
  if (!postId || !url) return false
  if (!getFeedAutoplayPref()) return false
  if (!audioAutoplayReady()) return false
  if (isGlobalPlayerPlaying()) return false
  if (activePostId === postId && isInlinePlaying(postId)) return true
  stopFeedPlayback()
  const ok = await startInlineMediaTrack({ id: postId, url })
  if (ok) { activePostId = postId } else { activePostId = null }
  return ok
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopFeedPlayback() })
  window.addEventListener('pagehide', () => stopFeedPlayback())
}
