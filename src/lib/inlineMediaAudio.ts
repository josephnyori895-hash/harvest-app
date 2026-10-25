// Inline soundtrack controller for feed media and Stories.
// These tracks are deliberately separate from the Worship Room player UI:
// no NowPlayingBar, deep-link, or persistent player screen is opened.
import { pausePlayer } from './audioPlayer'

type InlineTrack = { id: string; title?: string; artist?: string; url: string }
type InlineState = { id: string | null; playing: boolean; error: string | null }
const listeners = new Set<(state: InlineState) => void>()
let audio: HTMLAudioElement | null = null
let state: InlineState = { id: null, playing: false, error: null }
const emit = () => listeners.forEach(listener => listener(state))
const patch = (next: Partial<InlineState>) => { state = { ...state, ...next }; emit() }
const ensureAudio = () => {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'none'
  audio.addEventListener('play', () => patch({ playing: true, error: null }))
  audio.addEventListener('pause', () => patch({ playing: false }))
  audio.addEventListener('ended', () => patch({ id: null, playing: false }))
  audio.addEventListener('error', () => patch({ playing: false, error: 'Soundtrack could not be played' }))
  return audio
}
export const getInlineAudioState = (): InlineState => state
export const subscribeInlineAudio = (listener: (state: InlineState) => void) => {
  listeners.add(listener); listener(state)
  return () => { listeners.delete(listener) }
}
export async function playInlineTrack(track: InlineTrack): Promise<boolean> {
  if (!track.id || !track.url) return false
  const a = ensureAudio()
  // A soundtrack takes over audio focus from the persistent Worship Room player.
  pausePlayer()
  if (state.id === track.id && !a.paused) { a.pause(); return true }
  a.pause()
  state = { id: track.id, playing: false, error: null }
  a.src = track.url
  emit()
  try { await a.play(); patch({ id: track.id, playing: true, error: null }); return true }
  catch { patch({ id: track.id, playing: false, error: 'Tap the sound icon to play this soundtrack' }); return false }
}
export function pauseInlineAudio(clear = false): void {
  if (audio) {
    audio.pause()
    if (clear) { audio.removeAttribute('src'); audio.load() }
  }
  patch(clear ? { id: null, playing: false, error: null } : { playing: false })
}
export function pauseAllMediaAudio(): void {
  pauseInlineAudio()
  pausePlayer()
}
