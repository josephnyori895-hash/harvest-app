import { useState, useEffect } from 'react'

const HARVEST_SONGS = [
  { id: 'h1', title: 'Compelled Anthem', artist: 'Harvest Worship', type: 'worship' as const, emoji: '🎵', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'h2', title: 'Raise Me Up', artist: 'Grace & Team', type: 'praise' as const, emoji: '🎶', link: 'https://www.youtube.com/watch?v=L_iAeFoAqQE', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'h3', title: 'Released', artist: 'Youth Harvest', type: 'choir' as const, emoji: '🙌', link: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'h4', title: 'Great Is Thy Faithfulness', artist: 'Hillsong', type: 'worship' as const, emoji: '🎤', link: 'https://www.youtube.com/watch?v=kHzvc2sJ9xA', cover: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'h5', title: 'Way Maker', artist: 'Sinach', type: 'worship' as const, emoji: '🔥', link: 'https://www.youtube.com/watch?v=eY52kIB5HyI', cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: 'h6', title: 'Amazing Grace', artist: 'John Newton', type: 'hymn' as const, emoji: '❤️', link: 'https://www.youtube.com/watch?v=al1Km9a1Bco', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  { id: 'h7', title: 'It Is Well', artist: 'Hymns of Hope', type: 'hymn' as const, emoji: '🙏', link: 'https://www.youtube.com/watch?v=UB1O2F7J1mE', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3' },
  { id: 'h8', title: 'Blessed Be Your Name', artist: 'Matt Redman', type: 'worship' as const, emoji: '🎹', link: 'https://www.youtube.com/watch?v=1S9aYf3W3wI', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3' },
]

const LOCAL_SONGS = [
  { id: 'l1', title: 'Amazing Grace (Local)', artist: 'On this device', type: 'hymn' as const, emoji: '🎵', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'l2', title: 'Way Maker (Local)', artist: 'On this device', type: 'worship' as const, emoji: '🎶', link: 'https://www.youtube.com/watch?v=L_iAeFoAqQE', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'l3', title: 'Compelled (Local)', artist: 'On this device', type: 'choir' as const, emoji: '🙌', link: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
]

const GENRE_EMOJIS: Record<string, string> = { worship: '🙏', praise: '🎵', hymn: '🎶', youth: '🔥', gospel: '❤️', choral: '🎹', traditional: '🎤' }

export default function Music({ musics, onAdd }: { musics: any[]; onAdd: (m: any) => void }) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'foryou' | 'local' | 'online'>('foryou')
  const [catTab, setCatTab] = useState<'all' | 'worship' | 'choir' | 'hymn'>('all')
  const [online, setOnline] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [playingAudio, setPlayingAudio] = useState<HTMLAudioElement | null>(null)

  const searchOnline = async (term: string) => {
    if (!term.trim()) { setOnline([]); return }
    setLoading(true)
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=12`)
      const j = await r.json()
      const res = j.results.map((x: any) => ({
        id: x.trackId, title: x.trackName, artist: x.artistName,
        emoji: '🎵',
        link: `https://music.apple.com/us/album/${x.trackName}/${x.collectionId}`,
        cover: x.artworkUrl100?.replace('100x100', '200x200'),
        url: x.previewUrl || `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${Math.floor(Math.random()*8)+1}.mp3`
      }))
      setOnline(res)
    } catch { setOnline([]) }
    setLoading(false)
  }

  const filteredLocal = LOCAL_SONGS.filter(m => (m.title.toLowerCase().includes(q.toLowerCase()) || m.artist.toLowerCase().includes(q.toLowerCase())) && (catTab === 'all' || m.type === catTab))
  const filteredHarvest = HARVEST_SONGS.filter(m => (m.title.toLowerCase().includes(q.toLowerCase()) || m.artist.toLowerCase().includes(q.toLowerCase())) && (catTab === 'all' || m.type === catTab))
  const filteredOnline = online

  const togglePlay = (m: any) => {
    if (playingAudio) { playingAudio.pause(); setPlayingAudio(null) }
    if (playing === m.id) { setPlaying(null); return }
    const a = new Audio(m.url)
    a.play().catch(() => {})
    setPlayingAudio(a)
    setPlaying(m.id)
    a.onended = () => { setPlaying(null); setPlayingAudio(null) }
  }

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex justify-between items-center"><h1 className="font-bold text-lg">🎵 Harvest Music</h1><span className="text-xs bg-zinc-800 px-2 py-1 rounded-full">🎶 Worship 🔥</span></div>
        <div className="mt-3 flex items-center gap-2 bg-zinc-900 rounded-xl px-3 py-2.5 border border-zinc-800">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
          <input value={q} onChange={e => { setQ(e.target.value); if (tab === 'online') searchOnline(e.target.value) }} onKeyDown={e => e.key === 'Enter' && searchOnline(q)} placeholder="Search songs 🎵 🎶 🔥 🙏" className="bg-transparent outline-none text-sm flex-1 placeholder:text-zinc-500" />
          {q && <button onClick={() => { setQ(''); setOnline([]) }} className="text-zinc-500 text-xs">✕</button>}
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {[['foryou', '🎵 For You'], ['local', '🎧 Local'], ['online', '🎶 Online']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as any)} className={`px-4 py-1.5 rounded-full text-xs font-semibold ${tab === t ? 'bg-white text-black' : 'bg-zinc-800 text-white'}`}>{label}</button>
          ))}
        </div>
        {/* Church category filter */}
        <div className="flex gap-2 mt-2 flex-wrap">
          {[['all', '🎵 All'], ['worship', '🙏 Worship'], ['choir', '🎶 Choir'], ['hymn', '🎹 Hymns']].map(([c, label]) => (
            <button key={c} onClick={() => setCatTab(c as any)} className={`px-3 py-1 rounded-full text-[10px] font-bold ${catTab === c ? 'bg-[#0095f6] text-white' : 'bg-zinc-800 text-zinc-400'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {tab === 'foryou' && <div className="space-y-3">
          <p className="text-xs text-zinc-500">Harvest Collection • 🎵🎶🔥🙏 {filteredHarvest.length} songs</p>
          {filteredHarvest.map(m => (
            <div key={m.id} className="flex gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 transition cursor-pointer">
              <div className="relative">
                <img src={m.cover} alt="" className="w-14 h-14 rounded-lg object-cover" />
                <span className="absolute -top-1 -right-1 text-lg">{m.emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><p className="text-sm font-semibold truncate">{m.title}</p><span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-400">{GENRE_EMOJIS[m.id.slice(0,2)] || '🎵'}</span></div>
                <p className="text-xs text-zinc-400">{m.artist}</p>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => togglePlay(m)} className="w-8 h-8 rounded-full bg-[#0095f6] flex items-center justify-center text-xs">{playing === m.id ? '⏸' : '▶'}</button>
                  <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-[#0095f6] text-xs hover:underline">🎥 Watch on YouTube</a>
                  <button onClick={() => { try { if(m.url){ const a=new Audio(m.url); a.play().catch(()=>{}) } } catch{} }} className="text-xs bg-zinc-800 text-white px-2 py-1 rounded-full">▶</button>
                </div>
              </div>
            </div>
          ))}
          {filteredHarvest.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No Harvest songs match "{q}"</p>}
        </div>}
        {tab === 'local' && <div className="space-y-3">
          <p className="text-xs text-zinc-500">🎧 On this device • {filteredLocal.length} found {q && `for "${q}"`}</p>
          {filteredLocal.map(m => (
            <div key={m.id} className="flex gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="relative"><img src={m.cover} alt="" className="w-14 h-14 rounded-lg object-cover" /><span className="absolute -top-1 -right-1 text-lg">{m.emoji}</span></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><p className="text-sm font-semibold truncate">{m.title}</p><span className="text-[10px] bg-green-900/50 px-1.5 py-0.5 rounded-full text-green-400">📱 LOCAL</span></div>
                <p className="text-xs text-zinc-400">{m.artist} • 📱 On this device</p>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => togglePlay(m)} className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-xs">{playing === m.id ? '⏸' : '▶'}</button>
                  <audio controls src={m.url} className="flex-1 h-6" preload="none" onPlay={() => setPlaying(m.id)} onPause={() => setPlaying(null)} />
                </div>
              </div>
            </div>
          ))}
        </div>}
        {tab === 'online' && <div className="space-y-3">
          <p className="text-xs text-zinc-500">{q ? `🎶 Online results for "${q}" • ${online.length} songs` : 'Type to search 🎵🎶🎤🎧'}</p>
          {loading && <p className="text-sm text-zinc-400 text-center py-4">🎵 Searching iTunes…</p>}
          {!loading && online.length === 0 && q && <p className="text-sm text-zinc-500 text-center py-8">No results — try "Hillsong", "Maverick", "Elevation", "Harvest"</p>}
          {!loading && online.length === 0 && !q && <div className="text-center py-8"><p className="text-sm text-zinc-400">🎵 Try searching</p><div className="flex gap-2 justify-center mt-3 flex-wrap">{['Hillsong', 'Maverick', 'Elevation', 'Harvest', 'Sinach'].map(t => <button key={t} onClick={() => { setQ(t); searchOnline(t) }} className="px-3 py-1.5 rounded-full bg-zinc-800 text-xs">{t}</button>)}</div></div>}
          {filteredOnline.map(m => (
            <div key={m.id} className="flex gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="relative"><img src={m.cover} alt="" className="w-14 h-14 rounded-lg object-cover" /><span className="absolute -top-1 -right-1 text-lg">{m.emoji}</span></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{m.title}</p>
                <p className="text-xs text-zinc-400 truncate">{m.artist}</p>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => togglePlay(m)} className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center text-xs">▶</button>
                  <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-[#0095f6] text-xs hover:underline">🎵 Apple Music</a>
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-[#0095f6] text-xs hover:underline">🎧 Preview</a>
                </div>
              </div>
            </div>
          ))}
        </div>}
      </div>
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-zinc-500 whitespace-nowrap">🎵 🎶 🎤 🎧 🎹 🎸 🔥 🙏 ❤️ 🤍 🎙️</span>
        {['🎵','🎶','🎤','🎧','🎹','🎸','🔥','🙏','❤️','🤍','🎙️'].map(e => (
          <button key={e} onClick={() => { setQ(e); searchOnline(e) }} className="text-lg px-2 py-1 rounded-full bg-zinc-800 hover:bg-zinc-700">{e}</button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-600 text-center py-2 border-t border-zinc-800">🎵 Local ↔ Online unified search • Harvest Family Church Nyeri 🎶</p>
    </div>
  )
}
