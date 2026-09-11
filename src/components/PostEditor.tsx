import { useEffect, useRef, useState } from 'react'

const FILTERS: Record<string, string> = {
  Original: 'none',
  Clarendon: 'saturate(1.2) contrast(1.1) brightness(1.05)',
  Juno: 'saturate(1.4) contrast(1.15) brightness(1.1)',
  Aden: 'saturate(1.3) brightness(.95)',
  Lark: 'saturate(.9) brightness(1.1)',
  Moody: 'saturate(.8) contrast(1.3) brightness(.85)',
  Valencia: 'saturate(1.5) contrast(1.1) brightness(1.1)',
  Perpetua: 'saturate(1.1) contrast(1.2) brightness(1.15)',
  Willow: 'saturate(.7) contrast(1.15) brightness(1.1)',
  Gingham: 'saturate(1.3) contrast(1.2) brightness(1.1)',
}
const STICKERS = ['🙏','🔥','❤️','🎵','🎤','📍','📷','✝️','🕊️','💜','👏','✨']

type Props = { post: any; onDone: () => void }

export default function PostEditor({ post, onDone }: Props) {
  const [caption, setCaption] = useState(post.caption || '')
  const [mediaType, setMediaType] = useState<'image'|'video'>(post.mediaType || (post.video ? 'video' : 'image'))
  const [mediaUrl, setMediaUrl] = useState(post.img || post.video || '')
  const [mediaName, setMediaName] = useState(post.mediaName || '')
  const [filter, setFilter] = useState(post.filter || 'Original')
  const [textOverlay, setTextOverlay] = useState(post.textOverlay || '')
  const [textColor, setTextColor] = useState(post.textColor || '#ffffff')
  const [textBold, setTextBold] = useState(!!post.textBold)
  const [stickers, setStickers] = useState<string[]>(Array.isArray(post.stickers) ? post.stickers : [])
  const [music, setMusic] = useState<any|null>(post.music || null)
  const [hashtags, setHashtags] = useState(post.hashtags || '')
  const [location, setLocation] = useState(post.location || post.loc || '')
  const [tagUsers, setTagUsers] = useState<string[]>(Array.isArray(post.tagUsers) ? post.tagUsers : [])
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const audioRef = useRef<HTMLAudioElement|null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  const chooseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setMediaType(f.type.startsWith('video/') ? 'video' : 'image')
    setMediaName(f.name)
    const reader = new FileReader()
    reader.onload = () => setMediaUrl(String(reader.result))
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const toggleSticker = (s: string) => setStickers(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const searchMusic = async () => {
    const q = musicQuery.trim()
    if (!q) return
    setMusicLoading(true)
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=10`)
      const j = await r.json()
      setMusicResults((j.results || []).map((x:any) => ({ id:x.trackId, title:x.trackName, artist:x.artistName, cover:x.artworkUrl100?.replace('100x100','200x200'), url:x.previewUrl, link:`https://music.apple.com/track/${x.trackId}` })))
    } catch { setMusicResults([]) }
    finally { setMusicLoading(false) }
  }

  const toggleMusicPreview = (m:any) => {
    if (!m?.url) return
    if (playing && audioRef.current) { audioRef.current.pause(); setPlaying(false); return }
    const audio = new Audio(m.url)
    audioRef.current = audio
    audio.onended = () => setPlaying(false)
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  const save = () => {
    if (saving) return
    if (!mediaUrl) { alert('Add a photo or video first'); return }
    setSaving(true)
    try {
      const current = JSON.parse(localStorage.getItem('harvest_approved_posts') || '[]')
      const updatedPost = {
        ...post,
        img: mediaType === 'image' ? mediaUrl : post.img,
        video: mediaType === 'video' ? mediaUrl : undefined,
        mediaType,
        mediaName,
        filter,
        textOverlay,
        textColor,
        textBold,
        stickers,
        music,
        caption: caption.trim(),
        hashtags,
        location,
        loc: location || post.loc,
        tagUsers,
        editedAt: new Date().toISOString(),
      }
      const id = post.id
      const result = current.map((p:any) => p.id === id ? updatedPost : p)
      localStorage.setItem('harvest_approved_posts', JSON.stringify(result))
      window.dispatchEvent(new Event('harvest:approved'))
      alert('Post updated ✓')
      onDone()
    } catch {
      alert('Could not save the post')
    } finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4">
    <div className="w-full max-w-lg max-h-[96vh] overflow-y-auto bg-zinc-50 text-zinc-900 rounded-2xl shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between h-14 px-4 bg-white border-b border-zinc-200">
        <button onClick={onDone} className="text-xl" aria-label="Close editor">‹</button>
        <b className="text-sm">Edit post</b>
        <button onClick={save} disabled={saving} className="text-[#0095f6] font-semibold text-sm disabled:opacity-40">{saving ? 'Saving…' : 'Done'}</button>
      </div>

      <div className="p-3 bg-black">
        <div className="relative aspect-square max-h-[55vh] mx-auto overflow-hidden bg-zinc-900 rounded-xl">
          {mediaType === 'video' ? <video src={mediaUrl} controls playsInline className="w-full h-full object-cover" style={{filter:FILTERS[filter] || 'none'}} /> : <img src={mediaUrl} alt="Post preview" className="w-full h-full object-cover" style={{filter:FILTERS[filter] || 'none'}} />}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/50 via-transparent to-black/10" />
          {textOverlay && <div className="absolute left-5 right-5 top-1/2 -translate-y-1/2 text-center text-2xl pointer-events-none" style={{color:textColor,fontWeight:textBold?800:500}}>{textOverlay}</div>}
          {stickers.length > 0 && <div className="absolute top-4 left-3 right-3 flex flex-wrap justify-center gap-2 text-3xl pointer-events-none">{stickers.map(s => <span key={s}>{s}</span>)}</div>}
          {music && <div className="absolute bottom-3 left-3 right-3 bg-black/70 text-white rounded-full px-3 py-2 text-xs truncate">🎵 {music.title} · {music.artist}</div>}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <label className="block bg-white border border-zinc-200 rounded-xl p-3 cursor-pointer"><span className="text-xs font-semibold">📷 Replace media</span><input type="file" accept="image/*,video/*" onChange={chooseFile} className="hidden"/><span className="block text-[11px] text-zinc-400 mt-1">Current: {mediaName || mediaType}</span></label>

        <section className="bg-white border border-zinc-200 rounded-xl p-2">
          <button onClick={() => {setShowFilters(v=>!v);setShowStickers(false);setShowMusic(false)}} className="w-full text-left text-xs text-[#0095f6] font-semibold">🎨 Filter · {filter}</button>
          {showFilters && <div className="flex gap-2 overflow-x-auto py-2">{Object.keys(FILTERS).map(f => <button key={f} onClick={() => {setFilter(f);setShowFilters(false)}} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filter===f?'bg-[#0095f6] text-white':'bg-zinc-100'}`}>{f}</button>)}</div>}
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl p-2">
          <button onClick={() => {setShowStickers(v=>!v);setShowFilters(false);setShowMusic(false)}} className="w-full text-left text-xs text-[#0095f6] font-semibold">✨ Stickers · {stickers.length || 'none'}</button>
          {showStickers && <div className="flex flex-wrap gap-2 py-2">{STICKERS.map(s => <button key={s} onClick={() => toggleSticker(s)} className={`text-xl px-2 py-1 rounded-full ${stickers.includes(s)?'bg-[#0095f6]':'bg-zinc-100'}`}>{s}</button>)}</div>}
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl p-2">
          <button onClick={() => {setShowMusic(v=>!v);setShowFilters(false);setShowStickers(false)}} className="w-full text-left text-xs text-[#0095f6] font-semibold">🎵 Music {music ? `· ${music.title}` : ''}</button>
          {showMusic && <div className="pt-2">
            {music && <div className="flex items-center gap-2 p-2 bg-zinc-50 rounded-lg mb-2"><img src={music.cover} alt="" className="w-9 h-9 rounded"/><div className="flex-1 min-w-0"><b className="text-xs truncate block">{music.title}</b><span className="text-[11px] text-zinc-400 truncate block">{music.artist}</span></div><button onClick={() => toggleMusicPreview(music)}>{playing?'⏸':'▶'}</button><button onClick={() => setMusic(null)} className="text-red-400">✕</button></div>}
            <div className="flex gap-2"><input value={musicQuery} onChange={e=>setMusicQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchMusic()} placeholder="Search music…" className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-3 py-2 text-xs"/><button onClick={searchMusic} className="px-3 rounded-full bg-[#0095f6] text-white text-xs">Search</button></div>
            {musicLoading && <p className="text-xs text-zinc-500 text-center py-2">Searching…</p>}
            <div className="space-y-1 mt-2">{musicResults.map(m=><div key={m.id} className="flex items-center gap-2 p-2 bg-zinc-50 rounded-lg"><img src={m.cover} alt="" className="w-9 h-9 rounded"/><div className="flex-1 min-w-0"><b className="text-xs truncate block">{m.title}</b><span className="text-[11px] text-zinc-400 truncate block">{m.artist}</span></div><button onClick={()=>toggleMusicPreview(m)} className="text-xs">▶</button><button onClick={()=>{setMusic(m);setMusicResults([]);setShowMusic(false)}} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Use</button></div>)}</div>
          </div>}
        </section>

        <section className="bg-white border border-zinc-200 rounded-xl p-3">
          <div className="flex justify-between"><span className="text-xs font-semibold">✏️ Text overlay</span><button onClick={()=>setTextBold(v=>!v)} className={`text-xs px-2 py-1 rounded-full ${textBold?'bg-[#0095f6] text-white':'bg-zinc-100'}`}>B</button></div>
          <input value={textOverlay} onChange={e=>setTextOverlay(e.target.value)} placeholder="Text on media…" className="mt-2 w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm"/>
          <div className="flex gap-2 mt-2">{['#ffffff','#000000','#0095f6','#ed4956','#f77737','#40d657','#b546cf'].map(c=><button key={c} onClick={()=>setTextColor(c)} className="w-6 h-6 rounded-full border-2 border-white shadow" style={{backgroundColor:c}} aria-label={`Text color ${c}`}/>)}</div>
        </section>

        <textarea value={caption} onChange={e=>setCaption(e.target.value.slice(0,2200))} placeholder="Write a caption…" className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-sm min-h-24" />
        <div className="text-right text-[11px] text-zinc-400">{caption.length}/2200</div>
        <input value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder="#harvest #church #nyeri" className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-sm" />
        <input value={location} onChange={e=>setLocation(e.target.value)} placeholder="📍 Add location" className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-sm" />
        <input value={tagUsers.join(', ')} onChange={e=>setTagUsers(e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Tag people, separated by commas" className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={save} disabled={saving} className="w-full rounded-xl bg-[#0095f6] text-white font-semibold py-3 disabled:opacity-40">{saving?'Saving…':'Save changes'}</button>
      </div>
    </div>
  </div>
}
