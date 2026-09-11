import { useMemo, useEffect, useRef, useState } from 'react'
import { IgIcon } from './Icons'

const HARVEST_SONGS = [
  { id: 'h1', title: 'Compelled Anthem', artist: 'Harvest Worship', type: 'worship', duration: '3:45', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'h2', title: 'Raise Me Up', artist: 'Grace & Team', type: 'praise', duration: '4:12', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'h3', title: 'Released', artist: 'Youth Harvest', type: 'choir', duration: '3:28', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'h4', title: 'Great Is Thy Faithfulness', artist: 'Hillsong', type: 'worship', duration: '5:04', cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'h5', title: 'Way Maker', artist: 'Sinach', type: 'worship', duration: '4:33', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
]

export default function Music({ musics, onAdd }: { musics: any[]; onAdd: (m: any) => void }) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'trending' | 'local'>('trending')
  const [playing, setPlaying] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState<Record<string, number>>({})
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({})

  useEffect(() => () => {
    Object.values(audioRefs.current).forEach(audio => audio?.pause())
  }, [])

  const sourceSongs = tab === 'local' ? (Array.isArray(musics) ? musics : []) : HARVEST_SONGS
  const filteredSongs = useMemo(() => sourceSongs.filter((m: any) =>
    String(m.title || '').toLowerCase().includes(q.toLowerCase()) ||
    String(m.artist || '').toLowerCase().includes(q.toLowerCase())
  ), [sourceSongs, q])

  const stopAll = () => Object.values(audioRefs.current).forEach(audio => audio?.pause())

  const togglePlay = async (track: any) => {
    setError('')
    if (playing === track.id) {
      audioRefs.current[track.id]?.pause()
      setPlaying(null)
      return
    }
    stopAll()
    const audio = new Audio(track.url)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => setDurations(prev => ({ ...prev, [track.id]: audio.duration }))
    audio.ontimeupdate = () => setCurrentTime(prev => ({ ...prev, [track.id]: audio.currentTime }))
    audio.onended = () => setPlaying(null)
    audio.onerror = () => { setPlaying(null); setError(`Unable to play “${track.title}”. Try another track.`) }
    audioRefs.current[track.id] = audio
    try {
      await audio.play()
      setPlaying(track.id)
    } catch {
      setPlaying(null)
      setError('Playback was blocked. Tap play again to start the song.')
    }
  }

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '0:00'
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
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
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-white border-2 border-neutral-200 rounded-xl px-3 py-2.5 focus-within:border-purple-500">
            <IgIcon name="search" size={20} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search songs, artists..." className="min-w-0 flex-1 bg-transparent outline-none text-sm" />
          </div>
          {q && <button onClick={() => setQ('')} className="touch-target w-10 h-10 shrink-0 rounded-full bg-neutral-200 flex items-center justify-center" aria-label="Clear search">✕</button>}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setTab('trending')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${tab === 'trending' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white text-neutral-700 border border-neutral-200'}`}>🔥 Trending Worship</button>
          <button onClick={() => setTab('local')} className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${tab === 'local' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white text-neutral-700 border border-neutral-200'}`}>🎧 Local Music</button>
        </div>
      </div>

      <div className="px-4 py-6 space-y-4">
        {error && <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {filteredSongs.length === 0 ? (
          <div className="text-center py-12"><div className="text-6xl mb-4">🎵</div><p className="text-neutral-500 font-medium">{tab === 'local' ? 'No local music yet' : 'No songs found'}</p><p className="text-sm text-neutral-400">{tab === 'local' ? 'Music added by the church will appear here.' : 'Try another song or artist.'}</p></div>
        ) : filteredSongs.map((track: any) => {
          const duration = durations[track.id] || Number(track.durationSeconds) || 0
          const progress = duration ? Math.min(100, ((currentTime[track.id] || 0) / duration) * 100) : 0
          return (
            <div key={track.id} className="card-spiritual overflow-hidden">
              <div className="flex gap-3 sm:gap-4 p-4 items-center">
                <div className="relative flex-shrink-0">
                  <img src={track.cover || track.img || 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop'} alt={track.title || 'Song'} className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover shadow-md" />
                  <button onClick={() => togglePlay(track)} className={`absolute inset-0 flex items-center justify-center rounded-xl ${playing === track.id ? 'bg-purple-600/90' : 'bg-black/40'}`} aria-label={`${playing === track.id ? 'Pause' : 'Play'} ${track.title}`}><span className="text-white text-2xl">{playing === track.id ? '⏸' : '▶'}</span></button>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold truncate">{track.title}</h3>
                  <p className="text-sm text-neutral-600 truncate">{track.artist || 'Harvest Music'}</p>
                  {playing === track.id && <div className="mt-2"><div className="h-1 bg-neutral-300 rounded-full overflow-hidden"><div className="h-full bg-purple-600" style={{ width: `${progress}%` }} /></div><div className="mt-1 flex justify-between text-[10px] text-neutral-500"><span>{formatTime(currentTime[track.id] || 0)}</span><span>{duration ? formatTime(duration) : track.duration || '—'}</span></div></div>}
                  <span className="inline-flex mt-2 text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">{String(track.type || 'worship').replace(/^./, c => c.toUpperCase())}</span>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => togglePlay(track)} className="btn-primary py-2 px-3 text-sm min-w-[48px]" aria-label={`${playing === track.id ? 'Pause' : 'Play'} ${track.title}`}>{playing === track.id ? '⏸' : '▶'}</button>
                  <button onClick={() => onAdd?.(track)} className="btn-secondary py-2 px-3 text-sm min-w-[48px]" title="Add to story or post" aria-label={`Add ${track.title} to a story or post`}>＋</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
