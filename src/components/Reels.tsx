import { useEffect, useMemo, useRef, useState } from 'react'

const videosData = [
  { user: 'allan', verified: true, cap: 'Sunday highlight — Compelled', views: '12.4k', responses: 892, comments: 34, img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=700&h=900&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', music: { title: 'Compelled Anthem', artist: 'Harvest Worship', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop' } },
  { user: 'youth_harvest', verified: true, cap: 'Youth worship moment', views: '8.2k', responses: 645, comments: 28, img: 'https://images.unsplash.com/photo-1516450360452-9312abbf86c1?w=700&h=900&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', music: { title: 'Raise Me Up', artist: 'Grace & Team', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&h=100&fit=crop' } },
  { user: 'pst.simon', verified: false, cap: 'Daily verse — Jeremiah 29:11', views: '5.1k', responses: 423, comments: 15, img: 'https://images.unsplash.com/photo-1527525443983-6e60c75fff46?w=700&h=900&fit=crop', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', music: null },
]

export default function Reels() {
  const [idx, setIdx] = useState(0)
  const [encouraged, setEncouraged] = useState<Record<string, boolean>>({})
  const [muted, setMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const approvedVideos: any[] = useMemo(() => { try { return JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]') } catch { return [] } }, [])
  const allVideos = useMemo(() => [...approvedVideos, ...videosData], [approvedVideos])
  const cur = allVideos[idx] ?? videosData[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') setIdx(i => (i - 1 + allVideos.length) % allVideos.length)
      if (e.key === 'ArrowDown') setIdx(i => (i + 1) % allVideos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allVideos.length])

  const next = () => setIdx(i => (i + 1) % allVideos.length)
  const prev = () => setIdx(i => (i - 1 + allVideos.length) % allVideos.length)
  const key = `${cur.user}-${idx}`

  return (
    <div className="min-h-[calc(100vh-76px)] bg-[#211d19] text-white">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300 font-bold">Harvest Family Church</p>
            <h1 className="text-2xl md:text-3xl font-bold mt-1">Community Videos</h1>
            <p className="text-sm text-white/60 mt-1">Worship, testimonies, encouragement and moments from our family.</p>
          </div>
          <button onClick={() => setMuted(m => !m)} className="min-w-11 min-h-11 rounded-full bg-white/10 border border-white/10 hover:bg-white/15" aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? '🔇' : '🔊'}</button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,760px)_260px] gap-5 items-stretch">
          <section className="relative overflow-hidden rounded-[28px] bg-black min-h-[600px] lg:h-[calc(100vh-190px)] lg:max-h-[760px] border border-white/10 shadow-2xl">
            {cur.video ? <video ref={videoRef} src={cur.video} autoPlay muted={muted} loop playsInline poster={cur.img} className="absolute inset-0 w-full h-full object-cover" /> : <img src={cur.img} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/30" />
            <div className="absolute inset-x-0 top-0 p-5 flex justify-between items-center">
              <span className="rounded-full bg-white/12 backdrop-blur px-3 py-1.5 text-xs font-semibold border border-white/10">Harvest Videos</span>
              <span className="rounded-full bg-amber-400 text-[#29251F] px-3 py-1.5 text-xs font-bold">{idx + 1} / {allVideos.length}</span>
            </div>

            <div className="absolute left-5 right-20 bottom-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-300 to-purple-500 flex items-center justify-center font-bold">{cur.user.charAt(0).toUpperCase()}</div>
                <div><p className="font-bold text-sm">{cur.user} {cur.verified && <span className="text-amber-300">✓</span>}</p><p className="text-xs text-white/65">Harvest Family Church · Nyeri</p></div>
              </div>
              <p className="font-semibold leading-snug text-base">{cur.cap}</p>
              {cur.music && <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-black/35 backdrop-blur px-2.5 py-2 border border-white/10"><img src={cur.music.cover} alt="" className="w-8 h-8 rounded-lg" /><div><p className="text-xs font-semibold">{cur.music.title}</p><p className="text-[10px] text-white/55">{cur.music.artist}</p></div></div>}
              <div className="mt-3 flex gap-4 text-xs text-white/60"><span>👀 {cur.views}</span><span>💬 {cur.comments} responses</span></div>
            </div>

            <div className="absolute right-4 bottom-6 flex flex-col gap-3">
              <button onClick={() => setEncouraged(p => ({ ...p, [key]: !p[key] }))} className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-lg ${encouraged[key] ? 'bg-purple-500 border-purple-400' : 'bg-white/10 border-white/10'}`} aria-label="Encourage">{encouraged[key] ? '✓' : '🤲'}</button>
              <span className="text-[10px] text-center text-white/65">{encouraged[key] ? 'Encouraged' : 'Encourage'}</span>
              <button className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center" aria-label="Respond">💬</button>
              <button className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center" aria-label="Share">↗</button>
            </div>

            <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/35 backdrop-blur border border-white/10" aria-label="Previous video">↑</button>
            <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/35 backdrop-blur border border-white/10" aria-label="Next video">↓</button>
          </section>

          <aside className="hidden lg:block rounded-[24px] bg-[#2c2722] border border-white/10 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-300 font-bold">Community life</p>
            <h2 className="font-bold text-lg mt-1">Watch with purpose</h2>
            <div className="space-y-2 mt-4">
              {['Worship & praise', 'Testimonies', 'Youth & groups', 'Encouragement'].map((label, i) => <button key={label} onClick={() => setIdx(i % allVideos.length)} className="w-full text-left p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5"><p className="text-sm font-semibold">{label}</p><p className="text-[11px] text-white/45 mt-0.5">Explore Harvest community videos</p></button>)}
            </div>
            <div className="mt-5 p-4 rounded-2xl bg-purple-500/15 border border-purple-300/15"><p className="text-sm font-semibold">A word for today</p><p className="text-xs text-white/60 mt-1">Use your voice to encourage someone in the family.</p></div>
          </aside>
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

  const getUser = () => { try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || localStorage.getItem('harvest_username') || 'member' } catch { return 'member' } }
  const onFile = (e: any) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); const reader = new FileReader(); reader.onload = () => setFileUrl(reader.result as string); reader.readAsDataURL(f) }
  const submit = () => {
    const video = { id: Date.now(), user: getUser(), cap: caption || 'A moment from Harvest', img: fileUrl || `https://picsum.photos/400/700?random=${Date.now()}`, video: fileUrl || undefined, views: '0', responses: 0, comments: 0, at: new Date().toISOString() }
    const approved = JSON.parse(localStorage.getItem('harvest_approved_reels') || '[]')
    localStorage.setItem('harvest_approved_reels', JSON.stringify([video, ...approved]))
    window.dispatchEvent(new Event('harvest:approved'))
    onDone()
  }

  return <div className="min-h-[calc(100vh-76px)] bg-[#FFFBF0] text-[#29251F] p-4 md:p-8"><div className="max-w-2xl mx-auto bg-white rounded-[28px] border border-[#E8DEC9] shadow-sm overflow-hidden"><div className="p-5 border-b border-[#E8DEC9] flex items-center justify-between"><div><p className="text-[11px] uppercase tracking-wider text-purple-600 font-bold">Harvest Community</p><h1 className="text-xl font-bold">Share a community video</h1></div><button onClick={onDone} className="w-10 h-10 rounded-full bg-[#FFFBF0]">✕</button></div><div className="p-5 space-y-4"><label className="block aspect-video rounded-2xl bg-[#29251F] border-2 border-dashed border-[#E8DEC9] overflow-hidden cursor-pointer">{fileUrl ? <video src={fileUrl} controls className="w-full h-full object-cover" /> : <div className="h-full flex flex-col items-center justify-center text-white"><span className="text-4xl">🎥</span><p className="font-semibold mt-3">Add a video</p><p className="text-xs text-white/55 mt-1">A worship moment, testimony or encouragement</p></div>}<input ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" /></label>{fileName && <p className="text-xs text-zinc-500">{fileName}</p>}<textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="What would you like to share with your church family?" maxLength={180} rows={4} className="w-full rounded-2xl border border-[#E8DEC9] bg-[#FFFBF0] p-4 outline-none focus:ring-2 focus:ring-purple-200 resize-none" /><button onClick={submit} className="w-full min-h-12 rounded-full bg-[#7C3AED] text-white font-bold hover:bg-[#6D28D9]">Share with Harvest family</button></div></div></div>
}
