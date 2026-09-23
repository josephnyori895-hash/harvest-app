import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchReels, useApi, presign, uploadToMinio } from '../lib/api'
import { useAuth } from '../state/auth'
import Comments from './Comments'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { captureVideoFrame } from './ImageAdjuster'
import MediaThumbnail from './MediaThumbnail'
import VideoThumb from './VideoThumb'

type Reel = { id?: string | number; user: string; verified?: boolean; liked?: boolean; likes?: number; cap: string; views?: string | number; comments?: number; img?: string; video?: string; music?: { title: string; artist: string; cover: string } | null }

// No demo videos: this screen shows only real approved reels from the server.

const fmtViews = (v: any): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '0')
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export default function Reels({ onOpenUser, sharedReelId, onSharedReelHandled }: { onOpenUser?: (u: any) => void; sharedReelId?: string; onSharedReelHandled?: () => void }) {
  const { isAdmin } = useAuth()
  const [idx, setIdx] = useState(0)
  const [encouraged, setEncouraged] = useState<Record<string, boolean>>({})
  const [muted, setMuted] = useState(false)
  const [generatedPoster, setGeneratedPoster] = useState('')
  const [posterFailed, setPosterFailed] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [videoRetryKey, setVideoRetryKey] = useState(0)
  // Real comments sheet on the current reel (server-backed post_comments).
  const [showComments, setShowComments] = useState(false)
  const [notice, setNotice] = useState('')
  const [serverReels, setServerReels] = useState<Reel[]>([])
  const [loadingServer, setLoadingServer] = useState(false)
  const [reelsLoadFailed, setReelsLoadFailed] = useState(false)
  const [reelsLoadKey, setReelsLoadKey] = useState(0)
  const [reelsNextOffset, setReelsNextOffset] = useState(0)
  const [hasMoreReels, setHasMoreReels] = useState(false)
  const [loadingMoreReels, setLoadingMoreReels] = useState(false)
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
    setReelsLoadFailed(false)
    fetchReels()
      .then(r => {
        if (cancelled) return
        const mapped: Reel[] = (r.reels || [])
          .filter((r: any) => Boolean(r.username || r.user))
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
            liked: Boolean(r.liked),
          }))
        setServerReels(mapped)
        setReelsNextOffset(Number(r.nextOffset) || mapped.length)
        setHasMoreReels(Boolean(r.hasMore ?? mapped.length >= 20))
      })
      .catch(() => {
        if (!cancelled) setReelsLoadFailed(true)
      })
      .finally(() => { if (!cancelled) setLoadingServer(false) })
    return () => { cancelled = true }
  }, [useServer, reelsLoadKey])

  const retryReels = () => setReelsLoadKey(x => x + 1)
  const flash = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 1800)
  }, [])

  const loadMoreReels = useCallback(async (advanceAfterLoad = false) => {
    if (!useServer || loadingServer || loadingMoreReels || !hasMoreReels) return
    setLoadingMoreReels(true)
    try {
      const r = await fetchReels(reelsNextOffset, 20)
      const mapped: Reel[] = (r.reels || [])
        .filter((item: any) => Boolean(item.username || item.user))
        .map((item: any) => ({
          id: item.id,
          user: item.username || item.user,
          verified: Boolean(item.verified),
          cap: item.caption || item.cap || '',
          views: item.views || 0,
          comments: item.comments || 0,
          img: item.poster_url || item.img || undefined,
          video: item.hls_url || item.video || undefined,
          music: item.music || null,
          liked: Boolean(item.liked),
        }))
      setServerReels(prev => [...prev, ...mapped])
      setReelsNextOffset(Number(r.nextOffset) || reelsNextOffset + mapped.length)
      setHasMoreReels(mapped.length >= 20)
      if (advanceAfterLoad && mapped.length > 0) setIdx(i => i + 1)
    } catch {
      flash('Could not load more videos. Try again.')
    } finally {
      setLoadingMoreReels(false)
    }
  }, [useServer, loadingServer, loadingMoreReels, hasMoreReels, reelsNextOffset, flash])

  const allVideos = useMemo(() => [...serverReels], [serverReels])
  useEffect(() => {
    if (!sharedReelId || loadingServer) return
    if (reelsLoadFailed) {
      // Keep the shared ID until a retry succeeds so "Try again" can still
      // open the original shared reel after a transient feed failure.
      setNotice('Unable to open that shared reel right now. Please try again.')
      return
    }
    const target = allVideos.findIndex((r: Reel) => String(r.id) === String(sharedReelId))
    if (target >= 0) {
      setIdx(target)
      onSharedReelHandled?.()
    } else if (hasMoreReels && !loadingMoreReels) {
      // A shared reel can be beyond the first page. Keep the navigation intent
      // alive while paging until the target is found.
      void loadMoreReels(false)
    } else if (!hasMoreReels && !loadingMoreReels) {
      setNotice('That shared reel is no longer available.')
      onSharedReelHandled?.()
    }
  }, [sharedReelId, loadingServer, reelsLoadFailed, allVideos, hasMoreReels, loadingMoreReels, loadMoreReels, onSharedReelHandled])
  // Empty feed guard: allVideos[idx] is undefined before any reels are approved,
  // which previously crashed this screen with "Cannot read properties of undefined".
  const cur = allVideos[Math.min(idx, Math.max(allVideos.length - 1, 0))]
  const key = cur ? `${cur.user}-${cur.id ?? idx}` : ''
  const retryVideo = () => {
    setVideoError(false)
    setVideoReady(false)
    setVideoRetryKey(x => x + 1)
  }

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

  useEffect(() => { if (idx >= allVideos.length) setIdx(0) }, [idx, allVideos.length])
  // Generate a first-frame poster when an uploaded reel has no server thumbnail.
  useEffect(() => {
    let active = true
    setGeneratedPoster('')
    setPosterFailed(false)
    setVideoReady(false)
    setVideoError(false)
    if (!cur?.video || cur.img) return () => { active = false }
    captureVideoFrame(cur.video, 0.1).then(blob => {
      if (!active || !blob) return
      setGeneratedPoster(URL.createObjectURL(blob))
    }).catch(() => {})
    return () => { active = false }
  }, [cur?.video, cur?.img])

  const next = useCallback(() => {
    setIdx(i => {
      const nextIdx = i + 1
      if (nextIdx < allVideos.length) return nextIdx
      if (hasMoreReels) void loadMoreReels(true)
      return allVideos.length > 0 ? i : 0
    })
  }, [allVideos.length, hasMoreReels, loadMoreReels])
  const prev = useCallback(() => setIdx(i => (i - 1 + allVideos.length) % allVideos.length), [allVideos.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (allVideos.length === 0) return
      if (e.key === 'ArrowUp') { e.preventDefault(); prev() }
      if (e.key === 'ArrowDown') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allVideos.length, next, prev])
  // Mobile: swipe up/down to move between reels (IG-style).
  const touchY = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touchY.current = e.touches[0]?.clientY ?? null }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchY.current == null) return
    const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY.current
    if (dy < -60) next(); else if (dy > 60) prev()
    // A swipe is navigation, not a double-tap candidate.
    if (Math.abs(dy) > 60) lastTap.current = { time: 0, x: 0, y: 0 }
    touchY.current = null
  }
  const share = async () => { if (!cur) return; const text = `${cur.user}: ${cur.cap} — Harvest Family Church Nyeri`; const publicBase = (import.meta.env.VITE_PUBLIC_APP_URL || 'https://harvestfamily-api.harvestfamily.workers.dev').replace(/\/$/, ''); const url = cur.id != null ? `${publicBase}/?shared=reel&id=${encodeURIComponent(String(cur.id))}` : publicBase; try { if (navigator.share) await navigator.share({ title: 'Harvest community video', text, url }); else { await navigator.clipboard.writeText(`${text}\n${url}`); flash('Video link copied to clipboard') } } catch (e: any) { if (e?.name !== 'AbortError') flash('Could not share this video') } }
  const respond = () => setShowComments(true)
  const toggleEncourage = async () => {
    if (!useServer || cur?.id == null) {
      setEncouraged(p => ({ ...p, [key]: !p[key] }))
      return
    }
    const wasLiked = Boolean(cur.liked)
    const wasLikes = Number(cur.likes) || 0
    setServerReels(rs => rs.map(r => String(r.id) === String(cur.id)
      ? { ...r, liked: !wasLiked, likes: Math.max(wasLikes + (wasLiked ? -1 : 1), 0) }
      : r))
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const res = await fetch(API + '/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ scope: 'reel', id: String(cur.id) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not update appreciation')
      setServerReels(rs => rs.map(r => String(r.id) === String(cur.id)
        ? { ...r, liked: Boolean(data.liked), likes: Number(data.likes) || 0 }
        : r))
    } catch (e: any) {
      setServerReels(rs => rs.map(r => String(r.id) === String(cur.id)
        ? { ...r, liked: wasLiked, likes: wasLikes }
        : r))
      flash(e?.message || 'Could not update appreciation')
    }
  }
  // Instagram-style self-delete: authors remove their own reels; admin can remove any.
  const me = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const [deleting, setDeleting] = useState(false)
  const deleteReel = async (id: string) => {
    if (deleting || !id) return
    setDeleting(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${API}/api/reels/${encodeURIComponent(id)}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not delete (${r.status})`)
      setServerReels(rs => rs.filter(x => String(x.id) !== String(id)))
      setIdx(0)
      flash('Video deleted')
    } catch (e: any) {
      flash(e?.message || 'Could not delete video')
    } finally {
      setDeleting(false)
    }
  }
  // Double-tap anywhere on the video = encourage (with a pulsing heart).
  const onVideoTap = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, [role="button"], a, input, textarea')) {
      lastTap.current = { time: 0, x: 0, y: 0 }
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pt = 'touches' in e ? e.changedTouches[0] : e
    const x = (pt?.clientX ?? 0) - rect.left, y = (pt?.clientY ?? 0) - rect.top
    const now = Date.now()
    const t = lastTap.current
    if (now - t.time < 350 && Math.hypot(x - t.x, y - t.y) < 40) {
      lastTap.current = { time: 0, x: 0, y: 0 }
      if (!cur?.id) return
      if (!cur.liked) { void toggleEncourage(); flash('You encouraged this video 🤲') }
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

  // Empty/loading/error guard: do not show "No videos yet" while the server
  // is still loading or when a failed request left the feed empty.
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
          <div className="text-5xl mb-3">{loadingServer ? '⏳' : reelsLoadFailed ? '⚠️' : '🎥'}</div>
          {loadingServer ? (
            <>
              <p className="text-base font-semibold">Loading videos…</p>
              <p className="text-xs text-white/55 mt-1">Checking the church video feed.</p>
            </>
          ) : reelsLoadFailed ? (
            <>
              <p className="text-base font-semibold">Couldn’t load videos</p>
              <p className="text-xs text-white/55 mt-1">Check your connection and try again.</p>
              <button type="button" onClick={retryReels} className="mt-4 min-h-11 px-5 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold">Try again</button>
            </>
          ) : (
            <>
              <p className="text-base font-semibold">No videos yet</p>
              <p className="text-xs text-white/55 mt-1">Approved community videos will appear here. Be the first to share one!</p>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="h-[calc(100dvh-64px)] lg:h-[calc(100vh-49px)] bg-black text-white overflow-hidden">
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

      <section
        onTouchStart={onTouchStart}
        onTouchEnd={(e) => { onTouchEnd(e); onVideoTap(e) }}
        onClick={onVideoTap}
        className="relative h-full w-full overflow-hidden bg-black"
        aria-label="Reel viewer"
      >
        {(cur.img || generatedPoster) && (
          <img
            src={cur.img || generatedPoster}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-45"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}

        {cur.video ? <>
          {!videoReady && !videoError && (cur.img || generatedPoster
            ? <MediaThumbnail src={cur.img || generatedPoster} alt="" className="absolute inset-0 w-full h-full object-contain" fallbackIcon="🎥" />
            : <VideoThumb src={cur.video} className="absolute inset-0 w-full h-full" />)}
          {videoError && !videoReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1714] pointer-events-none">
              <div className="text-center">
                <div className="text-4xl mb-2">🎥</div>
                <p className="text-xs text-white/60">Video preview unavailable</p>
                <button type="button" onClick={retryVideo} className="pointer-events-auto mt-3 min-h-11 px-4 rounded-xl bg-white/10 border border-white/15 text-xs font-semibold">Try again</button>
              </div>
            </div>
          )}
          <video
            key={`${cur.id ?? idx}-${videoRetryKey}`}
            ref={videoRef}
            src={cur.video}
            autoPlay
            muted={muted}
            loop
            playsInline
            poster={!posterFailed ? (cur.img || generatedPoster || undefined) : (generatedPoster || undefined)}
            className={`absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain bg-black transition-opacity duration-200 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
            onLoadedData={() => { setVideoReady(true); setVideoError(false) }}
            onCanPlay={() => setVideoReady(true)}
            onWaiting={() => { /* Keep the current frame visible during brief network stalls. */ }}
            onPlaying={() => setVideoReady(true)}
            onError={() => { setVideoReady(false); setVideoError(true) }}
          />
        </> : (
          <MediaThumbnail src={cur.img} alt="" className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain" fallbackIcon="🎥" />
        )}

        {heart && (
          <div key={heart.id} className="pointer-events-none absolute z-20 animate-[heartpop_0.9s_ease-out_forwards]" style={{ left: heart.x - 60, top: heart.y - 60 }}>
            <span className="text-[120px] leading-none drop-shadow-2xl">❤️</span>
          </div>
        )}

        {/* One restrained gradient only where text needs contrast. */}
        {/* Compact caption-safe gradient: enough contrast at the bottom without dimming the main video. */}
        <div className="absolute inset-x-0 bottom-0 h-40 sm:h-44 bg-gradient-to-t from-black/72 via-black/28 to-transparent pointer-events-none" />
        {notice && <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[80%] px-3 py-1.5 rounded-full bg-black/45 backdrop-blur-sm text-[11px] text-white/85 text-center pointer-events-none">{notice}</div>}

        <div className="absolute left-4 right-20 bottom-4 sm:left-6 sm:right-24 sm:bottom-5 z-10">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenUser?.({ username: cur.user, name: cur.user, verified: cur.verified }) }}
            className="flex items-center gap-2 text-left pointer-events-auto"
            aria-label={`View ${cur.user}'s profile`}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-purple-500 flex items-center justify-center font-bold text-xs">
              {String(cur.user).charAt(0).toUpperCase()}
            </div>
            <span className="font-bold text-sm drop-shadow">{cur.user} {cur.verified && <span className="text-amber-300">✓</span>}</span>
          </button>

          {cur.cap && <p className="mt-1.5 max-w-[min(36rem,calc(100vw-7rem))] text-[13px] sm:text-sm font-medium leading-[1.35] line-clamp-2 drop-shadow">{cur.cap}</p>}

          {cur.music && (
            <div className="mt-1.5 flex items-center gap-1.5 max-w-[70%] text-[11px] text-white/75">
              <img src={cur.music.cover} alt="" className="w-5 h-5 rounded shrink-0" />
              <span className="truncate">{cur.music.title} · {cur.music.artist}</span>
            </div>
          )}
        </div>

        <div className="absolute right-3 sm:right-5 bottom-5 sm:bottom-7 z-10 flex w-12 flex-col items-center gap-2.5 sm:gap-3 pointer-events-auto">
          {(cur.user === me || isAdmin) && (
            <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this video? This cannot be undone.')) void deleteReel(String(cur.id)) }} disabled={deleting}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/25 backdrop-blur-sm border border-white/10 text-[18px] leading-none shadow-sm transition-transform active:scale-95 disabled:opacity-50"
              aria-label="Delete video" title="Delete video">{deleting ? '…' : '🗑'}</button>
          )}

          <div className="flex flex-col items-center gap-0.5">
            <button onClick={(e) => { e.stopPropagation(); void toggleEncourage() }}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/25 backdrop-blur-sm border border-white/10 text-[19px] leading-none shadow-sm transition-transform active:scale-95 ${encouraged[key] ? 'ring-2 ring-purple-300/70' : ''}`}
              aria-label="Encourage">{encouraged[key] ? '✓' : '🤲'}</button>
            <span className="min-h-3 text-[10px] leading-3 font-medium text-white/80 drop-shadow">{fmtViews(cur.likes)}</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <button onClick={(e) => { e.stopPropagation(); respond() }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/25 backdrop-blur-sm border border-white/10 text-[18px] leading-none shadow-sm transition-transform active:scale-95"
              aria-label="Comments">💬</button>
            <span className="min-h-3 text-[10px] leading-3 font-medium text-white/80 drop-shadow">{fmtViews(cur.comments)}</span>
          </div>

          <button onClick={(e) => { e.stopPropagation(); void share() }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/25 backdrop-blur-sm border border-white/10 text-[18px] leading-none shadow-sm transition-transform active:scale-95"
            aria-label="Share">↗</button>

          <button onClick={(e) => { e.stopPropagation(); setMuted(m => !m) }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/20 backdrop-blur-sm border border-white/10 text-[16px] leading-none shadow-sm transition-transform active:scale-95"
            aria-label={muted ? 'Unmute video' : 'Mute video'}>{muted ? '🔇' : '🔊'}</button>
        </div>
        <button onClick={(e) => { e.stopPropagation(); prev() }} className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/20 backdrop-blur-sm z-10 opacity-40 hover:opacity-100" aria-label="Previous video">↑</button>
        <button onClick={(e) => { e.stopPropagation(); next() }} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/20 backdrop-blur-sm z-10 opacity-40 hover:opacity-100" aria-label="Next video">↓</button>
      </section>
    </div>
  )
}

export function ReelCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // Cover-frame picker: the user scrubs the video and captures the frame that
  // becomes the reel's poster (what everyone sees in the grid before playing).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!coverPreview?.startsWith('blob:')) return undefined
    return () => URL.revokeObjectURL(coverPreview)
  }, [coverPreview])
  const USE_API = import.meta.env.VITE_USE_API === 'true'
  const API = import.meta.env.VITE_API_URL || ''

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); setCoverBlob(null); setCoverPreview(null); const reader = new FileReader(); reader.onload = () => setFileUrl(reader.result as string); reader.readAsDataURL(f) }

  const grabCover = async () => {
    if (!videoEl || !fileUrl) return
    try {
      const blob = await captureVideoFrame(fileUrl, videoEl.currentTime)
      if (!blob) throw new Error('Could not capture the frame')
      setCoverBlob(blob); setCoverPreview(URL.createObjectURL(blob))
      setNotice(''); flashCover()
    } catch (e: any) { setNotice(e?.message || 'Could not set cover') }
  }
  const [coverFlash, setCoverFlash] = useState(false)
  const flashCover = () => { setCoverFlash(true); window.setTimeout(() => setCoverFlash(false), 1500) }

  const submit = async () => {
    if (busy) return
    if (!fileUrl) { setNotice('Add a video first'); return }
    setBusy(true); setNotice('')
    try {
      if (USE_API && fileUrl) {
        // Background hand-off: close now, progress pill + toast take over.
        const blob = await (await fetch(fileUrl as string)).blob()
        // Optional user-picked cover frame uploads first (small JPEG); its key
        // rides along with the confirm call so the feed shows the chosen poster.
        let coverKey: string | undefined
        if (coverBlob) {
          try {
            const coverFile = new File([coverBlob], 'cover.jpg', { type: 'image/jpeg' })
            const preD = await presign({ type: 'post', contentType: coverFile.type, bytes: coverFile.size, ext: 'jpg' })
            await uploadToMinio(preD.url, preD.fields || {}, coverFile)
            coverKey = preD.key
          } catch { /* poster is optional — the video still uploads */ }
        }
        void startBackgroundUpload({
          label: 'video',
          successMsg: 'Video shared with the Harvest family ✓',
          task: { kind: 'reel', file: blob, caption: caption.trim(), cover_key: coverKey },
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

  return <div className="min-h-[calc(100vh-76px)] bg-[#FFFBF0] text-[#29251F] p-4 md:p-8"><div className="max-w-2xl mx-auto bg-white rounded-[28px] border border-[#E8DEC9] shadow-sm overflow-hidden"><div className="p-5 border-b border-[#E8DEC9] flex items-center justify-between"><div><p className="text-[11px] uppercase tracking-wider text-purple-600 font-bold">Harvest Community</p><h1 className="text-xl font-bold">Share a community video</h1></div><button onClick={onDone} className="w-11 h-11 rounded-full bg-[#FFFBF0] border border-[#E8DEC9]" aria-label="Close">✕</button></div><div className="p-5 space-y-4"><div className="block aspect-video rounded-2xl bg-[#29251F] border-2 border-dashed border-[#E8DEC9] overflow-hidden relative">
              {fileUrl ? (
                <>
                  <video ref={setVideoEl} src={fileUrl} controls className="w-full h-full object-cover" />
                  <label htmlFor="reel-video-input" className="absolute top-3 right-3 px-3 py-2 rounded-full bg-black/60 text-white text-xs font-bold cursor-pointer">Change video</label>
                </>
              ) : (
                <label htmlFor="reel-video-input" className="h-full flex flex-col items-center justify-center text-white p-4 text-center cursor-pointer">
                  <span className="text-4xl">🎥</span><p className="font-semibold mt-3">Add a video</p><p className="text-xs text-white/55 mt-1">A worship moment, testimony or encouragement</p>
                </label>
              )}
              <input id="reel-video-input" ref={fileInputRef} type="file" accept="video/*" onChange={onFile} className="hidden" />
            </div>{fileUrl && (
              <div className="flex items-center gap-3 p-3 rounded-2xl border border-[#E8DEC9] bg-[#FFFBF0]">
                {coverPreview ? <img src={coverPreview} alt="Cover" className="w-20 h-12 rounded-lg object-cover border border-[#E8DEC9]" /> : <div className="w-20 h-12 rounded-lg bg-[#F4E8D0] flex items-center justify-center text-lg">🖼</div>}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold">Cover frame {coverPreview && <span className="text-emerald-600">✓ set</span>}</p>
                  <p className="text-[11px] text-[#766E63]">Scrub the video to the moment you want, then tap capture. This is the picture people see first.</p>
                </div>
                <button type="button" onClick={() => void grabCover()} className="shrink-0 px-3 py-2 rounded-full bg-[#7C3AED] text-white text-xs font-bold">📸 Capture</button>
              </div>
            )}{coverFlash && <p className="text-xs text-emerald-700 font-bold text-center">Cover captured ✓</p>}{fileName && <p className="text-xs text-stone-500 truncate">{fileName}</p>}<textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="What would you like to share with your church family?" maxLength={180} rows={4} className="w-full rounded-2xl border border-[#E8DEC9] bg-[#FFFBF0] p-4 outline-none focus:ring-2 focus:ring-purple-200 resize-none" />{notice && <div role="status" className="p-3 rounded-2xl bg-[#F3E8FF] border border-[#DDD6FE] text-sm font-semibold text-[#5B21B6]">{notice}</div>}<button onClick={() => void submit()} disabled={busy} className="w-full min-h-12 rounded-full bg-[#7C3AED] text-white font-bold hover:bg-[#6D28D9] disabled:opacity-50">{busy ? 'Uploading…' : 'Share with Harvest family'}</button></div></div></div>
}
