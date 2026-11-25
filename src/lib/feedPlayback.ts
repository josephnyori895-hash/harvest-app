// src/lib/feedPlayback.ts — central coordinator for feed-attached music.
//
// Instagram does not start a photo post's music just because it scrolls into
// view. The post carries a music control; the member taps it, and that post is
// "armed" for the session. Leaving the post pauses its audio; returning resumes
// it at the same position. Only one feed track plays at a time, and the worship
// player owns the audio element exclusively while it is running.
import { startInlineMediaTrack, stopInlineMediaAudio, isInlinePlaying } from './inlineMediaAudio'
import { isGlobalPlayerPlaying, pausePlayer } from './audioPlayer'

let activePostId: string | null = null
// Session-only. A tap arms one post; it is intentionally not persisted, so a
// cold app open stays silent until the member asks for sound.
const armed = new Set<string>()

const musicId = (p: any): string | null => {
  const id = p?.music?.id
  return id ? String(id) : null
}

export function isFeedPlaybackArmed(id: string): boolean {
  return armed.has(String(id))
}

/** Resume a post that the member has already started. Visibility alone must
 *  never produce sound. */
export async function startFeedPlayback(p: any): Promise<boolean> {
  const postId = musicId(p)
  const url = p?.music?.url
  if (!postId || !url || !armed.has(postId)) return false
  if (isGlobalPlayerPlaying()) return false
  if (activePostId === postId && isInlinePlaying(postId)) return true
  stopFeedPlayback()
  const ok = await startInlineMediaTrack({ id: postId, url })
  activePostId = ok ? postId : null
  return ok
}

/** A real member tap: arm this post, make room if worship is playing, and
 *  start it. This is the only path that may begin feed audio. */
export async function startManualFeedPlayback(p: any): Promise<boolean> {
  const postId = musicId(p)
  const url = p?.music?.url
  if (!postId || !url) return false
  armed.add(postId)
  if (isGlobalPlayerPlaying()) pausePlayer()
  stopFeedPlayback()
  const ok = await startInlineMediaTrack({ id: postId, url })
  activePostId = ok ? postId : null
  return ok
}

/** Pausing the post's own control disarms it; scrolling away must not. */
export function pauseManualFeedPlayback(p: any): void {
  const postId = musicId(p)
  if (postId) armed.delete(postId)
  stopFeedPlayback(p)
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

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopFeedPlayback() })
  window.addEventListener('pagehide', () => stopFeedPlayback())
}
