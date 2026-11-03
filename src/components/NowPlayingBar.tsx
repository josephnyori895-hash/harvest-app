import { useEffect, useState } from 'react'
import { subscribePlayer, seekToFraction, togglePlay, closePlayer, previousTrack, nextTrack, type PlayerState } from '../lib/audioPlayer'
import { Icon } from '../ui'

/**
 * Floating "now playing" strip above the bottom nav. Rendered once in App.jsx
 * so it survives every tab change — pairing with the global audio player that
 * owns the actual HTMLAudioElement and its queue. Tap the title to jump back to
 * the screen that owns the track; prev/next keep a worship set going while the
 * member browses anywhere else in the app.
 */
export default function NowPlayingBar({ onOpen }: { onOpen: (tab: 'music' | 'sermons') => void }) {
  const [player, setPlayer] = useState<PlayerState>({ track: null, playing: false, currentTime: 0, duration: 0, error: null })
  useEffect(() => subscribePlayer(setPlayer), [])
  const track = player.track
  if (!track) return null
  const pct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0
  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00'
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return (
    <div
      className="fixed inset-x-0 z-40 px-3"
      style={{ bottom: 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 64px)' }}
    >
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-ink px-3 py-2 text-surface shadow-2xl" role="group" aria-label="Now playing">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface/10">
            {track.artwork
              ? <img src={track.artwork} alt="" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center text-gold"><Icon name="music" size={16} /></span>}
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
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekToFraction((e.clientX - r.left) / r.width) }}
          className="mt-2 h-1 cursor-pointer overflow-hidden rounded-full bg-surface/20"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
