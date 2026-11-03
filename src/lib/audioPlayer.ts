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
  /** Queue affordances — the now-playing bar shows prev/next only when they work. */
  hasNext?: boolean
  hasPrev?: boolean
}

const listeners = new Set<(s: PlayerState) => void>()
let audio: HTMLAudioElement | null = null
let state: PlayerState = { track: null, playing: false, currentTime: 0, duration: 0, error: null }

// ── Worship queue ─────────────────────────────────────────────
// Listening daily only works if playback never dead-ends. A queue makes "play
// all", next/prev and auto-advance real, and the last track + position are
// remembered so the Worship screen can offer "Continue listening" tomorrow.
let queue: PlayerTrack[] = []
let queueIndex = -1
let repeatOne = false
const LAST_KEY = 'harvest_last_played'
const emitQueueFlags = () => patch({ hasNext: queueIndex >= 0 && queueIndex < queue.length - 1, hasPrev: queueIndex > 0 })
const remember = (track: PlayerTrack | null, position: number) => {
  try {
    if (!track) { localStorage.removeItem(LAST_KEY); return }
    localStorage.setItem(LAST_KEY, JSON.stringify({ track, position: Math.max(0, Math.floor(position || 0)), at: Date.now() }))
  } catch { /* private mode */ }
}
/** Last worship track the member heard, for the Continue-listening card. */
export function getLastPlayed(): { track: PlayerTrack; position: number; at: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.track?.url ? parsed : null
  } catch { return null }
}
export const getQueue = (): PlayerTrack[] => [...queue]
export const getQueueIndex = (): number => queueIndex
export const setRepeatOne = (v: boolean): void => { repeatOne = v }
export const getRepeatOne = (): boolean => repeatOne
// Browsers (and the Android WebView) refuse sound-producing autoplay until the
// member has interacted with audio at least once. Feed posts with a song track
// use this to decide between auto-start (IG-style) and tap-to-play.
let audioUnlocked = false
export const audioAutoplayReady = (): boolean => audioUnlocked
export const markAudioUnlocked = (): void => { audioUnlocked = true }
/** True when a global (worship / sermon) track currently owns the audio element. */
export const isGlobalPlayerPlaying = (): boolean => Boolean(state.track && state.playing)
/** Member-level feed autoplay. On by default, like a feed app: attached music
 *  previews itself while you scroll. Pausing the disc is the mute, stored as
 *  '0' so the choice survives reloads and app restarts. */
const FEED_AUTOPLAY_KEY = 'harvest_feed_autoplay'
let feedAutoplayPref = (() => {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(FEED_AUTOPLAY_KEY) !== '0' : true } catch { return true }
})()
export const getFeedAutoplayPref = (): boolean => feedAutoplayPref
export const setFeedAutoplayPref = (v: boolean): void => {
  feedAutoplayPref = v
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(FEED_AUTOPLAY_KEY, v ? '1' : '0') } catch { /* private mode */ }
}

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
    // Worship never dead-ends: repeat-one, or advance the queue.
    if (repeatOne) {
      try { audio!.currentTime = 0; void audio!.play() } catch { /* ignore */ }
      return
    }
    if (queue.length > 1 && queueIndex >= 0 && queueIndex < queue.length - 1) {
      void nextTrack()
      return
    }
    patch({ playing: false, currentTime: 0 })
    const ms = (navigator as any).mediaSession
    try { if (ms) ms.playbackState = 'paused' } catch { /* ignore */ }
  })
  let lastRemembered = 0
  audio.addEventListener('timeupdate', () => {
    const t = audio?.currentTime || 0
    patch({ currentTime: t })
    // Persist progress every few seconds, not on every tick.
    if (state.track && Math.abs(t - lastRemembered) >= 4) { lastRemembered = t; remember(state.track, t) }
  })
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
export async function playTrack(track: PlayerTrack, opts: { keepQueue?: boolean } = {}): Promise<boolean> {
  if (!track.url) {
    patch({ error: 'This track has no audio source yet' })
    return false
  }
  if (!opts.keepQueue) {
    // A standalone play (sermon, feed pick) is its own one-track queue; queue
    // playback goes through playFromQueue so auto-advance keeps working.
    queue = [track]
    queueIndex = 0
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
  emitQueueFlags()
  remember(track, 0)
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

/** Stop playback and drop the loaded track entirely. The last-played memory
 *  survives so the Worship screen can still offer "Continue listening". */
export function closePlayer(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  clearMediaSession()
  queue = []
  queueIndex = -1
  state = { track: null, playing: false, currentTime: 0, duration: 0, error: null }
  emit()
}

export function isPlayingId(id: string): boolean {
  return !!state.track && state.track.id === id && state.playing
}

/**
 * Start a whole list — "Play all", today's rotation, a saved shelf. The queue
 * is what makes next/prev and auto-advance work, so this is the entry point for
 * every listening surface.
 */
export async function playFromQueue(tracks: PlayerTrack[], startIndex = 0): Promise<boolean> {
  const playable = tracks.filter(t => t?.url)
  if (!playable.length) { patch({ error: 'This shelf has no playable tracks yet' }); return false }
  queue = playable
  const start = Math.min(Math.max(startIndex, 0), playable.length - 1)
  queueIndex = start
  emitQueueFlags()
  const ok = await playTrack(playable[start], { keepQueue: true })
  emitQueueFlags()
  return ok
}

/** Advance to the next queue track (also fired automatically when one ends). */
export async function nextTrack(): Promise<boolean> {
  if (queueIndex < 0 || queueIndex >= queue.length - 1) {
    patch({ hasNext: false })
    return false
  }
  queueIndex += 1
  emitQueueFlags()
  return playTrack(queue[queueIndex], { keepQueue: true })
}

/** Previous queue track; restarts the current one when it is already playing. */
export async function previousTrack(): Promise<boolean> {
  if (queueIndex <= 0) {
    seekTo(0)
    patch({ hasPrev: false })
    return false
  }
  queueIndex -= 1
  emitQueueFlags()
  return playTrack(queue[queueIndex], { keepQueue: true })
}
