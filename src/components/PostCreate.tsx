import { useEffect, useMemo, useRef, useState } from 'react'

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

type MediaKind = 'image' | 'video'
type Media = { url: string; name: string; kind: MediaKind }

type Props = { onDone: () => void; onSubmit?: (type: string, data: any) => void }

export default function PostCreate({ onDone, onSubmit }: Props) {
  const [caption, setCaption] = useState('')
  const [type, setType] = useState<'post'|'story'|'reel'>('post')
  const [media, setMedia] = useState<Media | null>(null)
  const [filter, setFilter] = useState('Original')
  const [textOverlay, setTextOverlay] = useState('')
  const [textColor, setTextColor] = useState('#ffffff')
  const [textBold, setTextBold] = useState(false)
  const [stickers, setStickers] = useState<string[]>([])
  const [hashtags, setHashtags] = useState('')
  const [location, setLocation] = useState('')
  const [tagUsers, setTagUsers] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [musicTrack, setMusicTrack] = useState<any | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [scheduled, setScheduled] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getUser = () => {
    try {
      const users = JSON.parse(localStorage.getItem('harvest_users') || '[]')
      return users[0]?.username || localStorage.getItem('harvest_username') || 'allan'
    } catch { return 'allan' }
  }
  const users = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('harvest_users') || '[]') } catch { return [] }
  }, [])
  const isVerified = !!users.find((u: any) => u.username === getUser())?.verified

  useEffect(() => () => { previewRef.current?.pause() }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const kind: MediaKind = f.type.startsWith('video/') ? 'video' : 'image'
    const reader = new FileReader()
    reader.onload = () => setMedia({ url: String(reader.result), name: f.name, kind })
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const resetMedia = () => {
    setMedia(null)
    setFilter('Original')
    setStickers([])
    setTextOverlay('')
    setMusicTrack(null)
    setScheduled(false)
  }

  const addSticker = (s: string) => setStickers(prev => prev.includes(s) ? prev : [...prev, s])
  const removeSticker = (s: string) => setStickers(prev => prev.filter(x => x !== s))

  const searchMusic = async (term: string) => {
    const q = term.trim()
    if (!q) { setMusicResults([]); return }
    setMusicLoading(true)
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=10`)
      const j = await r.json()
      setMusicResults((j.results || []).map((x: any) => ({
        id: x.trackId, title: x.trackName, artist: x.artistName,
        cover: x.artworkUrl100?.replace('100x100', '200x200'), url: x.previewUrl,
        link: `https://music.apple.com/track/${x.trackId}`,
      })))
    } catch { setMusicResults([]) }
    finally { setMusicLoading(false) }
  }

  const togglePreview = (m: any) => {
    if (!m?.url) return
    if (previewId === m.id) { previewRef.current?.pause(); setPreviewId(null); return }
    previewRef.current?.pause()
    const audio = new Audio(m.url)
    previewRef.current = audio
    setPreviewId(m.id)
    audio.play().catch(() => setPreviewId(null))
    audio.onended = () => setPreviewId(null)
  }

  const chooseMusic = (m: any) => {
    setMusicTrack(m)
    setShowMusic(false)
    setMusicQuery('')
    setMusicResults([])
  }

  const schedulePost = () => {
    if (!isVerified) { alert('Only verified accounts can schedule'); return }
    if (!media) { alert('Add a photo or video first'); return }
    setScheduled(true)
  }

  const submit = () => {
    if (isSubmitting) return
    if (!isVerified) { alert('Only verified accounts can post — ask Allan (admin) to verify you'); return }
    if (!media) { alert('Add a photo or video first'); return }
    setIsSubmitting(true)

    const id = `${getUser()}_${Date.now()}`
    const common = {
      id,
      user: getUser(),
      name: getUser(),
      caption: caption.trim() || 'Harvest testimony 🙏',
      img: media.kind === 'image' ? media.url : undefined,
      video: media.kind === 'video' ? media.url : undefined,
      mediaType: media.kind,
      mediaName: media.name,
      filter,
      textOverlay,
      textColor,
      textBold,
      stickers,
      music: musicTrack,
      hashtags,
      location,
      tagUsers,
      type,
      at: new Date().toISOString(),
    }

    if (type === 'story') {
      const approved = JSON.parse(localStorage.getItem('harvest_approved_stories') || '[]')
      localStorage.setItem('harvest_approved_stories', JSON.stringify([common, ...approved]))
      window.dispatchEvent(new Event('harvest:approved'))
      alert('Story posted instantly ✓')
      onDone()
      return
    }

    if (scheduled) {
      const queued = JSON.parse(localStorage.getItem('harvest_scheduled') || '[]')
      queued.push({ ...common, scheduledAt: new Date(Date.now() + 3600000).toISOString(), status: 'scheduled' })
      localStorage.setItem('harvest_scheduled', JSON.stringify(queued))
      alert('Post scheduled for later ✓')
      onDone()
      return
    }

    const postData = { ...common, type: type === 'reel' ? 'reel' : 'post' }
    if (onSubmit) { onSubmit(type, postData); onDone(); return }
    const pending = JSON.parse(localStorage.getItem('harvest_pending') || '[]')
    localStorage.setItem('harvest_pending', JSON.stringify([{ ...postData, status: 'pending' }, ...pending]))
    alert(type === 'reel' ? 'Reel submitted — admin will approve' : 'Feed post submitted — admin will approve')
    onDone()
  }

  const previewStyle = { filter: FILTERS[filter] || 'none' }

  return (
    <div className="bg-zinc-50 text-white min-h-[calc(100vh-49px)] flex flex-col">
      <div className="sticky top-0 z-20 flex justify-between items-center px-4 h-[56px] border-b border-zinc-200 bg-white">
        <button onClick={onDone} className="text-xl text-zinc-700" aria-label="Close">‹</button>
        <p className="font-semibold text-sm text-zinc-900">{type === 'story' ? 'Story' : type === 'reel' ? 'Create Reel' : 'New Post'}</p>
        <button onClick={submit} disabled={isSubmitting || !media} className="text-[#0095f6] font-semibold text-sm disabled:opacity-40">{isSubmitting ? 'Sharing…' : type === 'story' ? 'Share' : type === 'reel' ? 'Share Reel' : 'Post'}</button>
      </div>

      <div className="flex gap-1 px-4 pt-2 bg-white border-b border-zinc-200">
        {(['post','story','reel'] as const).map(t => (
          <button key={t} onClick={() => setType(t)} className={`px-4 py-2 rounded-full text-xs font-semibold ${type === t ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-700'}`}>
            {t === 'post' ? 'Feed' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="mt-3 px-4 flex justify-center">
        {!media ? (
          <label className="w-full max-w-[360px] aspect-[4/5] bg-white rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center cursor-pointer hover:border-[#0095f6] transition">
            <input ref={fileInputRef} type="file" accept={type === 'reel' ? 'video/*' : 'image/*,video/*'} onChange={onFile} className="hidden" />
            <div className="w-16 h-16 rounded-full bg-[#0095f6] flex items-center justify-center text-3xl text-white">＋</div>
            <p className="text-xs text-zinc-600 mt-2">{type === 'reel' ? 'Add a reel video' : 'Add photo or video'}</p>
            <p className="text-[11px] text-zinc-400 mt-1">Choose media, then edit it before sharing</p>
          </label>
        ) : (
          <div className="relative w-full max-w-[360px] aspect-[4/5] mx-auto rounded-xl overflow-hidden border border-zinc-200 shadow-lg bg-black">
            {media.kind === 'video' ? (
              <video src={media.url} controls playsInline className="w-full h-full object-cover" style={previewStyle} />
            ) : (
              <img src={media.url} alt="Selected media preview" className="w-full h-full object-cover object-center" style={previewStyle} />
            )}
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/50 via-transparent to-black/10" />
            {textOverlay && <div className="absolute left-5 right-5 top-1/2 -translate-y-1/2 text-center pointer-events-none" style={{ color: textColor, fontWeight: textBold ? 800 : 500 }}>{textOverlay}</div>}
            {stickers.length > 0 && <div className="absolute top-5 left-0 right-0 flex flex-wrap justify-center gap-2 pointer-events-none text-3xl">{stickers.map(s => <span key={s}>{s}</span>)}</div>}
            {musicTrack && <div className="absolute bottom-3 left-3 right-12 bg-black/70 text-white text-[10px] px-3 py-2 rounded-full truncate">🎵 {musicTrack.title} • {musicTrack.artist}</div>}
            <button onClick={resetMedia} className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center" aria-label="Remove media">✕</button>
            <span className="absolute top-3 left-3 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">{media.kind === 'video' ? 'VIDEO' : 'PHOTO'}{filter !== 'Original' ? ` • ${filter}` : ''}</span>
          </div>
        )}
      </div>

      {media && <div className="mt-2 px-4 space-y-1">
        <section className="bg-white rounded-xl border border-zinc-200 p-2">
          <button onClick={() => { setShowFilters(v => !v); setShowStickers(false); setShowMusic(false) }} className="text-xs text-[#0095f6] font-semibold">🎨 Filter · {filter}</button>
          {showFilters && <div className="flex gap-2 overflow-x-auto py-2">{Object.keys(FILTERS).map(f => <button key={f} onClick={() => { setFilter(f); setShowFilters(false) }} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filter === f ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-700'}`}>{f}</button>)}</div>}
        </section>

        <section className="bg-white rounded-xl border border-zinc-200 p-2">
          <button onClick={() => { setShowStickers(v => !v); setShowFilters(false); setShowMusic(false) }} className="text-xs text-[#0095f6] font-semibold">✨ Stickers · {stickers.length || 'none'}</button>
          {showStickers && <div className="flex gap-2 flex-wrap py-2">{STICKERS.map(s => <button key={s} onClick={() => stickers.includes(s) ? removeSticker(s) : addSticker(s)} className={`text-xl px-2 py-1 rounded-full ${stickers.includes(s) ? 'bg-[#0095f6]' : 'bg-zinc-100'}`}>{s}</button>)}</div>}
        </section>

        <section className="bg-white rounded-xl border border-zinc-200 p-2">
          <button onClick={() => { setShowMusic(v => !v); setShowFilters(false); setShowStickers(false) }} className="text-xs text-[#0095f6] font-semibold">🎵 Music {musicTrack ? `· ${musicTrack.title}` : ''}</button>
          {showMusic && <div className="mt-2">
            {musicTrack && <div className="flex items-center gap-2 mb-2 bg-zinc-50 rounded-lg p-2"><img src={musicTrack.cover} alt="" className="w-9 h-9 rounded"/><div className="flex-1 min-w-0 text-xs"><b className="block truncate">{musicTrack.title}</b><span className="text-zinc-400 truncate block">{musicTrack.artist}</span></div><button onClick={() => togglePreview(musicTrack)} className="w-7 h-7 rounded-full bg-white text-black">{previewId === musicTrack.id ? '⏸' : '▶'}</button><button onClick={() => setMusicTrack(null)} className="text-red-400">✕</button></div>}
            <div className="flex gap-2"><input value={musicQuery} onChange={e => { setMusicQuery(e.target.value); searchMusic(e.target.value) }} onKeyDown={e => e.key === 'Enter' && searchMusic(musicQuery)} placeholder="Search music…" className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-3 py-2 text-xs outline-none"/><button onClick={() => searchMusic(musicQuery)} className="px-3 py-2 rounded-full bg-[#0095f6] text-white text-xs">Search</button></div>
            {musicLoading && <p className="text-xs text-zinc-500 text-center py-2">Searching…</p>}
            <div className="space-y-1 mt-2 max-h-48 overflow-auto">{musicResults.map(m => <div key={m.id} className="flex gap-2 p-2 bg-zinc-50 rounded-lg items-center"><img src={m.cover} alt="" className="w-9 h-9 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{m.title}</p><p className="text-[11px] text-zinc-400 truncate">{m.artist}</p></div><button onClick={() => togglePreview(m)} className="w-7 h-7 rounded-full bg-white text-black text-xs">{previewId === m.id ? '⏸' : '▶'}</button><button onClick={() => chooseMusic(m)} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Use</button></div>)}</div>
          </div>}
        </section>

        <section className="bg-white rounded-xl border border-zinc-200 p-2">
          <p className="text-xs text-[#0095f6] font-semibold mb-1">✏️ Text overlay</p>
          <input value={textOverlay} onChange={e => setTextOverlay(e.target.value)} placeholder="Add text to your media…" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none" />
          <div className="flex gap-2 mt-2 items-center"><span className="text-xs text-zinc-400">Color</span>{['#ffffff','#0095f6','#ed4956','#f77737','#40d657','#b546cf','#000000'].map(c => <button key={c} onClick={() => setTextColor(c)} className="w-6 h-6 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: c }} aria-label={`Text color ${c}`} />)}<button onClick={() => setTextBold(v => !v)} className={`px-2 py-1 rounded-full text-xs font-bold ${textBold ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-600'}`}>B</button></div>
        </section>
      </div>}

      <div className="mt-2 px-4 space-y-2">
        {type === 'post' && <>
          <input value={hashtags} onChange={e => setHashtags(e.target.value)} placeholder="#harvest #church #nyeri" className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none" />
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="📍 Add location" className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none" />
          <input value={tagUsers.join(', ')} onChange={e => setTagUsers(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="Tag friends" className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none" />
        </>}
        <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={2200} rows={3} placeholder="Write a caption…" className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none resize-none" />
        <div className="flex justify-between text-[11px] text-zinc-400"><span>{caption.length}/2200</span><span>{media ? `${media.kind === 'video' ? 'Video' : 'Photo'} ready to share` : 'Add media to continue'}</span></div>
        {!isVerified && <p className="text-xs text-amber-500 text-center">🔒 Verified accounts only — ask Allan to verify you</p>}
        {isVerified && type !== 'story' && <button onClick={schedulePost} disabled={!media} className={`w-full px-4 py-2 rounded-full text-xs font-bold ${scheduled ? 'bg-green-600 text-white' : 'bg-[#7C3AED] text-white'} disabled:opacity-40`}>{scheduled ? '✓ Scheduled' : '⏰ Schedule for later'}</button>}
      </div>
      <div className="h-6" />
    </div>
  )
}
