// src/lib/audioPlayer.ts — global audio player singleton.
//
// Music.tsx and Sermons.tsx used to own their own HTMLAudioElement, so every
// tab change unmounted the component and paused the audio the member was
// listening to. This module owns ONE audio element for the whole app, outside
// React's lifecycle: screens come and go, worship keeps playing.
// A floating NowPlayingBar (rendered in App.jsx) subscribes here.
//
// MediaSession metadata is set so Android can surface playback controls with
// the current track when the WebView exposes them.

export type PlayerTrack = {
  id: string
  title: string
  artist?: string
  url?: string | null
  artwork?: string | null
  /** Which screen owns the track — the NowPlayingBar deep-links back here. */
  origin?: 'music' | 'sermons' | 'feed'
}

export type PlayerState = {
  track: PlayerTrack | null
  playing: boolean
  currentTime: number
  duration: number
  error: string | null
}

const listeners = new Set<(s: PlayerState) => void>()
let audio: HTMLAudioElement | null = null
let state: PlayerState = { track: null, playing: false, currentTime: 0, duration: 0, error: null }
// Browsers (and the Android WebView) refuse sound-producing autoplay until the
// member has interacted with audio at least once. Feed posts with a song track
// use this to decide between auto-start (IG-style) and tap-to-play.
let audioUnlocked = false
export const audioAutoplayReady = (): boolean => audioUnlocked

const emit = () => { listeners.forEach(l => l(state)) }
const patch = (p: Partial<PlayerState>) => { state = { ...state, ...p }; emit() }
export const getPlayerState = (): PlayerState => state

export function subscribePlayer(fn: (s: PlayerState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => { listeners.delete(fn) }
}

const fmtMediaTime = (sec: number) => {
  if (!Number.isFinite(sec)) return NaN as unknown as number
  return sec
}

const setMediaSession = (track: PlayerTrack) => {
  const ms = (navigator as any).mediaSession
  if (!ms || typeof window.MediaMetadata === 'undefined') return
  try {
    ms.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist || 'Harvest Family Church',
      album: 'Harvest Family Church',
      artwork: track.artwork ? [{ src: track.artwork }] : undefined,
    })
    ms.setActionHandler('play', () => void togglePlay())
    ms.setActionHandler('pause', () => void togglePlay())
    ms.setActionHandler('stop', () => closePlayer())
    ms.setActionHandler('seekto', (d: MediaSessionActionDetails) => {
      if (typeof d.seekTime === 'number') seekTo(d.seekTime)
    })
  } catch { /* MediaSession is a progressive enhancement */ }
}

const clearMediaSession = () => {
  const ms = (navigator as any).mediaSession
  if (!ms) return
  try { ms.metadata = null; ms.playbackState = 'none' } catch { /* ignore */ }
}

const ensureAudio = (): HTMLAudioElement => {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('ended', () => {
    patch({ playing: false, currentTime: 0 })
    const ms = (navigator as any).mediaSession
    try { if (ms) ms.playbackState = 'paused' } catch { /* ignore */ }
  })
  audio.addEventListener('timeupdate', () => patch({ currentTime: audio?.currentTime || 0 }))
  audio.addEventListener('loadedmetadata', () => {
    patch({ duration: fmtMediaTime(audio?.duration || 0) })
  })
  audio.addEventListener('pause', () => {
    if (audio?.ended) return
    patch({ playing: false })
  })
  audio.addEventListener('play', () => patch({ playing: true }))
  return audio
}

/** Play a track. If the same id is already loaded, this toggles pause/play. */
export async function playTrack(track: PlayerTrack): Promise<boolean> {
  if (!track.url) {
    patch({ error: 'This track has no audio source yet' })
    return false
  }
  const a = ensureAudio()
  if (state.track?.id === track.id) {
    if (a.paused) { try { await a.play(); return true } catch { patch({ error: 'Tap play again to allow audio' }); return false } }
    a.pause()
    return true
  }
  a.pause()
  a.src = track.url
  patch({ track: { ...track }, playing: false, currentTime: 0, duration: 0, error: null })
  setMediaSession(track)
  try {
    await a.play()
    audioUnlocked = true
    patch({ playing: true })
    try {
      const ms = (navigator as any).mediaSession
      if (ms) ms.playbackState = 'playing'
    } catch { /* ignore */ }
    return true
  } catch {
    patch({ error: 'Tap play again to allow audio' })
    return false
  }
}

/** Toggle the currently loaded track (or resume after autoplay rejection). */
export async function togglePlay(): Promise<void> {
  if (!state.track || !audio) return
  if (audio.paused) {
    try { await audio.play(); audioUnlocked = true } catch { patch({ error: 'Tap play again to allow audio' }) }
  } else {
    audio.pause()
  }
}

/** Pause whatever the global player holds, keeping the track loaded. */
export function pausePlayer(): void {
  audio?.pause()
}

/** Seek by fraction of duration (0..1) — used by the scrub bars. */
export function seekToFraction(fraction: number): void {
  if (!audio) return
  const d = audio.duration
  if (Number.isFinite(d) && d > 0) {
    audio.currentTime = Math.min(Math.max(fraction * d, 0), d)
    patch({ currentTime: audio.currentTime })
  }
}

/** Seek to an absolute time in seconds. */
export function seekTo(seconds: number): void {
  if (!audio) return
  audio.currentTime = Math.min(Math.max(seconds, 0), audio.duration || seconds)
  patch({ currentTime: audio.currentTime })
}

/** Stop playback and drop the loaded track entirely. */
export function closePlayer(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  clearMediaSession()
  state = { track: null, playing: false, currentTime: 0, duration: 0, error: null }
  emit()
}

export function isPlayingId(id: string): boolean {
  return !!state.track && state.track.id === id && state.playing
}
