import { useState, useMemo, useRef } from 'react'

const reelsData = [
  { user: 'allan', cap: 'Sunday highlight — Compelled 🔥', views: '12.4k', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
  { user: 'youth_harvest', cap: 'Youth worship moment 🙏', views: '8.2k', img: 'https://images.unsplash.com/photo-1516450360452-9312abbf86c1?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4' },
  { user: 'pst.grace', cap: 'Daily verse — Jeremiah 29:11', views: '5.1k', img: 'https://images.unsplash.com/photo-1527525443983-6e60c75fff46?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4' },
]
export default function Reels() {
  const [idx, setIdx] = useState(0)
  const approvedReels: any[] = useMemo(() => { try { return JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]') } catch { return [] } }, [])
  const allReels = useMemo(() => [...approvedReels, ...reelsData], [approvedReels])
  const cur = allReels[idx] ?? reelsData[0]
  return (
    <div className="bg-black text-white relative h-[70vh] overflow-hidden">
      <div className="absolute top-3 left-4 z-10 flex items-center gap-2"><span className="font-bold">Reels</span><span className="text-xs bg-white text-black px-2 py-0.5 rounded-full">Harvest</span></div>
      <div className="h-full relative">
        {cur.video ? <video src={cur.video} autoPlay muted loop playsInline className="w-full h-full object-cover" poster={cur.img} /> : <img src={cur.img} alt="" className="w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute bottom-4 left-4 right-16">
          <p className="font-semibold text-sm flex items-center gap-1">{cur.user} <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span> • Follow</p>
          <p className="text-sm mt-1">{cur.cap}</p>
          <p className="text-xs text-zinc-300 mt-1">♫ {cur.music?cur.music.title+' • '+cur.music.artist:'Original audio'} • {cur.views} views</p>
          {cur.music && <div className="flex gap-2 items-center mt-2 p-2 bg-black/60 rounded-lg"><img src={cur.music.cover} className="w-8 h-8 rounded"/><div><p className="text-xs">🎵 {cur.music.title}</p><p className="text-[11px] text-zinc-400">{cur.music.artist}</p></div><a href={cur.music.url} target="_blank" className="text-xs bg-white text-black px-2 py-1 rounded-full">▶</a></div>}
        </div>
        <div className="absolute right-3 bottom-20 flex flex-col gap-6 items-center">
          <div className="flex flex-col items-center"><span className="text-2xl">♡</span><span className="text-xs">{cur.views}</span></div>
          
          <div className="flex flex-col items-center"><span className="text-xl">↗</span></div>
          <div className="w-8 h-8 rounded bg-zinc-700 border-2 border-white overflow-hidden"><img src={cur.img} alt="" className="w-full h-full object-cover" /></div>
        </div>
        <button onClick={() => setIdx((idx + 1) % allReels.length)} className="absolute inset-0" aria-label="next reel" />
      </div>
      <p className="text-xs text-zinc-500 text-center py-2">Tap to next • Swipe for more • {idx + 1}/{allReels.length}</p>
    </div>
  )
}


const REEL_FILTERS = ['Original', 'Clarendon', 'Moody', 'Valencia', 'Willow', 'Gingham', 'Aden', 'Lark']
const REEL_MUSIC = [
  { id: 'r1', title: 'Worship Vibes', artist: 'Harvest Worship', emoji: '🎵', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'r2', title: 'Praise Rising', artist: 'Grace Team', emoji: '🎶', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 'r3', title: 'Fire Faith', artist: 'Youth Harvest', emoji: '🔥', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'r4', title: 'Hillsong Live', artist: 'Hillsong', emoji: '🎤', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: 'r5', title: 'Sinach', artist: 'Sinach', emoji: '❤️', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
]
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const REEL_STICKERS = ['🙏', '🔥', '❤️', '🎵', '🎤', '📍', '✝️', '🕊️', '💜', '👏']

export function ReelCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [filter, setFilter] = useState('Original')
  const [speed, setSpeed] = useState(1)
  const [musicTrack, setMusicTrack] = useState<any|null>(null)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [previewId, setPreviewId] = useState<any>(null)
  const previewRef = useRef<HTMLAudioElement|null>(null)
  const [stickers, setStickers] = useState<string[]>([])
  const [timer, setTimer] = useState(3)
  const [recording, setRecording] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchMusic=async(term:string)=>{ if(!term.trim()){setMusicResults([]);return} setMusicLoading(true); try{const r=await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=8`);const j=await r.json();setMusicResults(j.results.map((x:any)=>({id:x.trackId,title:x.trackName,artist:x.artistName,cover:x.artworkUrl100?.replace('100x100','200x200'),url:x.previewUrl})))}catch{setMusicResults([])} setMusicLoading(false)}
  const togglePreview=(m:any)=>{ if(previewId===m.id){previewRef.current?.pause();setPreviewId(null);return} if(previewRef.current) previewRef.current.pause(); const a=new Audio(m.url); a.play().catch(()=>{}); (previewRef as any).current=a; setPreviewId(m.id); a.onended=()=>setPreviewId(null)}
  const chooseMusic=(m:any)=>{setMusicTrack(m);setShowMusic(false);setMusicQuery('');setMusicResults([])}

  const getUser = () => {
    try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || 'allan' } catch { return 'allan' }
  }
  const onFile = (e: any) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => setFileUrl(reader.result as string)
    reader.readAsDataURL(f)
  }

  const addSticker = (s: string) => {
    if (!stickers.includes(s)) setStickers([...stickers, s])
  }
  const removeSticker = (s: string) => setStickers(stickers.filter(x => x !== s))

  const submit = () => {
    const reel = {
      id: Date.now(), user: getUser(), cap: caption || 'Harvest Reel 🙏',
      img: fileUrl || `https://picsum.photos/400/700?random=${Date.now()}`,
      video: fileUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      filter, speed, music:musicTrack, stickers, timer,
      views: '0', at: new Date().toISOString()
    }
    const approved = JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]')
    localStorage.setItem('harvest_approved_reels', JSON.stringify([reel, ...approved]))
    window.dispatchEvent(new Event('harvest:approved'))
    alert('Reel shared ✓')
    onDone()
  }

  const filteredMusic = REEL_MUSIC.filter(m => !music || m.title.toLowerCase().includes(music.toLowerCase()))

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col">
      <div className="flex justify-between items-center px-4 h-[56px] border-b border-zinc-800">
        <button onClick={onDone} className="text-xl">✕</button>
        <p className="font-semibold text-sm">Create Reel</p>
        <button onClick={submit} className="text-[#0095f6] font-semibold text-sm">Share</button>
      </div>

      {/* Video preview */}
      <div className="flex-1 flex items-center justify-center p-4">
        {!fileUrl ? (
          <label className="w-full aspect-[9/16] bg-zinc-900 rounded-2xl flex flex-col items-center justify-center border border-zinc-800 cursor-pointer border-dashed">
            <input ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" />
            <div className="w-20 h-20 rounded-full bg-[#0095f6] flex items-center justify-center text-4xl text-white">🎬</div>
            <p className="text-xs text-zinc-500 mt-2">Record or upload reel video</p>
            <p className="text-[10px] text-zinc-600 mt-1">Up to 60s • 1080p</p>
          </label>
        ) : (
          <div className="relative aspect-[9/16] w-full max-w-[320px] mx-auto overflow-hidden rounded-2xl border border-zinc-800">
            <video src={fileUrl} autoPlay muted loop playsInline className="w-full h-full object-cover rounded-2xl" />
            {filter !== 'Original' && <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">🎨 {filter}</div>}
            {fileName && <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">📎 {fileName}</div>}
            {stickers.length > 0 && (
              <div className="absolute bottom-8 left-4 flex gap-1">
                {stickers.map((s, i) => <span key={i} className="text-2xl bg-black/50 rounded-full px-1">{s}</span>)}
              </div>
            )}
            {musicTrack && (
              <div className="absolute top-14 right-4 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">🎵 {musicTrack.title}</div>
            )}
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="px-4 pb-2 space-y-2">
        {/* Record button */}
        <div className="flex justify-center gap-4 items-center">
          <button onClick={() => setRecording(!recording)} className={`w-14 h-14 rounded-full border-4 flex items-center justify-center text-2xl ${recording ? 'bg-red-600 border-red-600 animate-pulse' : 'bg-zinc-800 border-zinc-600'}`}>
            {recording ? '⏺' : '🎥'}
          </button>
        </div>

        {/* Filters */}
        {fileUrl && (
          <div>
            <button onClick={() => { setShowFilters(!showFilters); setShowMusic(false); setShowStickers(false) }} className="text-xs text-[#0095f6]">🎨 Filter: {filter}</button>
            {showFilters && (
              <div className="flex gap-2 overflow-x-auto pb-2 mt-1">
                {REEL_FILTERS.map(f => (
                  <button key={f} onClick={() => { setFilter(f); setShowFilters(false) }} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filter === f ? 'bg-[#0095f6] text-white' : 'bg-zinc-800'}`}>{f}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Speed */}
        <div>
          <p className="text-xs text-[#0095f6] mb-1">⚡ Speed</p>
          <div className="flex gap-2 overflow-x-auto">
            {SPEEDS.map(s => (
              <button key={s} onClick={() => setSpeed(s)} className={`px-3 py-1 rounded-full text-xs ${speed === s ? 'bg-[#0095f6] text-white' : 'bg-zinc-800'}`}>{s}x</button>
            ))}
          </div>
        </div>

        {/* Music - IG searchable */}
        <div className="border border-zinc-800 rounded-xl p-2">
          <button onClick={() => { setShowMusic(!showMusic); setShowFilters(false); setShowStickers(false) }} className="text-xs text-[#0095f6]">🎵 Add music {musicTrack?`• ${musicTrack.title} ✓`:''}</button>
          {musicTrack&&<div className="flex gap-2 items-center mt-2 p-2 bg-zinc-900 rounded-lg"><img src={musicTrack.cover} className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{musicTrack.title}</p><p className="text-[11px] text-zinc-400 truncate">{musicTrack.artist}</p></div><button onClick={()=>togglePreview(musicTrack)} className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-xs">{previewId===musicTrack.id?'⏸':'▶'}</button><button onClick={()=>setMusicTrack(null)} className="text-xs text-red-400">✕</button></div>}
          {showMusic&&<div className="mt-2"><div className="flex gap-2"><input value={musicQuery} onChange={e=>{setMusicQuery(e.target.value);searchMusic(e.target.value)}} placeholder="Search Hillsong/Maverick..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 text-xs outline-none"/><button onClick={()=>searchMusic(musicQuery)} className="px-3 py-2 rounded-full bg-white text-black text-xs">Search</button></div>{musicLoading&&<p className="text-xs text-center py-2">Searching…</p>}<div className="space-y-2 mt-2 max-h-40 overflow-auto">{musicResults.map((m:any)=><div key={m.id} className="flex gap-2 p-2 bg-zinc-900 rounded-lg items-center"><img src={m.cover} className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{m.title}</p><p className="text-[11px] text-zinc-400 truncate">{m.artist}</p></div><button onClick={()=>togglePreview(m)} className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs">{previewId===m.id?'⏸':'▶'}</button><button onClick={()=>chooseMusic(m)} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Use</button></div>)}</div></div>}
        </div>

        {/* Timer */}
        <div>
          <p className="text-xs text-[#0095f6] mb-1">⏱️ Countdown timer</p>
          <div className="flex gap-2">
            {[0, 3, 5, 10].map(s => (
              <button key={s} onClick={() => setTimer(s)} className={`px-3 py-1 rounded-full text-xs ${timer === s ? 'bg-[#0095f6] text-white' : 'bg-zinc-800'}`}>{s === 0 ? 'Off' : `${s}s`}</button>
            ))}
          </div>
        </div>

        {/* Stickers */}
        <div>
          <button onClick={() => { setShowStickers(!showStickers); setShowMusic(false); setShowFilters(false) }} className="text-xs text-[#0095f6]">📷 Stickers</button>
          {showStickers && (
            <div className="flex gap-2 overflow-x-auto pb-2 mt-1 flex-wrap">
              {REEL_STICKERS.map(s => (
                <button key={s} onClick={() => stickers.includes(s) ? removeSticker(s) : addSticker(s)} className={`text-xl px-2 py-1 rounded-full ${stickers.includes(s) ? 'bg-[#0095f6] text-white' : 'bg-zinc-800'}`}>{s}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Caption */}
      <div className="px-4 pb-4">
        <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Add caption..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none" />
      </div>
    </div>
  )
}
