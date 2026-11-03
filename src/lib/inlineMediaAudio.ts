// One lightweight audio channel for music attached to feed media and stories.
// Attached soundtrack playback intentionally never opens the Worship Room player.
import { markAudioUnlocked } from './audioPlayer'

let inlineAudio: HTMLAudioElement | null = null
let activeId: string | null = null
let onChange: ((id: string | null) => void) | null = null
const listeners = new Set<(id: string | null) => void>()
// Last playback position per track id — scrolling back to a track resumes where
// the member left it instead of restarting from zero.
const resumeAt = new Map<string, number>()
const notify = (id: string | null) => { listeners.forEach(listener => listener(id)); onChange?.(id) }

export function subscribeInlineMediaAudio(listener: (id: string | null) => void) {
  listeners.add(listener)
  listener(activeId)
  return () => { listeners.delete(listener) }
}

export function stopInlineMediaAudio() {
  const previous = inlineAudio
  inlineAudio = null
  activeId = null
  const previousChange = onChange
  onChange = null
  if (previous) {
    previous.pause()
    previous.onended = null
    previous.onerror = null
  }
  listeners.forEach(listener => listener(null))
  previousChange?.(null)
}

// Start (not toggle): arm a track. If the same track is already live, PLAYING,
// this is a no-op (never stops audio); if it is live but paused, it resumes.
export async function startInlineMediaTrack(track: { id: string; url?: string | null }, changed?: (id: string | null) => void): Promise<boolean> {
  if (!track.url) return false
  const id = String(track.id)
  if (activeId === id && inlineAudio) {
    if (!inlineAudio.paused) return true
    try {
      await inlineAudio.play()
      markAudioUnlocked()
      return true
    } catch {
      return false
    }
  }

  stopInlineMediaAudio()
  const audio = new Audio(track.url)
  inlineAudio = audio
  activeId = id
  onChange = changed || null
  notify(id)

  // An old audio element must never stop a newer track if its promise rejects
  // or a delayed media event arrives after the user switches tracks.
  audio.onended = () => { resumeAt.delete(id); if (inlineAudio === audio) stopInlineMediaAudio() }
  audio.ontimeupdate = () => { if (inlineAudio === audio && activeId === id) resumeAt.set(id, audio.currentTime) }
  audio.onerror = () => { if (inlineAudio === audio) stopInlineMediaAudio() }
  try {
    await audio.play()
    markAudioUnlocked()
    const at = resumeAt.get(id)
    if (at && at > 1) { try { audio.currentTime = at } catch { void restorePosition(audio, id, resumeAt) } }
    return true
  } catch {
    if (inlineAudio === audio) stopInlineMediaAudio()
    return false
  }
}

// Restore position once metadata has loaded when the early seek throws.
function restorePosition(audio: HTMLAudioElement, id: string, resumeAt: Map<string, number>): Promise<void> {
  return new Promise(resolve => {
    const apply = () => {
      audio.removeEventListener('loadedmetadata', apply)
      const at = resumeAt.get(id)
      if (at && at > 1) { try { audio.currentTime = at } catch { /* not seekable */ } }
      resolve()
    }
    audio.addEventListener('loadedmetadata', apply, { once: true })
  })
}

export async function toggleInlineMediaTrack(track: { id: string; url?: string | null }, changed?: (id: string | null) => void): Promise<boolean> {
  if (!track.url) return false
  const id = String(track.id)
  // Manual toggle semantics: tapping the live track pauses it.
  if (activeId === id && inlineAudio && !inlineAudio.paused) {
    stopInlineMediaAudio()
    return false
  }
  return startInlineMediaTrack(track, changed)
}

export function activeInlineMediaTrackId(): string | null {
  return activeId
}

/** Whether the attached track currently playing matches the given id. */
export function isInlinePlaying(id: string): boolean {
  return !!inlineAudio && !inlineAudio.paused && activeId === id
}
