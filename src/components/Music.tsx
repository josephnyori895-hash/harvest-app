import { useEffect, useMemo, useRef, useState } from 'react'
import { IgIcon } from './Icons'
import { showToast } from './Toast'
import { fetchMusic, useApi } from '../lib/api'

const HARVEST_SONGS = [
  { id: 'h1', title: 'Compelled Anthem', artist: 'Harvest Worship', type: 'worship', duration: '3:45', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'h2', title: 'Raise Me Up', artist: 'Grace & Team', type: 'praise', duration: '4:12', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'h3', title: 'Released', artist: 'Youth Harvest', type: 'choir', duration: '3:28', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'h4', title: 'Great Is Thy Faithfulness', artist: 'Hillsong', type: 'worship', duration: '5:04', cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'h5', title: 'Way Maker', artist: 'Sinach', type: 'worship', duration: '4:33', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
]

type Track = {
  id: string
  title: string
  artist: string
  type?: string
  duration?: string
  cover?: string
  url?: string | null
  source: 'demo' | 'server' | 'local'
  seconds?: number
}

const FALLBACK_COVER = 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Music({ musics, onAdd }: { musics: any[]; onAdd: (m: any) => void }) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'trending' | 'local'>('trending')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState({ id: null as string | null, seconds: 0, duration: 0 })
  const [serverTracks, setServerTracks] = useState<Track[]>([])
  const [loadingServer, setLoadingServer] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const useServer = useApi()

  // Server library (tracks uploaded via /api/media/confirm type=track) — merged with demo list
  useEffect(() => {
    if (!useServer) return
    let cancelled = false
    setLoadingServer(true)
    fetchMusic()
      .then(r => {
        if (cancelled) return
        const mapped: Track[] = (r.tracks || [])
          .filter(t => t.url)
          .map(t => ({ id: `srv_${t.id}`, title: t.title, artist: t.artist, type: 'worship', url: t.url, source: 'server' as const }))
        setServerTracks(mapped)
      })
      .catch(() => { /* offline — demo list still works */ })
      .finally(() => { if (!cancelled) setLoadingServer(false) })
    return () => { cancelled = true }
  }, [useServer])

  const localTracks: Track[] = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('harvest_musics') || '[]')
      return (Array.isArray(raw) ? raw : []).map((m: any) => ({
        id: m.id || `loc_${m.title}`,
        title: m.title || 'Untitled',
        artist: m.artist || 'Harvest member',
        url: typeof m.url === 'string' && m.url ? m.url : undefined,
        cover: m.cover,
        source: 'local' as const,
      }))
    } catch { return [] }
  }, [musics])

  const tracks: Track[] = useMemo(() => {
    const base = tab === 'local' ? localTracks : [...serverTracks, ...HARVEST_SONGS]
    const seen = new Set<string>()
    return base.filter(t => {
      const k = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [tab, localTracks, serverTracks])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tracks
    return tracks.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(needle))
  }, [tracks, q])

  // Single shared audio element — never more than one playing, cleaned up on unmount
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null }, [])

  const togglePlay = (track: Track) => {
    setError('')
    if (!track.url) { showToast('This track has no audio source yet'); return }
    if (playingId === track.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(track.url)
    audio.onended = () => { setPlayingId(null); setProgress(p => ({ ...p, id: null, seconds: 0 })) }
    audio.ontimeupdate = () => setProgress({ id: track.id, seconds: audio.currentTime, duration: audio.duration || 0 })
    audio.onerror = () => { setPlayingId(null); setError(`Unable to play "${track.title}". Try another track.`) }
    audio.play().then(() => {
      audioRef.current = audio
      setPlayingId(track.id)
    }).catch(() => { showToast('Tap again to allow audio playback') })
  }

  const seek = (track: Track, e: React.MouseEvent<HTMLDivElement>) => {
    if (playingId !== track.id || !audioRef.current || !audioRef.current.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = ratio * audioRef.current.duration
  }

  const addToLibrary = (track: Track) => {
    try {
      const lib = JSON.parse(localStorage.getItem('harvest_musics') || '[]')
      const exists = lib.some((m: any) => (m.title || '').toLowerCase() === track.title.toLowerCase() && (m.artist || '').toLowerCase() === track.artist.toLowerCase())
      if (exists) { showToast('Already in your Harvest library'); return }
      const next = [{ id: `loc_${Date.now()}`, title: track.title, artist: track.artist, url: track.url || undefined, cover: track.cover }, ...lib]
      localStorage.setItem('harvest_musics', JSON.stringify(next))
      showToast(`"${track.title}" added to your library`)
    } catch { showToast('Could not add to library') }
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-gradient-to-b from-amber-50 to-purple-50 text-neutral-900">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-neutral-200 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-white font-bold">🎵</div>
            <h1 className="text-xl font-extrabold truncate">Harvest Music</h1>
          </div>
          <span className="shrink-0 text-xs font-bold px-3 py-1 rounded-full bg-purple-100 text-purple-700">WORSHIP</span>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-white border-2 border-neutral-200 rounded-xl px-3 py-2.5 focus-within:border-purple-500 transition">
            <IgIcon name="search" size={20} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'local' ? 'Search your library...' : 'Search songs, artists...'}
              className="min-w-0 flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          {q && <button onClick={() => setQ('')} className="touch-target w-10 h-10 shrink-0 rounded-full bg-neutral-200 flex items-center justify-center" aria-label="Clear search">✕</button>}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            ['trending', '🔥 Trending Worship'],
            ['local', `🎧 Local Music${localTracks.length ? ` (${localTracks.length})` : ''}`],
          ].map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-gradient-to-r from-amber-400 to-purple-600 text-white shadow-lg'
                  : 'bg-white text-neutral-700 border border-neutral-200 hover:border-neutral-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-6 space-y-4">
        {error && <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {tab === 'local' && localTracks.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎧</div>
            <p className="text-neutral-500 font-medium">Your library is empty</p>
            <p className="text-sm text-neutral-400 mt-1">Add ➕ tracks from Trending Worship to build your Harvest library</p>
          </div>
        ) : filtered.length === 0 && q ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎵</div>
            <p className="text-neutral-500 font-medium">No songs found</p>
            <p className="text-sm text-neutral-400">Try searching "Worship" or artist names</p>
          </div>
        ) : (
          filtered.map((track) => {
            const isPlaying = playingId === track.id
            const showBar = progress.id === track.id && isPlaying
            const pct = showBar && progress.duration > 0 ? (progress.seconds / progress.duration) * 100 : 0
            return (
              <div
                key={track.id}
                className="card-spiritual hover:shadow-xl transition-all duration-300 overflow-hidden group"
              >
                <div className="flex gap-3 sm:gap-4 p-4 items-center">
                  <div className="relative flex-shrink-0">
                    <img
                      src={track.cover || FALLBACK_COVER}
                      alt={track.title}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover shadow-md group-hover:scale-105 transition-transform"
                    />
                    <button
                      onClick={() => togglePlay(track)}
                      className={`absolute inset-0 flex items-center justify-center rounded-xl transition-all ${
                        isPlaying ? 'bg-purple-600/90' : 'bg-black/40 group-hover:bg-purple-600/80'
                      }`}
                      aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                    >
                      <span className="text-white text-2xl">{isPlaying ? '⏸' : '▶'}</span>
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-neutral-900 truncate">{track.title}</h3>
                    <p className="text-sm text-neutral-600 truncate">{track.artist}</p>

                    {showBar && (
                      <div
                        className="mt-2 flex items-center gap-2 cursor-pointer"
                        onClick={(e) => seek(track, e)}
                        role="slider"
                        aria-label={`Seek ${track.title}`}
                        aria-valuenow={Math.floor(progress.seconds)}
                        aria-valuemin={0}
                        aria-valuemax={Math.floor(progress.duration || 0)}
                      >
                        <div className="flex-1 h-1 bg-neutral-300 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-400 to-purple-600"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-neutral-500 font-mono">
                          {fmt(progress.seconds)} / {fmt(progress.duration || track.seconds || 0)}
                        </span>
                      </div>
                    )}

                    <div className="flex gap-2 mt-2 flex-wrap">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        track.type === 'worship'
                          ? 'badge-admin'
                          : track.type === 'praise'
                          ? 'bg-blue-100 text-blue-700'
                          : 'badge-member'
                      }`}>
                        {track.source === 'server' ? 'Church upload' : (track.type || 'Local').charAt(0).toUpperCase() + (track.type || 'Local').slice(1)}
                      </span>
                      {track.source === 'local' && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">Saved</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => togglePlay(track)}
                      className="btn-primary py-2 px-3 text-sm min-w-[48px]"
                      aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                    >
                      {isPlaying ? '⏸' : '▶'}
                    </button>
                    <button
                      onClick={() => { addToLibrary(track); onAdd?.(track) }}
                      className="btn-secondary py-2 px-3 text-sm min-w-[48px]"
                      title={track.source === 'local' ? 'Use in a story or post' : 'Save to Local Music + use in a story/post'}
                      aria-label={`Add ${track.title} to library and story`}
                    >
                      ➕
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
        {tab === 'trending' && loadingServer && <p className="text-center text-xs text-neutral-400">Loading church uploads…</p>}
      </div>
    </div>
  )
}
