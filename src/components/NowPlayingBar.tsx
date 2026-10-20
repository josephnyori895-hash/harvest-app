import { useEffect, useState } from 'react'
import { subscribePlayer, seekToFraction, togglePlay, closePlayer, type PlayerState } from '../lib/audioPlayer'

/**
 * Floating "now playing" strip above the bottom nav. Rendered once in App.jsx
 * so it survives every tab change — pairing with the global audio player that
 * owns the actual HTMLAudioElement. Tap the title to jump back to the screen
 * that owns the track (music room or sermons).
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
    <div className="fixed left-0 right-0 z-40 px-3" style={{ bottom: 'calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 58px)' }}>
      <div className="mx-auto max-w-lg rounded-2xl bg-[#29251F] text-[#FFFBF0] shadow-2xl border border-[#3E362C] px-3 py-2" role="group" aria-label="Now playing">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onOpen(track.origin === 'sermons' ? 'sermons' : 'music')}
            className="min-w-0 flex-1 text-left active:opacity-70"
          >
            <p className="text-xs font-extrabold truncate">{track.title}</p>
            <p className="text-[10px] text-[#B8AC9C] truncate">
              {track.artist || 'Harvest Family Church'}
              {player.duration > 0 ? ` · ${fmt(player.currentTime)} / ${fmt(player.duration)}` : ''}
              {player.error ? ` · ${player.error}` : ''}
            </p>
          </button>
          <button
            type="button"
            onClick={() => void togglePlay()}
            aria-label={player.playing ? 'Pause' : 'Play'}
            className="w-9 h-9 shrink-0 rounded-full bg-[#7C3AED] hover:bg-[#6D28D9] text-white flex items-center justify-center font-bold"
          >
            {player.playing ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            onClick={() => closePlayer()}
            aria-label="Close player"
            className="w-7 h-7 shrink-0 rounded-full bg-[#3E362C] text-[#B8AC9C] flex items-center justify-center text-xs"
          >✕</button>
        </div>
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekToFraction((e.clientX - r.left) / r.width) }}
          className="mt-2 h-1 rounded-full bg-[#3E362C] overflow-hidden cursor-pointer"
        >
          <div className="h-full rounded-full bg-gradient-to-r from-[#F59E0B] to-[#7C3AED]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
