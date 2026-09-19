import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchReels, useApi } from '../lib/api'
import { useAuth } from '../state/auth'
import Comments from './Comments'
import { startBackgroundUpload } from '../lib/backgroundUploads'

type Reel = { id?: string | number; user: string; verified?: boolean; cap: string; views?: string | number; comments?: number; img?: string; video?: string; music?: { title: string; artist: string; cover: string } | null }

// No demo videos: this screen shows only real approved reels from the server.

const fmtViews = (v: any): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '0')
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export default function Reels({ onOpenUser }: { onOpenUser?: (u: any) => void }) {
  const { isAdmin, isVerified } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [idx, setIdx] = useState(0)
  const [encouraged, setEncouraged] = useState<Record<string, boolean>>({})
  const [muted, setMuted] = useState(false)
  // Real comments sheet on the current reel (server-backed post_comments).
  const [showComments, setShowComments] = useState(false)
  const [notice, setNotice] = useState('')
  const [serverReels, setServerReels] = useState<Reel[]>([])
  const [loadingServer, setLoadingServer] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const useServer = useApi()
  // Double-tap to encourage: IG-style big heart pulse at the tap point.
  const [heart, setHeart] = useState<{ id: number; x: number; y: number } | null>(null)
  const lastTap = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 })
  const heartSeq = useRef(0)

  // Church reel feed from the server (approved reels) — shown ahead of demo content
  useEffect(() => {
    if (!useServer) return
    let cancelled = false
    setLoadingServer(true)
    fetchReels()
      .then(r => {
        if (cancelled) return
        const mapped: Reel[] = (r.reels || [])
          .filter((r: any) => (r.username || r.user) && (r.caption || r.cap))
          .map((r: any) => ({
            id: r.id,
            user: r.username || r.user,
            verified: Boolean(r.verified),
            cap: r.caption || r.cap || '',
            views: r.views || 0,
            comments: r.comments || 0,
            img: r.poster_url || r.img || undefined,
            video: r.hls_url || r.video || undefined,
            music: r.music || null,
          }))
        setServerReels(mapped)
      })
      .catch(() => { /* offline — empty state shows */ })
      .finally(() => { if (!cancelled) setLoadingServer(false) })
    return () => { cancelled = true }
  }, [useServer])

  const allVideos = useMemo(() => [...serverReels], [serverReels])
  // Empty feed guard: allVideos[idx] is undefined before any reels are approved,
  // which previously crashed this screen with "Cannot read properties of undefined".
  const cur = allVideos[Math.min(idx, Math.max(allVideos.length - 1, 0))]
  const key = cur ? `${cur.user}-${cur.id ?? idx}` : ''

  // Mute fallback: browsers/Android WebViews block unmuted autoplay. When a video
  // starts muted but the user chose sound, retry unmuted; if still blocked, flip
  // the UI to muted so the button reflects reality instead of lying. Re-runs per
  // reel (cur?.video) so each new video starts with the user's chosen mute state.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = muted
    const tryPlay = () => { const p = v.play(); if (p) p.catch(() => { if (!muted) { setMuted(true); v.muted = true; v.play().catch(() => {}) } }) }
    if (v.readyState >= 2) tryPlay()
    else { const onCan = () => { tryPlay(); v.removeEventListener('canplay', onCan) }; v.addEventListener('canplay', onCan); return () => v.removeEventListener('canplay', onCan) }
    return undefined
  }, [idx, muted, cur?.video])

  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (allVideos.length === 0) return; if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => (i - 1 + allVideos.length) % allVideos.length) } if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => (i + 1) % allVideos.length) } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [allVideos.length])
  useEffect(() => { if (idx >= allVideos.length) setIdx(0) }, [idx, allVideos.length])
  const next = () => setIdx(i => (i + 1) % allVideos.length)
  const prev = () => setIdx(i => (i - 1 + allVideos.length) % allVideos.length)
  // Mobile: swipe up/down to move between reels (IG-style).
  const touchY = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touchY.current = e.touches[0]?.clientY ?? null }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchY.current == null) return
    const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY.current
    if (dy < -60) next(); else if (dy > 60) prev()
    touchY.current = null
  }
  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 1800) }
  const share = async () => { const text = `${cur.user}: ${cur.cap} — Harvest Family Church Nyeri`; try { if (navigator.share) await navigator.share({ title: 'Harvest community video', text }); else { await navigator.clipboard.writeText(text); flash('Video details copied to clipboard') } } catch {} }
  const respond = () => setShowComments(true)
  const toggleEncourage = () => setEncouraged(p => ({ ...p, [key]: !p[key] }))
  // Double-tap anywhere on the video = encourage (with a pulsing heart).
  const onVideoTap = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pt = 'touches' in e ? e.changedTouches[0] : e
    const x = (pt?.clientX ?? 0) - rect.left, y = (pt?.clientY ?? 0) - rect.top
    const now = Date.now()
    const t = lastTap.current
    if (now - t.time < 350 && Math.hypot(x - t.x, y - t.y) < 40) {
      lastTap.current = { time: 0, x: 0, y: 0 }
      if (!encouraged[key]) { setEncouraged(p => ({ ...p, [key]: true })); flash('You encouraged this video 🤲') }
      const id = ++heartSeq.current
      setHeart({ id, x, y })
      window.setTimeout(() => setHeart(h => (h?.id === id ? null : h)), 900)
    } else {
      lastTap.current = { time: now, x, y }
    }
  }
  const bumpComments = (delta: number) => {
    setServerReels(rs => rs.map(r => (r.id === cur.id ? { ...r, comments: Math.max((Number(r.comments) || 0) + delta, 0) } : r)))
  }

  // Honest empty state instead of a crash when no reels are approved yet.
  if (!cur) return (
    <div className="min-h-[calc(100vh-49px)] bg-[#211d19] text-white overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5">
        <div className="flex items-start justify-between gap-3 mb-4 sm:mb-5">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-amber-300 font-bold">Harvest Family Church</p>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mt-1">Community Videos</h1>
            <p className="text-xs sm:text-sm text-white/60 mt-1 max-w-xl">Worship, testimonies, encouragement and moments from our family.</p>
          </div>
          <button onClick={() => setMuted(m => !m)} className="shrink-0 min-w-11 min-h-11 rounded-full bg-white/10 border border-white/10" aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? '🔇' : '🔊'}</button>
        </div>
        <div className="rounded-[24px] bg-white/5 border border-white/10 px-4 py-16 text-center">
          <div className="text-5xl mb-3">🎥</div>
          <p className="text-base font-semibold">No videos yet</p>
          <p className="text-xs text-white/55 mt-1">Approved community videos will appear here. Be the first to share one!</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-[calc(100dvh-64px)] lg:h-auto lg:min-h-[calc(100vh-49px)] bg-black lg:bg-[#211d19] text-white overflow-x-hidden">
      {showComments && cur.id != null && (
        <Comments
          scope="reel"
          postId={String(cur.id)}
          me={(() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()}
          isAdmin={isAdmin}
          onCountChange={bumpComments}
          onClose={() => setShowComments(false)}
        />
      )}
      <div className="h-full lg:h-auto max-w-6xl mx-auto lg:px-4 lg:py-5">
        <div className="hidden lg:flex items-start justify-between gap-3 mb-4 sm:mb-5">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-amber-300 font-bold">Harvest Family Church</p>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mt-1">Community Videos</h1>
            <p className="text-xs sm:text-sm text-white/60 mt-1 max-w-xl">Worship, testimonies, encouragement and moments from our family.</p>
          </div>
          <button onClick={() => setMuted(m => !m)} className="shrink-0 min-w-11 min-h-11 rounded-full bg-white/10 border border-white/10" aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? '🔇' : '🔊'}</button>
        </div>
        {loadingServer && <p className="mb-3 text-xs text-white/45">Loading church reels…</p>}
        {!loadingServer && allVideos.length === 0 && <div className="mb-3 rounded-xl bg-white/5 border border-white/10 px-4 py-6 text-center"><p className="text-sm font-semibold">No videos yet</p><p className="text-xs text-white/55 mt-1">Approved community videos will appear here.</p></div>}
        {notice && <div role="status" className="mb-3 rounded-xl bg-purple-500/20 border border-purple-300/20 px-3 py-2 text-xs text-purple-100">{notice}</div>}
        <div className="grid lg:grid-cols-[minmax(0,760px)_260px] gap-5 items-stretch h-full lg:h-auto">
          <section onTouchStart={onTouchStart} onTouchEnd={(e) => { onTouchEnd(e); onVideoTap(e) }} onClick={onVideoTap} className="relative overflow-hidden rounded-none lg:rounded-[24px] bg-black h-full min-h-[520px] sm:min-h-[600px] lg:h-[calc(100vh-190px)] lg:max-h-[760px] border-0 lg:border lg:border-white/10 shadow-2xl">
            {cur.video ? <video ref={videoRef} src={cur.video} autoPlay muted={muted} loop playsInline className="absolute inset-0 w-full h-full object-cover" poster={cur.img} /> : <img src={cur.img} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            {heart && (
              <div key={heart.id} className="pointer-events-none absolute z-30 animate-[heartpop_0.9s_ease-out_forwards]" style={{ left: heart.x - 60, top: heart.y - 60 }}>
                <span className="text-[120px] leading-none drop-shadow-2xl">❤️</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/30 pointer-events-none" />
            <div className="absolute inset-x-0 top-0 p-3 sm:p-5 flex justify-between items-center pointer-events-none">
              <span className="rounded-full bg-white/10 backdrop-blur px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold border border-white/10">Harvest Videos</span>
              <span className="rounded-full bg-amber-400 text-[#29251F] px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-bold">{idx + 1} / {allVideos.length}</span>
            </div>
            <div className="absolute left-3 sm:left-5 right-16 sm:right-20 bottom-[68px] sm:bottom-[76px] lg:bottom-6 pointer-events-none">
              <div className="flex items-center gap-3 mb-3 cursor-pointer pointer-events-auto" onClick={() => onOpenUser?.({ username: cur.user, name: cur.user, verified: cur.verified })} role="button" aria-label={`View ${cur.user}'s profile`}>
                <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-purple-500 flex items-center justify-center font-bold">{String(cur.user).charAt(0).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{cur.user} {cur.verified && <span className="text-amber-300">✓</span>}</p>
                  <p className="text-xs text-white/65 truncate">Harvest Family Church · Nyeri</p>
                </div>
              </div>
              <p className="font-semibold leading-snug text-sm sm:text-base">{cur.cap}</p>
              {cur.music && <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-xl bg-black/35 backdrop-blur px-2.5 py-2 border border-white/10"><img src={cur.music.cover} alt="" className="w-8 h-8 rounded-lg shrink-0" /><div className="min-w-0"><p className="text-xs font-semibold truncate">{cur.music.title}</p><p className="text-[10px] text-white/55 truncate">{cur.music.artist}</p></div></div>}
              <div className="mt-3 flex gap-4 text-xs text-white/60">
                <span>👀 {fmtViews(cur.views)}</span>
                <span>💬 {fmtViews((Number(cur.comments) || 0))} comments</span>
              </div>
            </div>
            <div className="absolute right-2.5 sm:right-4 bottom-[68px] sm:bottom-[76px] lg:bottom-6 flex flex-col gap-2.5 sm:gap-3 z-10">
              <button onClick={toggleEncourage} className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border flex items-center justify-center text-lg ${encouraged[key] ? 'bg-purple-500 border-purple-400' : 'bg-white/10 border-white/10'}`} aria-label="Encourage">{encouraged[key] ? '✓' : '🤲'}</button>
              <button onClick={respond} className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center" aria-label="Respond">💬</button>
              <button onClick={() => void share()} className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center" aria-label="Share">↗</button>
            </div>
            <button onClick={prev} className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/45 backdrop-blur border border-white/10 z-10" aria-label="Previous video">↑</button>
            <button onClick={next} className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/45 backdrop-blur border border-white/10 z-10" aria-label="Next video">↓</button>
          </section>
          <aside className="hidden lg:block rounded-[24px] bg-[#2c2722] border border-white/10 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-300 font-bold">Community life</p>
            <h2 className="font-bold text-lg mt-1">Watch with purpose</h2>
            <div className="space-y-2 mt-4 max-h-[420px] overflow-auto">
              {allVideos.map((r: Reel, i: number) => (
                <button key={`${r.user}-${r.id ?? i}`} onClick={() => setIdx(i)} className={`w-full text-left p-3 rounded-2xl border ${i === idx ? 'bg-purple-500/20 border-purple-300/30' : 'bg-white/5 hover:bg-white/10 border-white/5'}`}>
                  <p className="text-sm font-semibold truncate">{r.cap}</p>
                  <p className="text-[11px] text-white/45 mt-0.5">{r.user} · {fmtViews(r.views)} views</p>
                </button>
              ))}
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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const USE_API = import.meta.env.VITE_USE_API === 'true'
  const API = import.meta.env.VITE_API_URL || ''

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); const reader = new FileReader(); reader.onload = () => setFileUrl(reader.result as string); reader.readAsDataURL(f) }

  const submit = async () => {
    if (busy) return
    if (!fileUrl && !caption.trim()) { setNotice('Add a video or a message first'); return }
    setBusy(true); setNotice('')
    try {
      if (USE_API && fileUrl) {
        // Background hand-off: close now, progress pill + toast take over.
        const blob = await (await fetch(fileUrl as string)).blob()
        void startBackgroundUpload({
          label: 'video',
          successMsg: 'Video shared with the Harvest family ✓',
          task: { kind: 'reel', file: blob, caption: caption.trim() },
        }).catch(() => {})
        onDone()
      } else {
        // Dev-only offline path (no API configured). Never used in the installed app.
        setNotice('Offline dev mode: video not uploaded (no API configured).')
        setBusy(false)
      }
    } catch (e: any) {
      setNotice(e?.message || 'Unable to share this video')
      setBusy(false)
    }
  }

  return <div className="min-h-[calc(100vh-76px)] bg-[#FFFBF0] text-[#29251F] p-4 md:p-8"><div className="max-w-2xl mx-auto bg-white rounded-[28px] border border-[#E8DEC9] shadow-sm overflow-hidden"><div className="p-5 border-b border-[#E8DEC9] flex items-center justify-between"><div><p className="text-[11px] uppercase tracking-wider text-purple-600 font-bold">Harvest Community</p><h1 className="text-xl font-bold">Share a community video</h1></div><button onClick={onDone} className="w-11 h-11 rounded-full bg-[#FFFBF0] border border-[#E8DEC9]" aria-label="Close">✕</button></div><div className="p-5 space-y-4"><label className="block aspect-video rounded-2xl bg-[#29251F] border-2 border-dashed border-[#E8DEC9] overflow-hidden cursor-pointer">{fileUrl ? <video src={fileUrl} controls className="w-full h-full object-cover" /> : <div className="h-full flex flex-col items-center justify-center text-white p-4 text-center"><span className="text-4xl">🎥</span><p className="font-semibold mt-3">Add a video</p><p className="text-xs text-white/55 mt-1">A worship moment, testimony or encouragement</p></div>}<input ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" /></label>{fileName && <p className="text-xs text-zinc-500 truncate">{fileName}</p>}<textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="What would you like to share with your church family?" maxLength={180} rows={4} className="w-full rounded-2xl border border-[#E8DEC9] bg-[#FFFBF0] p-4 outline-none focus:ring-2 focus:ring-purple-200 resize-none" />{notice && <div role="status" className="p-3 rounded-2xl bg-[#F3E8FF] border border-[#DDD6FE] text-sm font-semibold text-[#5B21B6]">{notice}</div>}<button onClick={() => void submit()} disabled={busy} className="w-full min-h-12 rounded-full bg-[#7C3AED] text-white font-bold hover:bg-[#6D28D9] disabled:opacity-50">{busy ? 'Uploading…' : 'Share with Harvest family'}</button></div></div></div>
}
