import { useState, useEffect, useRef } from 'react'
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
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({})

  const filteredSongs = HARVEST_SONGS.filter(m =>
    m.title.toLowerCase().includes(q.toLowerCase()) ||
    m.artist.toLowerCase().includes(q.toLowerCase())
  )

  const togglePlay = (track: any) => {
    if (playing === track.id) {
      audioRefs.current[track.id]?.pause()
      setPlaying(null)
    } else {
      Object.values(audioRefs.current).forEach(a => a?.pause())
      const audio = new Audio(track.url)
      audio.onended = () => setPlaying(null)
      audio.ontimeupdate = () => {
        setCurrentTime(prev => ({ ...prev, [track.id]: audio.currentTime }))
      }
      audioRefs.current[track.id] = audio
      audio.play()
      setPlaying(track.id)
    }
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-gradient-to-b from-amber-50 to-purple-50 text-neutral-900">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-neutral-200 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-white font-bold">🎵</div>
            <h1 className="text-xl font-extrabold text-gradient-warm">Harvest Music</h1>
          </div>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-purple-100 text-purple-700">WORSHIP</span>
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 flex items-center gap-2 bg-white border-2 border-neutral-200 rounded-xl px-3 py-2.5 focus-within:border-purple-500 transition">
            <IgIcon name="search" size={20} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search songs, artists..."
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          {q && (
            <button
              onClick={() => setQ('')}
              className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center hover:bg-neutral-300 transition"
            >
              ✕
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {[
            ['trending', '🔥 Trending Worship'],
            ['local', '🎧 Local Music'],
          ].map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
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

      {/* Content */}
      <div className="px-4 py-6 space-y-4">
        {filteredSongs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🎵</div>
            <p className="text-neutral-500 font-medium">No songs found</p>
            <p className="text-sm text-neutral-400">Try searching "Worship" or artist names</p>
          </div>
        ) : (
          filteredSongs.map((track) => (
            <div
              key={track.id}
              className="card-spiritual hover:shadow-xl transition-all duration-300 overflow-hidden group"
            >
              <div className="flex gap-4 p-4">
                {/* Album Art */}
                <div className="relative flex-shrink-0">
                  <img
                    src={track.cover}
                    alt={track.title}
                    className="w-20 h-20 rounded-xl object-cover shadow-md group-hover:scale-105 transition-transform"
                  />
                  <button
                    onClick={() => togglePlay(track)}
                    className={`absolute inset-0 flex items-center justify-center rounded-xl transition-all ${
                      playing === track.id
                        ? 'bg-purple-600/90'
                        : 'bg-black/40 group-hover:bg-purple-600/80'
                    }`}
                  >
                    <span className="text-white text-2xl">
                      {playing === track.id ? '⏸' : '▶'}
                    </span>
                  </button>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <h3 className="font-bold text-neutral-900 truncate group-hover:text-gradient-warm">
                    {track.title}
                  </h3>
                  <p className="text-sm text-neutral-600 truncate">{track.artist}</p>
                  
                  {/* Progress Bar */}
                  {playing === track.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-neutral-300 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-400 to-purple-600 transition-all"
                          style={{ width: `${((currentTime[track.id] || 0) / 225) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-neutral-500 font-mono">{track.duration}</span>
                    </div>
                  )}

                  {/* Type Badge */}
                  <div className="flex gap-2 mt-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      track.type === 'worship'
                        ? 'badge-admin'
                        : track.type === 'praise'
                        ? 'bg-blue-100 text-blue-700'
                        : 'badge-member'
                    }`}>
                      {track.type.charAt(0).toUpperCase() + track.type.slice(1)}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2 justify-center">
                  <button
                    onClick={() => togglePlay(track)}
                    className="btn-primary py-2 px-4 text-sm"
                  >
                    {playing === track.id ? '⏸' : '▶'}
                  </button>
                  <button
                    onClick={() => onAdd?.(track)}
                    className="btn-secondary py-2 px-4 text-sm"
                    title="Add to story/post"
                  >
                    ➕
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
