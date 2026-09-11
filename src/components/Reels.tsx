import { useState, useMemo, useRef, useEffect } from 'react'

const reelsData = [
  { user: 'allan', verified: true, cap: 'Sunday highlight — Compelled 🔥', views: '12.4k', likes: 892, comments: 34, img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', music: { title: 'Compelled Anthem', artist: 'Harvest Worship', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop' } },
  { user: 'youth_harvest', verified: true, cap: 'Youth worship moment 🙏', views: '8.2k', likes: 645, comments: 28, img: 'https://images.unsplash.com/photo-1516450360452-9312abbf86c1?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', music: { title: 'Raise Me Up', artist: 'Grace & Team', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&h=100&fit=crop' } },
  { user: 'pst.simon', verified: false, cap: 'Daily verse — Jeremiah 29:11', views: '5.1k', likes: 423, comments: 15, img: 'https://images.unsplash.com/photo-1527525443983-6e60c75fff46?w=400&h=700&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', music: null },
]

export default function Reels() {
  const [idx, setIdx] = useState(0)
  const [liked, setLiked] = useState<Record<string, boolean>>({})
  const [muted, setMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const approvedReels: any[] = useMemo(() => { try { return JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]') } catch { return [] } }, [])
  const allReels = useMemo(() => [...approvedReels, ...reelsData], [approvedReels])
  const cur = allReels[idx] ?? reelsData[0]

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') setIdx(i => (i - 1 + allReels.length) % allReels.length)
      if (e.key === 'ArrowDown') setIdx(i => (i + 1) % allReels.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allReels.length])

  const toggleLike = () => setLiked(prev => ({ ...prev, [idx]: !prev[idx] }))
  const handleNext = () => setIdx(i => (i + 1) % allReels.length)
  const handlePrev = () => setIdx(i => (i - 1 + allReels.length) % allReels.length)

  return (
    <div className="relative min-h-[calc(100vh-49px)] overflow-hidden bg-[#130f1c] text-white">
      <div className="mx-auto flex h-[calc(100vh-49px)] max-w-6xl items-center justify-center px-2 py-2 sm:px-4 sm:py-4">
        <div className="relative h-full w-full max-w-[520px] overflow-hidden rounded-[28px] bg-black shadow-2xl shadow-purple-950/40 ring-1 ring-white/10 sm:max-h-[900px]">
          {cur.video ? <video ref={videoRef} src={cur.video} autoPlay muted={muted} loop playsInline className="h-full w-full object-cover" poster={cur.img} /> : <img src={cur.img} alt="" className="h-full w-full object-cover" />}

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/45" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-purple-950/20 via-transparent to-black/25" />

          <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pb-5 pt-5 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-purple-600 text-sm font-extrabold shadow-lg ring-1 ring-white/20">HF</div>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">Harvest Family</p><p className="text-lg font-extrabold tracking-tight">Reels</p></div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-400/15 px-3 py-1.5 text-[10px] font-extrabold tracking-widest text-amber-200 ring-1 ring-amber-200/20">COMMUNITY</span>
              <button onClick={() => setMuted(!muted)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-sm shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/20" aria-label={muted ? 'Unmute reel' : 'Mute reel'}>{muted ? '⌁' : '♪'}</button>
            </div>
          </div>

          <div className="absolute bottom-6 left-4 z-10 max-w-[calc(100%-100px)] sm:left-6 sm:max-w-[360px]">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-purple-600 text-sm font-extrabold shadow-lg ring-2 ring-white/25">{cur.user.charAt(0).toUpperCase()}</div>
              <div className="min-w-0"><p className="flex items-center gap-1 text-sm font-extrabold">@{cur.user}{cur.verified && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] text-purple-950">✓</span>}</p><p className="text-[11px] text-white/70">Harvest Family Church</p></div>
            </div>
            <p className="mb-3 text-sm font-semibold leading-relaxed text-white sm:text-[15px]">{cur.cap}</p>
            {cur.music && <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white/10 p-2.5 ring-1 ring-white/15 backdrop-blur-xl"><img src={cur.music.cover} alt="" className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/20" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{cur.music.title}</p><p className="truncate text-[10px] text-white/60">{cur.music.artist}</p></div><span className="text-amber-300">♫</span></div>}
            <div className="flex items-center gap-3 text-[10px] font-semibold text-white/60"><span>◉ {cur.views} views</span><span>•</span><span>{cur.comments} comments</span><span>•</span><span>{idx + 1}/{allReels.length}</span></div>
          </div>

          <div className="absolute bottom-8 right-3 z-10 flex flex-col items-center gap-3 sm:right-5">
            <button onClick={toggleLike} className="group flex flex-col items-center gap-1" aria-label={liked[idx] ? 'Unlike reel' : 'Like reel'}><span className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 backdrop-blur-xl transition group-hover:scale-105 ${liked[idx] ? 'bg-amber-400/20 text-amber-300 ring-amber-300/30' : 'bg-white/10 text-white ring-white/15'}`}>{liked[idx] ? '♥' : '♡'}</span><span className="text-[10px] font-bold text-white/80">{(cur.likes || 0) + (liked[idx] ? 1 : 0)}</span></button>
            <button className="group flex flex-col items-center gap-1" aria-label="Comments"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg ring-1 ring-white/15 backdrop-blur-xl transition group-hover:scale-105">◌</span><span className="text-[10px] font-bold text-white/80">{cur.comments || 0}</span></button>
            <button className="group flex flex-col items-center gap-1" aria-label="Share reel"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg ring-1 ring-white/15 backdrop-blur-xl transition group-hover:scale-105">↗</span><span className="text-[10px] font-bold text-white/80">Share</span></button>
            <button className="group flex flex-col items-center gap-1" aria-label="Save reel"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-lg ring-1 ring-white/15 backdrop-blur-xl transition group-hover:scale-105">◇</span><span className="text-[10px] font-bold text-white/80">Save</span></button>
          </div>

          <button onClick={handlePrev} className="absolute left-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-2xl text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/15 sm:flex" aria-label="previous reel">‹</button>
          <button onClick={handleNext} className="absolute right-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-2xl text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/15 sm:flex" aria-label="next reel">›</button>

          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10"><div className="h-full bg-gradient-to-r from-amber-400 via-purple-500 to-purple-700 transition-all" style={{ width: `${((idx + 1) / allReels.length) * 100}%` }} /></div>
          <div className="pointer-events-none absolute bottom-1 left-1/2 hidden -translate-x-1/2 text-[9px] font-medium text-white/35 sm:block">Use ↑ ↓ to browse</div>
        </div>
      </div>
    </div>
  )
}

export function ReelCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getUser = () => { try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || 'allan' } catch { return 'allan' } }

  const onFile = (e: any) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => setFileUrl(reader.result as string)
    reader.readAsDataURL(f)
  }

  const submit = () => {
    const reel = { id: Date.now(), user: getUser(), cap: caption || 'Harvest Reel 🙏', img: fileUrl || `https://picsum.photos/400/700?random=${Date.now()}`, video: fileUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', views: '0', likes: 0, comments: 0, at: new Date().toISOString() }
    const approved = JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]')
    localStorage.setItem('harvest_approved_reels', JSON.stringify([reel, ...approved]))
    window.dispatchEvent(new Event('harvest:approved'))
    alert('Reel shared ✓')
    onDone()
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-[#FFFBF0] text-neutral-900">
      <div className="mx-auto flex min-h-[calc(100vh-49px)] max-w-3xl flex-col px-4 pb-6">
        <div className="sticky top-0 z-20 -mx-4 flex h-16 items-center justify-between border-b border-purple-100 bg-[#FFFBF0]/90 px-4 backdrop-blur-xl">
          <button onClick={onDone} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg text-neutral-600 shadow-sm ring-1 ring-neutral-100" aria-label="Close">×</button>
          <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-600">Harvest Family</p><p className="text-sm font-extrabold">Create a Reel</p></div>
          <button onClick={submit} className="rounded-full bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-extrabold text-white shadow-md">Share</button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-5">
          {!fileUrl ? (
            <label className="flex aspect-[9/16] w-full max-w-[330px] cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-purple-200 bg-gradient-to-br from-purple-50 via-white to-amber-50 shadow-sm transition hover:border-purple-400 hover:shadow-lg">
              <input ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" />
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-purple-600 text-3xl font-extrabold text-white shadow-xl">▶</div>
              <p className="mt-5 text-base font-extrabold text-neutral-800">Add your moment</p><p className="mt-1 text-xs text-neutral-500">Choose a worship, fellowship or church video</p>
            </label>
          ) : (
            <div className="relative aspect-[9/16] w-full max-w-[330px] overflow-hidden rounded-[28px] bg-black shadow-2xl ring-2 ring-purple-200"><video src={fileUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />{fileName && <div className="absolute right-3 top-3 rounded-full bg-black/65 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur">{fileName.slice(0, 20)}</div>}<button onClick={() => { setFileUrl(null); setFileName(null) }} className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-purple-700">Choose another</button></div>
          )}

          <div className="w-full max-w-[520px] rounded-3xl border border-purple-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><p className="text-sm font-extrabold">Tell the family about it</p><span className="text-[10px] font-semibold text-neutral-400">{caption.length}/150</span></div>
            <textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Share a caption, verse, prayer or encouragement…" maxLength={150} className="w-full resize-none rounded-2xl border border-neutral-200 bg-[#FFFBF0] px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-purple-400 focus:ring-4 focus:ring-purple-50" rows={3} />
            <button onClick={submit} className="mt-3 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-amber-500 py-3.5 text-sm font-extrabold text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg">Share with the family</button>
          </div>
        </div>
      </div>
    </div>
  )
}
