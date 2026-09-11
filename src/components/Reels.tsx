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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') setIdx(i => (i - 1 + allReels.length) % allReels.length)
      if (e.key === 'ArrowDown') setIdx(i => (i + 1) % allReels.length)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [allReels.length])

  const toggleLike = () => {
    setLiked(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  const handleNext = () => setIdx((idx + 1) % allReels.length)
  const handlePrev = () => setIdx((idx - 1 + allReels.length) % allReels.length)

  return (
    <div className="relative min-h-[calc(100vh-49px)] bg-black text-white overflow-hidden">
      {/* Main Video */}
      <div className="w-full h-[calc(100vh-49px)] relative flex items-center justify-center">
        {cur.video ? (
          <video
            ref={videoRef}
            src={cur.video}
            autoPlay
            muted={muted}
            loop
            playsInline
            className="w-full h-full object-cover"
            poster={cur.img}
          />
        ) : (
          <img src={cur.img} alt="" className="w-full h-full object-cover" />
        )}

        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40 pointer-events-none" />

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 px-4 pt-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg">Reels</span>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-purple-600 text-white">LIVE</span>
          </div>
          <button
            onClick={() => setMuted(!muted)}
            className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>

        {/* User Info - Bottom Left */}
        <div className="absolute bottom-24 left-4 z-10 max-w-[280px]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {cur.user.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm flex items-center gap-1">
                {cur.user}
                {cur.verified && <span className="text-blue-400 text-xs">✓</span>}
              </p>
              <p className="text-xs text-gray-300">Harvest Family Church</p>
            </div>
          </div>

          {/* Caption */}
          <p className="text-sm font-medium mb-3 leading-snug">{cur.cap}</p>

          {/* Music Info */}
          {cur.music && (
            <div className="flex gap-2 items-center p-2 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 mb-3">
              <img src={cur.music.cover} alt="" className="w-8 h-8 rounded" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">🎵 {cur.music.title}</p>
                <p className="text-[10px] text-gray-400 truncate">{cur.music.artist}</p>
              </div>
            </div>
          )}

          {/* Engagement Stats */}
          <div className="flex gap-3 text-xs text-gray-300 mb-2">
            <span>👀 {cur.views} views</span>
            <span>💬 {cur.comments} comments</span>
          </div>
        </div>

        {/* Engagement Buttons - Right Side */}
        <div className="absolute right-4 bottom-28 flex flex-col gap-6 z-10">
          {/* Like Button */}
          <button
            onClick={toggleLike}
            className={`group flex flex-col items-center gap-1 transition-all ${liked[idx] ? 'text-red-500' : 'text-white hover:text-red-500'}`}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              liked[idx]
                ? 'bg-red-500/20 animate-pulse'
                : 'bg-white/10 hover:bg-white/20'
            }`}>
              <span className={`text-2xl transition-transform ${liked[idx] ? 'scale-125 animate-bounce' : 'group-hover:scale-110'}`}>
                {liked[idx] ? '❤️' : '🤍'}
              </span>
            </div>
            <span className={`text-xs font-bold ${liked[idx] ? 'text-red-500' : 'text-gray-300'}`}>
              {(cur.likes || 0) + (liked[idx] ? 1 : 0)}
            </span>
          </button>

          {/* Comment Button */}
          <button className="group flex flex-col items-center gap-1 text-white hover:text-blue-400 transition-all">
            <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group-hover:scale-110">
              <span className="text-2xl">💬</span>
            </div>
            <span className="text-xs font-bold text-gray-300">{cur.comments || 0}</span>
          </button>

          {/* Share Button */}
          <button className="group flex flex-col items-center gap-1 text-white hover:text-green-400 transition-all">
            <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group-hover:scale-110">
              <span className="text-2xl">📤</span>
            </div>
            <span className="text-xs font-bold text-gray-300">Share</span>
          </button>

          {/* Save Button */}
          <button className="group flex flex-col items-center gap-1 text-white hover:text-purple-400 transition-all">
            <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all group-hover:scale-110">
              <span className="text-2xl">🔖</span>
            </div>
            <span className="text-xs font-bold text-gray-300">Save</span>
          </button>
        </div>

        {/* Navigation Arrows */}
        <button
          onClick={handlePrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-all z-10 backdrop-blur-sm"
          aria-label="previous reel"
        >
          <span className="text-white text-2xl">‹</span>
        </button>

        <button
          onClick={handleNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-all z-10 backdrop-blur-sm"
          aria-label="next reel"
        >
          <span className="text-white text-2xl">›</span>
        </button>

        {/* Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-purple-600 transition-all"
            style={{ width: `${((idx + 1) / allReels.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Bottom Info */}
      <div className="absolute bottom-1 left-0 right-0 text-center text-xs text-gray-500 pointer-events-none">
        Tap ▶ • Swipe Up/Down • {idx + 1}/{allReels.length}
      </div>
    </div>
  )
}


export function ReelCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const submit = () => {
    const reel = {
      id: Date.now(),
      user: getUser(),
      cap: caption || 'Harvest Reel 🙏',
      img: fileUrl || `https://picsum.photos/400/700?random=${Date.now()}`,
      video: fileUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      views: '0',
      likes: 0,
      comments: 0,
      at: new Date().toISOString()
    }
    const approved = JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]')
    localStorage.setItem('harvest_approved_reels', JSON.stringify([reel, ...approved]))
    window.dispatchEvent(new Event('harvest:approved'))
    alert('Reel shared ✓')
    onDone()
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-gradient-to-b from-neutral-900 to-black text-white flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center px-4 h-14 border-b border-neutral-800 sticky top-0 bg-black/80 backdrop-blur">
        <button onClick={onDone} className="text-2xl hover:opacity-70">✕</button>
        <p className="font-bold text-sm">Create Reel</p>
        <button onClick={submit} className="font-bold text-purple-500 hover:text-purple-400">Share</button>
      </div>

      {/* Video Preview */}
      <div className="flex-1 flex items-center justify-center p-4">
        {!fileUrl ? (
          <label className="w-full aspect-[9/16] bg-neutral-900 rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-neutral-700 cursor-pointer hover:border-purple-500 transition-all group">
            <input ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" />
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-4xl group-hover:scale-110 transition-transform">
              🎬
            </div>
            <p className="text-sm text-gray-400 mt-4 font-medium">Upload or Record</p>
            <p className="text-xs text-gray-500 mt-1">Up to 60s • 1080p</p>
          </label>
        ) : (
          <div className="relative aspect-[9/16] w-full max-w-[320px] mx-auto overflow-hidden rounded-2xl border-2 border-purple-500/50 bg-black">
            <video src={fileUrl} autoPlay muted loop playsInline className="w-full h-full object-cover" />
            {fileName && (
              <div className="absolute top-3 right-3 bg-black/70 text-white text-xs px-3 py-1 rounded-full backdrop-blur">
                📎 {fileName.slice(0, 15)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Caption Input */}
      <div className="px-4 pb-6 space-y-3">
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Write a caption (hashtags, emojis welcome)…"
          maxLength={150}
          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none transition resize-none"
          rows={3}
        />
        <p className="text-xs text-gray-500 text-right">{caption.length}/150</p>

        <button
          onClick={submit}
          className="w-full py-3 rounded-full bg-gradient-to-r from-amber-400 to-purple-600 text-black font-bold transition-all hover:shadow-xl hover:from-amber-300 hover:to-purple-500"
        >
          🚀 Share Reel
        </button>
      </div>
    </div>
  )
}
