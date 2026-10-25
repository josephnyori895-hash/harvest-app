// One lightweight audio channel for music attached to feed media and stories.
// Attached soundtrack playback intentionally never opens the Worship Room player.
let inlineAudio: HTMLAudioElement | null = null
let activeId: string | null = null
let onChange: ((id: string | null) => void) | null = null
const listeners = new Set<(id: string | null) => void>()
const notify = (id: string | null) => { listeners.forEach(listener => listener(id)); onChange?.(id) }
export function subscribeInlineMediaAudio(listener: (id: string | null) => void) { listeners.add(listener); listener(activeId); return () => { listeners.delete(listener) } }

export function stopInlineMediaAudio() {
  if (inlineAudio) {
    inlineAudio.pause()
    inlineAudio.onended = null
    inlineAudio.onerror = null
    inlineAudio = null
  }
  activeId = null
  notify(null)
  onChange = null
}

export async function toggleInlineMediaTrack(track: { id: string; url?: string | null }, changed?: (id: string | null) => void): Promise<boolean> {
  if (!track.url) return false
  if (activeId === track.id && inlineAudio) {
    stopInlineMediaAudio()
    return false
  }
  stopInlineMediaAudio()
  const audio = new Audio(track.url)
  inlineAudio = audio
  activeId = track.id
  onChange = changed || null
  notify(track.id)
  audio.onended = () => stopInlineMediaAudio()
  audio.onerror = () => stopInlineMediaAudio()
  try {
    await audio.play()
    return true
  } catch {
    stopInlineMediaAudio()
    return false
  }
}

export function activeInlineMediaTrackId(): string | null {
  return activeId
}
