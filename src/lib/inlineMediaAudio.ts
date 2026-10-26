// One lightweight audio channel for music attached to feed media and stories.
// Attached soundtrack playback intentionally never opens the Worship Room player.
let inlineAudio: HTMLAudioElement | null = null
let activeId: string | null = null
let onChange: ((id: string | null) => void) | null = null
const listeners = new Set<(id: string | null) => void>()
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

export async function toggleInlineMediaTrack(track: { id: string; url?: string | null }, changed?: (id: string | null) => void): Promise<boolean> {
  if (!track.url) return false
  const id = String(track.id)
  if (activeId === id && inlineAudio) {
    stopInlineMediaAudio()
    return false
  }

  stopInlineMediaAudio()
  const audio = new Audio(track.url)
  inlineAudio = audio
  activeId = id
  onChange = changed || null
  notify(id)

  // An old audio element must never stop a newer track if its promise rejects
  // or a delayed media event arrives after the user switches tracks.
  audio.onended = () => { if (inlineAudio === audio) stopInlineMediaAudio() }
  audio.onerror = () => { if (inlineAudio === audio) stopInlineMediaAudio() }
  try {
    await audio.play()
    return true
  } catch {
    if (inlineAudio === audio) stopInlineMediaAudio()
    return false
  }
}

export function activeInlineMediaTrackId(): string | null {
  return activeId
}
