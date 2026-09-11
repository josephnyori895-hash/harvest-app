import { useState, useRef } from 'react'
import { IgIcon } from './Icons'

const HARVEST_SONGS = [
  { id: 'h1', title: 'Compelled Anthem', artist: 'Harvest Worship', type: 'worship', duration: '3:45', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'h2', title: 'Raise Me Up', artist: 'Grace & Team', type: 'praise', duration: '4:12', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'h3', title: 'Released', artist: 'Youth Harvest', type: 'choir', duration: '3:28', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'h4', title: 'Great Is Thy Faithfulness', artist: 'Hillsong', type: 'worship', duration: '5:04', cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'h5', title: 'Way Maker', artist: 'Sinach', type: 'worship', duration: '4:33', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
]

export default function Music({ musics: _musics, onAdd }: { musics: any[]; onAdd: (m: any) => void }) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'trending' | 'local'>('trending')
  const [playing, setPlaying] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState<Record<string, number>>({})
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({})

  const filteredSongs = HARVEST_SONGS.filter(m =>
    m.title.toLowerCase().includes(q.toLowerCase()) || m.artist.toLowerCase().includes(q.toLowerCase())
  )

  const togglePlay = (track: any) => {
    if (playing === track.id) {
      audioRefs.current[track.id]?.pause()
      setPlaying(null)
    } else {
      Object.values(audioRefs.current).forEach(a => a?.pause())
      const audio = new Audio(track.url)
      audio.onended = () => setPlaying(null)
      audio.ontimeupdate = () => setCurrentTime(prev => ({ ...prev, [track.id]: audio.currentTime }))
      audioRefs.current[track.id] = audio
      audio.play()
      setPlaying(track.id)
    }
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-[#FFFBF0] text-neutral-900">
      <div className="relative overflow-hidden bg-gradient-to-br from-purple-700 via-purple-600 to-amber-500 px-4 pb-7 pt-5 text-white shadow-lg">
        <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-amber-300/20 blur-2xl" />
        <div className="absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-teal-300/20 blur-2xl" />
        <div className="relative mx-auto max-w-2xl">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/20 backdrop-blur">
                <span className="text-2xl">♫</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">Harvest Family</p>
                <h1 className="text-2xl font-extrabold tracking-tight text-white">Music</h1>
              </div>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold tracking-wider ring-1 ring-white/20">WORSHIP</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-purple-50">Songs for worship, prayer and everyday moments with the family.</p>

          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-amber-300">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-700"><IgIcon name="search" size={20} /></div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs or artists" className="min-w-0 flex-1 bg-transparent px-1 text-sm font-medium text-neutral-900 outline-none placeholder:text-neutral-400" />
            {q && <button onClick={() => setQ('')} className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200" aria-label="Clear search">×</button>}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-4 pb-8 pt-5">
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {[['trending', 'Trending Worship'], ['local', 'Local Music']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as 'trending' | 'local')} className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-bold transition-all ${tab === t ? 'bg-gradient-to-r from-purple-600 to-amber-500 text-white shadow-md shadow-purple-200' : 'bg-white text-neutral-600 ring-1 ring-neutral-200 hover:ring-purple-200'}`}>
              {t === 'trending' ? '✦ ' : '◉ '}{label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex items-end justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-purple-600">Your soundtrack</p><h2 className="mt-1 text-xl font-extrabold tracking-tight">Worship picks</h2></div>
          <span className="text-xs font-semibold text-neutral-400">{filteredSongs.length} songs</span>
        </div>

        {filteredSongs.length === 0 ? (
          <div className="rounded-3xl border border-purple-100 bg-white px-6 py-14 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-purple-100 text-3xl">♫</div>
            <p className="font-bold text-neutral-800">No songs found</p><p className="mt-1 text-sm text-neutral-500">Try another song or artist.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSongs.map((track, index) => {
              const progress = Math.min(100, ((currentTime[track.id] || 0) / 225) * 100)
              return (
                <div key={track.id} className={`group overflow-hidden rounded-3xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${playing === track.id ? 'border-purple-200 shadow-purple-100' : 'border-neutral-100'}`}>
                  <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
                    <div className="relative h-20 w-20 flex-shrink-0 sm:h-24 sm:w-24">
                      <img src={track.cover} alt={track.title} className="h-full w-full rounded-2xl object-cover shadow-sm" />
                      <button onClick={() => togglePlay(track)} className={`absolute inset-0 flex items-center justify-center rounded-2xl transition-all ${playing === track.id ? 'bg-purple-700/85' : 'bg-black/20 group-hover:bg-purple-700/70'}`} aria-label={playing === track.id ? `Pause ${track.title}` : `Play ${track.title}`}>
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg text-purple-700 shadow-lg">{playing === track.id ? 'Ⅱ' : '▶'}</span>
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 py-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">#{index + 1} • {track.type}</span><h3 className="mt-1 truncate text-base font-extrabold text-neutral-900 sm:text-lg">{track.title}</h3><p className="truncate text-sm text-neutral-500">{track.artist}</p></div>
                        <span className="hidden rounded-full bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 sm:inline-flex">{track.duration}</span>
                      </div>
                      {playing === track.id && <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-purple-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-purple-600 transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-1 flex justify-between text-[10px] font-semibold text-neutral-400"><span>Playing now</span><span>{track.duration}</span></div></div>}
                      <div className="mt-2 flex items-center gap-2"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold capitalize text-amber-700">{track.type}</span><span className="text-[10px] font-semibold text-neutral-400 sm:hidden">{track.duration}</span></div>
                    </div>

                    <div className="flex flex-col justify-center gap-2">
                      <button onClick={() => togglePlay(track)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-sm font-bold text-purple-700 transition hover:bg-purple-100" aria-label={playing === track.id ? 'Pause' : 'Play'}>{playing === track.id ? 'Ⅱ' : '▶'}</button>
                      <button onClick={() => onAdd?.(track)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-base text-amber-700 transition hover:bg-amber-100" title="Add to story/post" aria-label="Add to story or post">＋</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
