import { useEffect, useRef, useState } from 'react'
import { subscribePlayer, seekToFraction, seekTo, togglePlay, closePlayer, previousTrack, nextTrack, type PlayerState } from '../lib/audioPlayer'
import { Icon } from '../ui'
import TrackArt from './TrackArt'

/**
 * Floating "now playing" strip above the bottom nav. Rendered once in App.jsx
 * so it survives every tab change — pairing with the global audio player that
 * owns the actual HTMLAudioElement and its queue. Tap the title to jump back to
 * the screen that owns the track; prev/next keep a worship set going while the
 * member browses anywhere else in the app.
 */
export default function NowPlayingBar({ onOpen }: { onOpen: (tab: 'music' | 'sermons') => void }) {
  const [player, setPlayer] = useState<PlayerState>({ track: null, playing: false, currentTime: 0, duration: 0, error: null })
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => subscribePlayer(setPlayer), [])
  const track = player.track
  if (!track) return null
  const pct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0
  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00'
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  // Drag to scrub: the old bar only reacted to a single click, and a 4 px track
  // is nearly impossible to hit with a thumb.
  const seekFromClientX = (clientX: number) => {
    const el = barRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width) return
    seekToFraction(Math.min(Math.max((clientX - r.left) / r.width, 0), 1))
  }
  return (
    <div
      className="fixed inset-x-0 z-40 px-3"
      style={{ bottom: 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 64px)' }}
    >
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-ink px-3 py-2 text-surface shadow-2xl" role="group" aria-label="Now playing">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
            <TrackArt src={track.artwork} title={track.title} className="h-full w-full" iconSize={16} />
          </div>
          <button
            type="button"
            onClick={() => onOpen(track.origin === 'sermons' ? 'sermons' : 'music')}
            className="min-w-0 flex-1 text-left active:opacity-70"
          >
            <p className="truncate text-xs font-extrabold">{track.title}</p>
            <p className="truncate text-2xs text-surface/60">
              {track.artist || 'Harvest Family Church'}
              {player.duration > 0 ? ` · ${fmt(player.currentTime)} / ${fmt(player.duration)}` : ''}
              {player.error ? ` · ${player.error}` : ''}
            </p>
          </button>
          <button
            type="button"
            onClick={() => void previousTrack()}
            disabled={!player.hasPrev}
            aria-label="Previous track"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-surface/70 disabled:opacity-30"
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button
            type="button"
            onClick={() => void togglePlay()}
            aria-label={player.playing ? 'Pause' : 'Play'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white"
          >
            <Icon name={player.playing ? 'pause' : 'play'} size={16} />
          </button>
          <button
            type="button"
            onClick={() => void nextTrack()}
            disabled={!player.hasNext}
            aria-label="Next track"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-surface/70 disabled:opacity-30"
          >
            <Icon name="arrow-right" size={16} />
          </button>
          <button
            type="button"
            onClick={() => closePlayer()}
            aria-label="Close player"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface/10 text-surface/60"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={`${fmt(player.currentTime)} of ${fmt(player.duration)}`}
          onPointerDown={e => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromClientX(e.clientX)
          }}
          onPointerMove={e => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromClientX(e.clientX)
          }}
          onKeyDown={e => {
            const duration = player.duration || 0
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); seekTo(Math.min(player.currentTime + 10, duration)) }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); seekTo(Math.max(player.currentTime - 10, 0)) }
            else if (e.key === 'Home') { e.preventDefault(); seekTo(0) }
            else if (e.key === 'End') { e.preventDefault(); seekTo(duration) }
          }}
          className="relative mt-1 flex h-5 cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface/20">
            <div className="h-full rounded-full bg-gradient-to-r from-gold to-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
