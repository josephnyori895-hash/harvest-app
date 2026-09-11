import { useCallback, useEffect, useRef, useState } from 'react'

type Story = {
  id?: string | number
  name?: string
  img?: string
  video?: string
  caption?: string
  music?: { cover?: string; title?: string; artist?: string; url?: string }
}

type User = { username?: string; role?: string }

const STORY_DURATION_MS = 4000

// STORY VIEWER — defensive, deterministic viewer. Never assumes optional story/user data exists.
export default function StoryViewer({ idx, setIdx, allStories, users = [] }: { idx: number; setIdx: (n: number | null) => void; allStories: Story[]; users?: User[] }) {
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hooks must run on every render. Do not return before hooks: the story list can change while the viewer is open.
  const safeStories = Array.isArray(allStories) ? allStories : []
  const safeIdx = Number.isInteger(idx) && idx >= 0 && idx < safeStories.length ? idx : -1
  const current = safeIdx >= 0 ? safeStories[safeIdx] : null
  const isLast = safeIdx >= 0 && safeIdx === safeStories.length - 1

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setIdx(null)
  }, [setIdx])

  useEffect(() => {
    if (!current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setIdx(safeIdx < safeStories.length - 1 ? safeIdx + 1 : null)
    }, STORY_DURATION_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [close, current?.id, safeIdx, safeStories.length, setIdx])

  useEffect(() => {
    if (!current || isPaused) return
    const started = Date.now()
    const interval = setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - started) / STORY_DURATION_MS) * 100))
    }, 50)
    return () => clearInterval(interval)
  }, [current?.id, isPaused])

  if (!current) return null

  const storyName = typeof current.name === 'string' && current.name.trim() ? current.name : 'Harvest'
  const matchedUser = users.find(u => u?.username === storyName)
  const role = matchedUser?.role
  const go = (next: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (next < 0 || next >= safeStories.length) close()
    else {
      setIsPaused(false)
      setIdx(next)
    }
  }

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < rect.width / 3) go(safeIdx - 1)
    else if (x > rect.width * 2 / 3) go(safeIdx + 1)
    else setIsPaused(p => !p)
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" onClick={handleTap} role="dialog" aria-label={`${storyName} story`}>
      <div className="flex gap-1 p-2 pt-3">
        {safeStories.map((storyItem, i) => (
          <div key={String(storyItem.id ?? i)} className="flex-1 h-1 bg-zinc-800 rounded overflow-hidden">
            <div className="h-full bg-white rounded" style={{ width: i < safeIdx ? '100%' : i === safeIdx ? `${progress}%` : '0%' }} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]">
            <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold">{storyName[0]?.toUpperCase() || 'H'}</div>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{storyName}</p>
            {role && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${role === 'admin' ? 'bg-purple-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>{role}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); setIsPaused(p => !p) }} className="text-xl px-2 text-white" aria-label={isPaused ? 'Resume story' : 'Pause story'}>{isPaused ? '▶' : '⏸'}</button>
          <button onClick={e => { e.stopPropagation(); close() }} className="text-xl px-2 text-white" aria-label="Close story">✕</button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-black">
        {current.video ? (
          <video src={current.video} autoPlay muted playsInline controls={false} className="w-full h-full object-contain" onEnded={() => go(safeIdx + 1)} onError={() => go(safeIdx + 1)} />
        ) : current.img ? (
          <img src={current.img} alt={current.caption || `${storyName} story`} className="w-full h-full object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="px-8 text-center text-zinc-400">This story has no media.</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

        <div className="absolute bottom-0 left-0 right-0 p-6 pointer-events-none">
          <p className="font-bold text-white text-lg">{storyName}</p>
          <p className="text-sm text-zinc-300 mt-1">{current.caption || 'Harvest story 🙏'}</p>
          {current.music?.title && (
            <div className="flex gap-2 items-center mt-2 p-2 bg-black/60 rounded-lg">
              {current.music.cover && <img src={current.music.cover} alt="" className="w-8 h-8 rounded" />}
              <div className="flex-1"><p className="text-xs font-semibold">🎵 {current.music.title}</p><p className="text-[11px] text-zinc-400">{current.music.artist || ''}</p></div>
            </div>
          )}
        </div>

        {safeIdx > 0 && <button onClick={e => { e.stopPropagation(); go(safeIdx - 1) }} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-xl" aria-label="Previous story">‹</button>}
        {!isLast && <button onClick={e => { e.stopPropagation(); go(safeIdx + 1) }} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white text-xl" aria-label="Next story">›</button>}
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-zinc-500 pointer-events-none">{isLast ? 'Tap to close' : '← Previous • Center pause • Next →'}</div>
    </div>
  )
}

// STORY CREATE — Instagram-style story editor.
const FILTERS = ['Original', 'Clarendon', 'Juno', 'Aden', 'Lark', 'Moody', 'Valencia', 'Perpetua', 'Willow', 'Gingham']
const STORY_STICKERS = ['🙏', '🔥', '❤️', '🎵', '🎤', '📍', '📷', '✝️', '🕊️', '💜', '👏', '😍', '🤗', '✨', '🎉', '🍕', '🌟', '⚽', '🎸', '💎']
const STORY_MUSIC = ['Worship 🎵', 'Hillsong 🎶', 'Sinach 🎤', 'Maverick 🔥', 'Elevation 🙏', 'Harvest 🎹']

export function StoryCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [filter, setFilter] = useState('Original')
  const [textOverlay, setTextOverlay] = useState('')
  const [stickers, setStickers] = useState<string[]>([])
  const [musicTrack, setMusicTrack] = useState<any | null>(null)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [showMood, setShowMood] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getUser = () => { try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || 'allan' } catch { return 'allan' } }
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); const reader = new FileReader(); reader.onload = () => setFileUrl(reader.result as string); reader.readAsDataURL(f) }
  const applyFilter = (imgUrl: string, f: string) => { if (f === 'Original') return imgUrl; const c = document.createElement('canvas'); const ctx = c.getContext('2d'); if (!ctx) return imgUrl; const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { c.width = img.width; c.height = img.height; ctx.filter = f === 'Clarendon' ? 'saturate(1.2) contrast(1.1)' : f === 'Juno' ? 'saturate(1.4) contrast(1.15) brightness(1.1)' : f === 'Moody' ? 'saturate(0.8) contrast(1.3) brightness(0.85)' : f === 'Valencia' ? 'saturate(1.5) contrast(1.1) brightness(1.1)' : f === 'Willow' ? 'saturate(0.7) contrast(1.15) brightness(1.1)' : f === 'Gingham' ? 'saturate(1.3) contrast(1.2) brightness(1.1)' : f === 'Lark' ? 'saturate(0.9) contrast(1.0) brightness(1.1)' : f === 'Perpetua' ? 'saturate(1.1) contrast(1.2) brightness(1.15)' : f === 'Aden' ? 'saturate(1.3) contrast(1.0) brightness(0.95)' : ''; ctx.drawImage(img, 0, 0); setFileUrl(c.toDataURL()) }; img.src = imgUrl }
  const addSticker = (s: string) => { if (!stickers.includes(s)) setStickers([...stickers, s]) }

  const searchMusic = async (term: string) => {
    if (!term.trim()) { setMusicResults([]); return }
    setMusicLoading(true)
    try { const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=8`); const j = await r.json(); setMusicResults(j.results.map((x: any) => ({ id: x.trackId, title: x.trackName, artist: x.artistName, cover: x.artworkUrl100?.replace('100x100', '200x200'), url: x.previewUrl }))) } catch { setMusicResults([]) }
    setMusicLoading(false)
  }

  const chooseMusic = (m: any) => { setMusicTrack(m); setShowMusic(false); setMusicQuery(''); setMusicResults([]) }
  const MOOD_PICKS = [{ mood: '🙏 Worship', tags: ['worship', 'praise', 'hymn'] }, { mood: '🎶 Choir', tags: ['choir', 'choral'] }, { mood: '🔥 Youth', tags: ['youth', 'gospel'] }, { mood: '❤️ Hymns', tags: ['hymn', 'traditional'] }, { mood: '🎤 Gospel', tags: ['gospel', 'praise'] }]
  const filterByMood = (tags: string[]) => { setShowMood(false); const matches = STORY_MUSIC.filter(m => tags.some(t => m.toLowerCase().includes(t))); if (matches.length) chooseMusic(matches[0]) }
  const submit = () => { const timestamp = Date.now(); const user = getUser(); const story = { id: `${user}_${timestamp}`, name: user, caption: caption || 'Harvest testimony 🙏', img: fileUrl || `https://picsum.photos/300/500?random=${timestamp}`, textOverlay, stickers, music: musicTrack, filter, at: new Date(timestamp).toISOString() }; let approved: any[] = []; try { const parsed = JSON.parse(localStorage.getItem('harvest_approved_stories') || '[]'); approved = Array.isArray(parsed) ? parsed : [] } catch {} localStorage.setItem('harvest_approved_stories', JSON.stringify([story, ...approved])); window.dispatchEvent(new Event('harvest:approved')); alert('Story posted instantly ✓'); onDone() }

  return (
    <div className="bg-zinc-50 text-white min-h-[calc(100vh-49px)] flex flex-col">
      <div className="flex justify-between items-center px-4 h-[56px] border-b border-zinc-200 bg-white"><button onClick={onDone} className="text-xl text-zinc-700">✕</button><p className="font-semibold text-sm text-zinc-900">Create Story</p><button onClick={submit} className="text-[#0095f6] font-semibold text-sm">Share</button></div>
      <div className="flex-1 flex items-center justify-center p-4 relative bg-gradient-to-b from-zinc-50 to-white">
        {!fileUrl ? <label className="w-full aspect-[9/16] bg-white rounded-2xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center cursor-pointer hover:border-[#0095f6] transition"><input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden" /><div className="w-20 h-20 rounded-full bg-[#0095f6] flex items-center justify-center text-4xl text-white">📷</div><p className="text-sm text-zinc-600 mt-2">Tap to add story photo/video</p><p className="text-xs text-zinc-400 mt-1">Record with camera or pick from gallery</p></label> : <div className="relative aspect-[9/16] w-full max-w-[320px] mx-auto overflow-hidden rounded-2xl border border-zinc-200 shadow-lg bg-white"><img src={fileUrl} alt="Story preview" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" /><div className="absolute bottom-4 left-4 right-4"><p className="text-white text-lg font-bold">{textOverlay || 'Your Story'}</p><p className="text-white/80 text-xs mt-1">{fileName || 'Media selected'}</p></div></div>}
      </div>
      <div className="px-4 py-3 bg-white border-t border-zinc-200 flex gap-2 overflow-x-auto"><button onClick={() => setShowFilters(v => !v)} className="px-3 py-2 rounded-full bg-zinc-100 text-zinc-800 text-xs">Filters</button><button onClick={() => setShowStickers(v => !v)} className="px-3 py-2 rounded-full bg-zinc-100 text-zinc-800 text-xs">Stickers</button><button onClick={() => setShowMusic(v => !v)} className="px-3 py-2 rounded-full bg-zinc-100 text-zinc-800 text-xs">Music</button><button onClick={() => setShowMood(v => !v)} className="px-3 py-2 rounded-full bg-zinc-100 text-zinc-800 text-xs">Mood</button></div>
      {showFilters && <div className="p-3 bg-white flex gap-2 overflow-x-auto">{FILTERS.map(f => <button key={f} onClick={() => { setFilter(f); if (fileUrl) applyFilter(fileUrl, f) }} className="px-3 py-2 rounded-lg bg-zinc-100 text-xs text-zinc-800">{f}</button>)}</div>}
      {showStickers && <div className="p-3 bg-white grid grid-cols-10 gap-2">{STORY_STICKERS.map(s => <button key={s} onClick={() => addSticker(s)} className="text-xl">{s}</button>)}</div>}
      {showMusic && <div className="p-3 bg-white text-zinc-900"><input value={musicQuery} onChange={e => setMusicQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') searchMusic(musicQuery) }} placeholder="Search music" className="w-full border rounded-lg p-2 text-sm" />{musicLoading && <p className="text-xs text-zinc-500 mt-2">Searching…</p>}{musicResults.map(m => <button key={m.id} onClick={() => chooseMusic(m)} className="block w-full text-left py-2 text-xs">{m.title} — {m.artist}</button>)}</div>}
      {showMood && <div className="p-3 bg-white flex gap-2 overflow-x-auto">{MOOD_PICKS.map(m => <button key={m.mood} onClick={() => filterByMood(m.tags)} className="px-3 py-2 rounded-full bg-zinc-100 text-xs text-zinc-800">{m.mood}</button>)}</div>}
      <div className="p-4 bg-white border-t border-zinc-200"><input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Add a caption…" className="w-full border rounded-xl px-3 py-2 text-sm text-zinc-800" /><input value={textOverlay} onChange={e => setTextOverlay(e.target.value)} placeholder="Text overlay…" className="w-full border rounded-xl px-3 py-2 text-sm text-zinc-800 mt-2" /></div>
    </div>
  )
}
