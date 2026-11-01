// src/lib/feedPlayback.ts — central coordinator for feed-attached music.
//
// One active feed music post at a time. Autoplay is gated by the member's
// opt-in pref + the browser interaction flag; the global worship/sermon player
// owns the audio element exclusively while it plays, so feed music yields.
import { toggleInlineMediaTrack, stopInlineMediaAudio, isInlinePlaying } from './inlineMediaAudio'
import { audioAutoplayReady, markAudioUnlocked, isGlobalPlayerPlaying, getFeedAutoplayPref } from './audioPlayer'

let activePostId: string | null = null

export function getActiveFeedPostId(): string | null {
  return activePostId
}

export function feedPostHasTrack(p: any): boolean {
  return Boolean(p?.music?.id && p?.music?.url)
}

export function stopFeedPlayback(): void {
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
  const ok = await toggleInlineMediaTrack({ id: postId, url })
  if (ok) { markAudioUnlocked(); activePostId = postId } else { activePostId = null }
  return ok
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopFeedPlayback() })
  window.addEventListener('pagehide', () => stopFeedPlayback())
}
