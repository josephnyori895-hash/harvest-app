import MediaThumbnail from './MediaThumbnail'
import { useState, useEffect, useRef } from 'react'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { shareStoryToWhatsApp } from '../lib/whatsappShare'
import ImageAdjuster from './ImageAdjuster'
import SocialEditor from './SocialEditor'

import ErrorMessage from './ErrorMessage'
import { toggleInlineMediaTrack, stopInlineMediaAudio, activeInlineMediaTrackId } from '../lib/inlineMediaAudio'
// STORY VIEWER — immersive full-screen, auto-advance to next USER.
// Photo stories advance on a 4s timer; VIDEO stories play in full — the
// progress bar tracks the video itself and the next story loads on 'ended'.
export default function StoryViewer({ idx, setIdx, allStories, users = [], onOpenUser, onDeleted, onViewed }: { idx: number; setIdx: (n: number | null) => void; allStories: any[]; users?: any[]; onOpenUser?: (u: any) => void; onDeleted?: (id: string) => void; onViewed?: (id: string) => void }) {
  const s = allStories[idx]
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [videoState, setVideoState] = useState<'loading' | 'playing' | 'blocked' | 'error'>('loading')
  // Stories start WITH sound (WhatsApp-status behaviour). The story opens on a
  // real tap, so the WebView's user-gesture requirement is satisfied. If the
  // device still refuses unmuted autoplay we retry muted once and surface a
  // speaker toggle so nobody gets a silent video with no explanation.
  const [storyMuted, setStoryMuted] = useState(false)
  const [mediaRetryKey, setMediaRetryKey] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [reply, setReply] = useState('')
  const [replies, setReplies] = useState<any[]>([])
  const [replyBusy, setReplyBusy] = useState(false)
  const [showReplies, setShowReplies] = useState(false)
  const [replySent, setReplySent] = useState(false)
  const [views, setViews] = useState<any[]>([])
  const [viewCount, setViewCount] = useState(0)
  const [showViews, setShowViews] = useState(false)
  const [viewerError, setViewerError] = useState('')
  const [editing, setEditing] = useState(false)
  const [musicPreviewId, setMusicPreviewId] = useState<string | null>(activeInlineMediaTrackId())
  const isVideo = Boolean(s?.video)
  const toggleMusic = () => {
    if (!s?.music?.id || isVideo) return
    void toggleInlineMediaTrack({ id: String(s.music.id), url: s.music.url }, setMusicPreviewId)
  }
  useEffect(() => {
    stopInlineMediaAudio()
    if (s?.music?.id && !isVideo && !isPaused) {
      void toggleInlineMediaTrack({ id: String(s.music.id), url: s.music.url }, setMusicPreviewId)
    }
    return () => { stopInlineMediaAudio() }
  }, [idx, s?.music?.id, s?.music?.url, isVideo, isPaused])
  useEffect(() => () => stopInlineMediaAudio(), [])
  const [keyboardInset, setKeyboardInset] = useState(0)
  const historyPushedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Photo stories auto-advance on the author's chosen duration; video stories
  // play in full (onEnded). Composer-chosen duration rides the upload task.
  const storyDurationSec = Number((s as any)?.duration_secs) || Number((s as any)?.duration) || 4
  const duration = isVideo ? 0 : storyDurationSec * 1000
  const isLastStory = idx >= allStories.length - 1
  const me = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const isAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false } })()
  const canDelete = Boolean(s?.id && (s.username === me || isAdmin))
  const canEdit = canDelete
  const isStoryAuthor = Boolean(s?.username && s.username === me)
  const deleteReply = async (replyId: string) => {
    if (!replyId) return
    try {
      const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/, '')
      const t=localStorage.getItem('harvest_token')||''
      const r=await fetch(API+'/api/stories/'+encodeURIComponent(String(s.id))+'/replies?id='+encodeURIComponent(replyId),{method:'DELETE',headers:t?{Authorization:'Bearer '+t}:undefined})
      const d=await r.json().catch(()=>({}))
      if(!r.ok) throw new Error(d?.error||'Could not delete reply')
      setReplies(x=>x.filter(item=>String(item.id)!==String(replyId)))
    } catch(e:any){ setViewerError(e?.message||'Could not delete reply') }
  }
  const loadReplies = async () => { try { const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/, ''); const t=localStorage.getItem('harvest_token')||''; const r=await fetch(API+'/api/stories/'+encodeURIComponent(String(s.id))+'/replies',{headers:t?{Authorization:'Bearer '+t}:undefined}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d?.error||'Could not load replies'); setReplies(Array.isArray(d.replies)?d.replies:[])} catch(e:any){ setViewerError(e?.message||'Could not load replies')} }
  const sendReply = async () => { if(!reply.trim()||replyBusy||!s?.username)return; setReplyBusy(true); try { const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/, ''); const t=localStorage.getItem('harvest_token')||''; const r=await fetch(API+'/api/stories/'+encodeURIComponent(String(s.id))+'/replies',{method:'POST',headers:{'Content-Type':'application/json', ...(t?{Authorization:'Bearer '+t}:{}),},body:JSON.stringify({body:reply.trim()})}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d?.error||'Could not send reply'); setReply(''); setReplySent(true); setTimeout(()=>setReplySent(false),1500); void loadReplies() } catch(e:any){ setViewerError(e?.message||'Could not send reply') } finally { setReplyBusy(false) } }

  useEffect(() => {
    const vv = window.visualViewport
    const updateKeyboardInset = () => {
      if (!vv) return
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardInset(Math.min(inset, 360))
    }
    updateKeyboardInset()
    vv?.addEventListener('resize', updateKeyboardInset)
    vv?.addEventListener('scroll', updateKeyboardInset)
    if (!historyPushedRef.current) {
      window.history.pushState({ harvestStoryViewer: true }, '')
      historyPushedRef.current = true
    }
    const onPopState = () => setIdx(null)
    window.addEventListener('popstate', onPopState)
    return () => {
      vv?.removeEventListener('resize', updateKeyboardInset)
      vv?.removeEventListener('scroll', updateKeyboardInset)
      window.removeEventListener('popstate', onPopState)
      if (historyPushedRef.current && window.history.state?.harvestStoryViewer) window.history.back()
      historyPushedRef.current = false
    }
  }, [setIdx])

  const goNext = () => {
    if (idx < allStories.length - 1) setIdx(idx + 1)
    else setIdx(null)
  }

  useEffect(() => {
    if (!s || isVideo) return undefined
    setProgress(0)
    setIsPaused(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (isPaused) return undefined
    timerRef.current = setTimeout(() => goNext(), duration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [idx, isPaused, setIdx, allStories.length, duration, s, isVideo])

  useEffect(() => {
    setVideoState('loading')
    setProgress(0)
    setIsPaused(false)
  }, [idx])

  useEffect(() => {
    if (!s || !isVideo) return
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    stopInlineMediaAudio()
    v.muted = storyMuted
    const tryPlay = () => {
      v.play().then(() => setVideoState('playing')).catch(() => {
        if (!v.muted) { v.muted = true; setStoryMuted(true); v.play().then(() => setVideoState('playing')).catch(() => setVideoState('blocked')) }
        else setVideoState('blocked')
      })
    }
    if (v.readyState >= 2) tryPlay()
    else {
      const onCan = () => { tryPlay(); v.removeEventListener('canplay', onCan) }
      v.addEventListener('canplay', onCan)
      const onFail = () => setVideoState('error')
      v.addEventListener('error', onFail)
      return () => { v.removeEventListener('canplay', onCan); v.removeEventListener('error', onFail) }
    }
    return undefined
  }, [idx, s, isVideo, mediaRetryKey, storyMuted])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !isVideo || videoState === 'error') return
    if (isPaused) v.pause()
    else if (videoState === 'playing') v.play().catch(() => setVideoState('blocked'))
  }, [isPaused, isVideo, videoState])

  const handleTap = (e: any) => {
    if (!s) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < rect.width / 3) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setIdx(idx > 0 ? idx - 1 : null)
    } else if (x > rect.width * 2 / 3) {
      if (timerRef.current) clearTimeout(timerRef.current)
      goNext()
    } else setIsPaused(p => !p)
  }

  useEffect(() => {
    if (!s || isVideo || isPaused) return undefined
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const p = Math.min(100, (elapsed / duration) * 100)
      setProgress(p)
      if (p >= 100) clearInterval(interval)
    }, 50)
    return () => clearInterval(interval)
  }, [idx, isPaused, duration, s, isVideo])

  useEffect(() => {
    if (!s?.id) return
    onViewed?.(String(s.id))
    const token = localStorage.getItem('harvest_token') || ''
    const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    if (!token || !API) return
    void fetch(API + '/api/stories/' + encodeURIComponent(String(s.id)) + '/view', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }).catch(() => {})
  }, [s?.id, onViewed])

  useEffect(() => { if (s?.id) { setReplies([]); setReply(''); void loadReplies() } }, [s?.id])
  const loadViews = async () => {
    try {
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const t = localStorage.getItem('harvest_token') || ''
      const r2 = await fetch(API + '/api/stories/' + encodeURIComponent(String(s.id)) + '/views', { headers: t ? { Authorization: 'Bearer ' + t } : undefined })
      const d2 = await r2.json().catch(() => ({}))
      if (!r2.ok) throw new Error(d2?.error || 'Could not load viewers')
      setViews(d2.views || [])
      setViewCount(Number(d2.count) || 0)
    } catch (e: any) {
      setViewerError(e?.message || 'Could not load viewers')
    }
  }
  useEffect(() => {
    setViews([]); setViewCount(0); setShowViews(false)
    if (s?.id && isStoryAuthor) void loadViews()
  }, [s?.id])

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const lastHeldAtRef = useRef(0)
  const onHoldStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement | null)?.closest('button, a, input, label, textarea')) return
    heldRef.current = false
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    holdTimerRef.current = setTimeout(() => { heldRef.current = true; setIsPaused(true) }, 300)
  }
  const onHoldEnd = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    if (heldRef.current) { heldRef.current = false; setIsPaused(false); lastHeldAtRef.current = Date.now() }
  }
  if (!s) return null
  const isLastUserStory = idx === allStories.length - 1

  const deleteStory = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (deleting || !s?.id) return
    if (!window.confirm('Delete this story? This cannot be undone.')) return
    setDeleting(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${API}/api/stories/${encodeURIComponent(String(s.id))}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d?.error || `Could not delete (${r.status})`)
      }
      onDeleted?.(String(s.id))
      setIdx(null)
    } catch (err: any) {
      setViewerError(err?.message || 'Could not delete story')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {viewerError && <div className="absolute top-3 left-3 right-3 z-[90]"><ErrorMessage message={viewerError} action={<button type="button" onClick={() => setViewerError('')} className="text-xs">Dismiss</button>} /></div>}
      <div className="fixed inset-0 bg-black z-50 flex flex-col overscroll-none select-none" style={{ paddingBottom: keyboardInset ? `${keyboardInset}px` : 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))' }} onPointerDown={onHoldStart} onPointerUp={onHoldEnd} onPointerLeave={onHoldEnd} onPointerCancel={onHoldEnd} onClick={handleTap}>
        <div className="flex gap-1 p-2 pt-3">{allStories.map((_: any, i: number) => <div key={i} className="flex-1 h-1 bg-stone-800 rounded overflow-hidden relative"><div className="h-full bg-white/90" style={{ width: i === idx ? `${progress}%` : '100%' }} /></div>)}</div>
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={(e) => { e.stopPropagation(); onOpenUser?.({ username: s.username || s.name, name: s.name }) }} className="flex items-center gap-3" aria-label={`View ${s.name}'s profile`}>
            <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xs font-bold text-white">{(s.name || s.username || 'H').charAt(0).toUpperCase()}</div>
            <div className="text-left"><p className="font-bold text-white text-sm">{s.name}</p><p className="text-[11px] text-stone-300">@{s.username || 'harvest'}</p></div>
          </button>
          <div className="flex items-center gap-2">{canDelete && <button onClick={deleteStory} disabled={deleting} className="min-w-11 min-h-11 px-2 text-white disabled:opacity-50" aria-label="Delete story">🗑</button>}{canEdit && <button onClick={e => { e.stopPropagation(); setEditing(true) }} className="min-w-11 min-h-11 px-2 text-white" aria-label="Edit story">✎</button>}</div>
        </div>
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {s.img && !isVideo && (
            <img
              key={mediaRetryKey}
              src={s.img}
              alt=""
              onError={() => setVideoState('error')}
              onLoad={() => setVideoState('playing')}
              className={`max-w-full max-h-full w-auto h-auto object-contain ${videoState === 'error' ? 'opacity-0' : ''}`}
            />
          )}
          {s.img && !isVideo && videoState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
              <p className="text-sm text-stone-300">Story image could not load</p>
              <button type="button" onClick={e => { e.stopPropagation(); setVideoState('loading'); setMediaRetryKey(k => k + 1) }} className="mt-3 min-h-11 px-4 rounded-xl bg-white/10 border border-white/20 text-white">Retry</button>
            </div>
          )}
          {isVideo && (
            <>
              <video
                ref={videoRef}
                src={s.video}
                muted={storyMuted}
                playsInline
                preload="auto"
                onEnded={goNext}
                onTimeUpdate={e => { const el = e.currentTarget; if (el.duration > 0) setProgress((el.currentTime / el.duration) * 100) }}
                onError={() => setVideoState('error')}
                className={`max-w-full max-h-full w-auto h-auto object-contain ${videoState === 'playing' || videoState === 'blocked' ? '' : 'opacity-0'}`}
              />
              {videoState === 'loading' && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-12 h-12 rounded-full border-2 border-white/30 border-t-white animate-spin" /></div>}
              {videoState === 'blocked' && (
                <button onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.play().then(() => setVideoState('playing')).catch(() => setVideoState('error')) }} className="absolute inset-0 flex items-center justify-center bg-black/40" aria-label="Play story video"><span className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-3xl text-black shadow-2xl">▶</span></button>
              )}
              {videoState === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
                  <p className="text-sm text-stone-300">Video could not load</p>
                  <p className="text-[11px] text-stone-500 mt-1">Check your connection and try again</p>
                  <button type="button" onClick={e => { e.stopPropagation(); setVideoState('loading'); setMediaRetryKey(k => k + 1) }} className="mt-3 min-h-11 px-4 rounded-xl bg-white/10 border border-white/20 text-white">Retry</button>
                </div>
              )}
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          {idx > 0 && <button onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); setIdx(idx - 1) }} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/30 text-white text-xl" aria-label="Previous story">‹</button>}
          {!isLastUserStory && <button onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); if (idx < allStories.length - 1) setIdx(idx + 1) }} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/30 text-white text-xl" aria-label="Next story">›</button>}
        </div>
        {/* One bottom stack: author, optional viewers/replies panels, the reply row
            and the hint. As three separate absolute blocks they collided on short
            viewports — the author name sat under the reply bar and the hint
            printed straight over both. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-3 pb-3 pt-8">
          <div className="px-3">
            <p className="font-bold text-white text-lg">{s.name}</p>
            <p className="text-sm text-stone-300 mt-1">{s.caption || 'Harvest story 🙏'}</p>
          </div>
        {showViews && (
          <div onClick={e => e.stopPropagation()} className="pointer-events-auto max-h-48 overflow-auto rounded-2xl bg-black/80 p-3 text-white">
            <div className="flex justify-between items-center mb-2">
              <b className="text-xs">Seen by {viewCount}{viewCount === 1 ? '' : ' members'}</b>
              <button onClick={() => setShowViews(false)} className="min-w-11 min-h-11 text-base" aria-label="Close viewers list">×</button>
            </div>
            {views.length ? views.map((v: any) => (
              <div key={v.username || v.name} className="flex items-center gap-2.5 text-xs py-1.5">
                <div className="w-7 h-7 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-[10px] font-bold">{(v.name || v.username || 'H').charAt(0).toUpperCase()}</div>
                <p className="min-w-0 flex-1 truncate"><b>{v.name || v.username}</b>{v.verified ? ' ✓' : ''} <span className="text-stone-400">@{v.username}</span></p>
                <span className="text-[10px] text-stone-400 shrink-0">{(() => {
                  const m = Math.floor((Date.now() - new Date(v.viewed_at).getTime()) / 60000)
                  if (!Number.isFinite(m) || m < 1) return 'now'
                  if (m < 60) return `${m}m`
                  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
                  return `${Math.floor(h / 24)}d`
                })()}</span>
              </div>
            )) : <p className="text-xs text-stone-400">No views yet — they appear here as members watch.</p>}
          </div>
        )}
        {showReplies && <div onClick={e=>e.stopPropagation()} className="pointer-events-auto max-h-40 overflow-auto rounded-2xl bg-black/80 p-3 text-white">
          {replies.length ? replies.map((r: any) => {
            const canRemove = isAdmin || isStoryAuthor || (r.username && r.username === me)
            return <div key={r.id} className="flex items-start gap-2 text-xs py-1"><p className="min-w-0 flex-1"><b>{r.name||r.username}</b> {r.body}</p>{canRemove && <button type="button" onClick={() => void deleteReply(String(r.id))} className="text-stone-400">×</button>}</div>
          }) : <p className="text-xs text-stone-400">No replies yet.</p>}
        </div>}
        <div onClick={e=>e.stopPropagation()} className="pointer-events-auto flex gap-2">
          {isStoryAuthor ? (<>
            <button onClick={() => { setShowViews(v => !v); setShowReplies(false); void loadViews() }} className="flex-1 min-h-11 flex items-center justify-between gap-1 px-4 py-2 rounded-full bg-white/10 text-white">
              <span className="text-white/70">{showViews ? 'Viewers listed above' : 'Replies land in your inbox'}</span>
              <span className="text-xs font-bold shrink-0">👁 {viewCount}</span>
            </button>
            <button onClick={()=>{setShowReplies(v=>!v); setShowViews(false); if(!showReplies)void loadReplies()}} className="min-w-11 min-h-11 rounded-full bg-white/20 text-white px-3 py-2 text-xs" aria-label="Open replies">💬</button>
          </>) : (<>
            <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void sendReply()}} placeholder="Reply to this story…" className="flex-1 min-h-11 rounded-full border border-white/20 bg-white/10 px-4 text-white placeholder:text-stone-300" />
            <button onClick={()=>void sendReply()} disabled={replyBusy||!reply.trim()} className="min-h-11 rounded-full bg-purple-600 text-white px-4 py-2 text-xs font-bold disabled:opacity-50">{replyBusy?'…':(replySent?'Sent':'Send')}</button>
          </>) }
        </div>
          <div className="text-center text-[11px] text-stone-500">{isStoryAuthor ? (isLastUserStory ? 'Tap to close' : '← Tap to rewind • Hold to pause • → Forward') : 'Tap to pause • hold to pause • swipe to move'}</div>
        </div>
      </div>
      {editing && <SocialEditor kind="story" id={String(s.id)} caption={s.caption||''} musicTrack={s.music} onDone={()=>{setEditing(false);window.location.reload()}} />}
    </>
  )
}

const FILTERS = ['Original', 'Clarendon', 'Juno', 'Aden', 'Lark', 'Moody', 'Valencia', 'Perpetua', 'Willow', 'Gingham']
const STORY_STICKERS = ['🙏', '🔥', '❤️', '🎵', '🎤', '📍', '📷', '✝️', '🕊️', '💜', '👏', '😍', '🤗', '✨', '🎉', '🍕', '🌟', '⚽', '🎸', '💎']

export function StoryCreate({ onDone }: { onDone: () => void }) {
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileObj, setFileObj] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('Original')
  const [textOverlay, setTextOverlay] = useState('')
  const [textColor, setTextColor] = useState('#ffffff')
  const [textBold, setTextBold] = useState(true)
  const [stickers, setStickers] = useState<string[]>([])
  const [musicTrack, setMusicTrack] = useState<any | null>(null)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicLoading, setMusicLoading] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewFailedId, setPreviewFailedId] = useState<string | null>(null)
  useEffect(() => () => { stopInlineMediaAudio() }, [])
  const isVideoFile = Boolean(fileObj?.type.startsWith('video/'))
  const [timer, setTimer] = useState(4)
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [adjusting, setAdjusting] = useState(false)
  const onFile = (e: any) => {
    const f: File | undefined = e.target.files?.[0]
    if (!f) return
    setFileObj(f); setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => { setFileUrl(reader.result as string); if (f.type.startsWith('image/')) setAdjusting(true) }
    reader.readAsDataURL(f)
    e.target.value = ''
  }
  const applyAdjust = (blob: Blob, preview: string) => {
    const adjusted = new File([blob], 'story.jpg', { type: 'image/jpeg' })
    setFileObj(adjusted); setFileName('story.jpg'); setFileUrl(preview); setAdjusting(false)
  }
  const applyFilter = (imgUrl: string, f: string) => {
    if (f === 'Original') return imgUrl
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return imgUrl
    const img = new Image()
    return new Promise<string>((resolve) => {
      img.onload = () => {
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        ctx.filter = 'none'
        ctx.drawImage(img, 0, 0)
        const pixel = ctx.getImageData(0, 0, c.width, c.height)
        const data = pixel.data
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (f === 'Clarendon') { data[i] = Math.min(255, r * 1.2); data[i + 1] = Math.min(255, g * 1.05 + 12); data[i + 2] = Math.min(255, b * 1.1 + 10) }
          else if (f === 'Juno') { data[i] = Math.min(255, r * 1.15); data[i + 1] = Math.min(255, g * 1.02); data[i + 2] = Math.min(255, b * 1.25) }
          else if (f === 'Aden') { data[i] = Math.min(255, r * 1.25); data[i + 1] = Math.min(255, g * 1.1); data[i + 2] = Math.min(255, b * 0.9) }
          else if (f === 'Lark') { data[i] = Math.min(255, r * 0.98); data[i + 1] = Math.min(255, g * 1.15); data[i + 2] = Math.min(255, b * 0.96) }
          else if (f === 'Moody') { data[i] = Math.min(255, r * 0.7); data[i + 1] = Math.min(255, g * 0.9); data[i + 2] = Math.min(255, b * 1.2) }
          else if (f === 'Valencia') { data[i] = Math.min(255, r * 1.3); data[i + 1] = Math.min(255, g * 0.96); data[i + 2] = Math.min(255, b * 0.9) }
          else if (f === 'Perpetua') { data[i] = Math.min(255, r * 1.18); data[i + 1] = Math.min(255, g * 1.08); data[i + 2] = Math.min(255, b * 1.22) }
          else if (f === 'Willow') { data[i] = Math.min(255, r * 0.9); data[i + 1] = Math.min(255, g * 1.08); data[i + 2] = Math.min(255, b * 0.88) }
          else if (f === 'Gingham') { data[i] = Math.min(255, r * 1.12); data[i + 1] = Math.min(255, g * 0.9); data[i + 2] = Math.min(255, b * 1.18) }
        }
        ctx.putImageData(pixel, 0, 0)
        resolve(c.toDataURL('image/jpeg', 0.9))
      }
      img.src = imgUrl
    })
  }
  const addSticker = (s: string) => { if (!stickers.includes(s)) setStickers([...stickers, s]) }
  const removeSticker = (s: string) => setStickers(stickers.filter(x => x !== s))
  // Music must come from the church library: the worker validates
  // music_track_id against the tracks table, so transit-none iTunes picks
  // would 404 the confirm and silently destroy the story upload.
  useEffect(() => {
    if (!showMusic) return
    const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    const q = musicQuery.trim().toLowerCase()
    const t = setTimeout(() => {
      setMusicLoading(true)
      fetch(API + '/api/music?limit=100')
        .then(r => r.json())
        .then(d => {
          const all = Array.isArray(d?.tracks) ? d.tracks : []
          setMusicResults(q ? all.filter((x: any) => `${x.title} ${x.artist}`.toLowerCase().includes(q)) : all)
        })
        .catch(() => setMusicResults([]))
        .finally(() => setMusicLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [showMusic, musicQuery])
  const stopPreview = () => { stopInlineMediaAudio(); setPreviewId(null); setPreviewFailedId(null) }
  const togglePreview = (m: any) => {
    if (!m?.id) return
    const id = String(m.id)
    if (!m.url) { setPreviewFailedId(id); return }
    if (previewId === id) { stopPreview(); return }
    void toggleInlineMediaTrack({ id, url: m.url }, setPreviewId).then(ok => { if (!ok) setPreviewFailedId(id) })
  }
  const chooseMusic = (m: any) => { stopPreview(); setPreviewFailedId(null); setMusicTrack(m); setShowMusic(false); setMusicQuery(''); setMusicResults([]) }
  const MOOD_PICKS = [
    { mood: '🙏 Worship', tags: ['worship', 'praise', 'hymn'] },
    { mood: '🎶 Choir', tags: ['choir', 'choral'] },
    { mood: '🔥 Youth', tags: ['youth', 'gospel'] },
    { mood: '❤️ Hymns', tags: ['hymn', 'traditional'] },
    { mood: '🎤 Gospel', tags: ['gospel', 'praise'] },
  ]
  const filterByMood = (tags: string[]) => { setMusicQuery(tags[0] || '') }
  const submit = async () => {
    if (busy) return
    if (!fileObj) { setNotice('Add a photo or video first'); return }
    setBusy(true); setNotice('')
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      if (!token || !API) { setNotice('You need to be signed in to share a story'); setBusy(false); return }
      const blob = fileObj
      void startBackgroundUpload({
        label: 'story',
        successMsg: 'Story shared — visible for 24 hours ✓',
        task: {
          kind: 'story',
          file: blob,
          caption: caption.trim(),
          music_track_id: musicTrack?.id,
          duration_secs: timer,
        },
      }).catch(() => {})
      onDone()
    } catch (e: any) {
      setNotice(e?.message || 'Could not share your story')
      setBusy(false)
    }
  }
  return (
    <div className="bg-stone-50 text-white min-h-[calc(100vh-49px)] flex flex-col">
      <div className="flex justify-between items-center px-4 h-[56px] border-b border-stone-200 bg-white"><button onClick={onDone} className="text-xl text-stone-700">✕</button><p className="font-bold text-stone-800">New story</p><button onClick={() => void submit()} disabled={busy || !fileObj} className="text-sm font-bold text-violet-600 disabled:opacity-40">{busy ? 'Posting…' : 'Share'}</button></div>
      <div className="flex-1 flex items-center justify-center p-4 relative bg-gradient-to-b from-stone-50 to-white">
        {fileUrl && !isVideoFile && (
          <div className="w-full px-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500 mb-2">Story duration</p>
            <div className="flex gap-2">
              {[3, 5, 8, 12].map(s => (
                <button key={s} onClick={() => setTimer(s)} className={`min-h-11 px-4 rounded-xl text-sm font-bold ${timer === s ? 'bg-violet-600 text-white' : 'bg-stone-100 text-stone-700'}`}>{s}s</button>
              ))}
            </div>
          </div>
        )}
        {!fileUrl ? <label className="w-full aspect-[9/16] bg-white rounded-2xl border-2 border-dashed border-stone-300 flex items-center justify-center text-stone-500 font-semibold cursor-pointer"><input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden" />Choose a photo or video</label> : <div className="relative w-full aspect-[9/16] overflow-hidden rounded-2xl bg-stone-900">{isVideoFile ? <video src={fileUrl} controls playsInline className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain" /> : <img src={fileUrl} alt="" className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain" />}{filter !== 'Original' && <div className="absolute top-2 left-2 bg-black/35 px-2 py-1 rounded-full text-[10px] font-bold">{filter}</div>}{textOverlay && <div className="absolute inset-x-0 top-4 flex justify-center"><span className="px-3 py-1 rounded-full text-sm font-bold" style={{ color: textColor, fontWeight: textBold ? 700 : 400, textShadow: '0 2px 8px rgba(0,0,0,.6)' }}>{textOverlay}</span></div>}{stickers.length > 0 && <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">{stickers.map(s => <span key={s} className="text-2xl">{s}</span>)}</div>}{musicTrack && <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/50 rounded-full px-2 py-1 text-[10px] font-bold text-white"><button type="button" aria-label={previewId === String(musicTrack.id) ? 'Stop music preview' : `Preview ${musicTrack.title}`} onClick={() => togglePreview(musicTrack)}>{previewId === String(musicTrack.id) ? '⏸' : previewFailedId === String(musicTrack.id) ? '⚠ Retry' : '♪'}</button><span className="max-w-[110px] truncate">{musicTrack.title}</span><button type="button" aria-label="Remove music" onClick={() => { stopPreview(); setPreviewFailedId(null); setMusicTrack(null) }}>×</button></div>}</div>}
      </div>
      {fileUrl && !isVideoFile && <><div className="px-4 pb-2 bg-white border-t border-stone-200"><button onClick={() => { setShowFilters(!showFilters); setShowStickers(false); setShowMusic(false) }} className="text-sm font-bold text-stone-700">Filters</button></div>{showFilters && <div className="px-4 pb-4 bg-white border-t border-stone-200 grid grid-cols-3 gap-2">{FILTERS.map((f) => <button key={f} onClick={() => { setFilter(f); setShowFilters(false) }} className={`rounded-xl border px-2 py-2 text-xs font-bold ${filter === f ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-stone-200 text-stone-700'}`}>{f}</button>)}</div>}</>}
      {fileUrl && <div className="px-4 pb-2 bg-white border-t border-stone-200"><button onClick={() => { setShowStickers(!showStickers); setShowFilters(false); setShowMusic(false) }} className="text-sm font-bold text-stone-700">Stickers</button></div>}{showStickers && fileUrl && <div className="px-4 pb-4 bg-white border-t border-stone-200 flex flex-wrap gap-2">{STORY_STICKERS.map((s) => <button key={s} onClick={() => addSticker(s)} className="text-2xl">{s}</button>)}{stickers.map((s) => <button key={s} onClick={() => removeSticker(s)} className="text-xs text-stone-700">× {s}</button>)}</div>}
      {fileUrl && <div className="px-4 pb-2 bg-white border-t border-stone-200"><button onClick={() => { setShowMusic(!showMusic); setShowFilters(false); setShowStickers(false) }} className="text-sm font-bold text-stone-700">Music</button></div>}{showMusic && fileUrl && <div className="px-4 pb-4 bg-white border-t border-stone-200 space-y-3"><input value={musicQuery} onChange={e => setMusicQuery(e.target.value)} placeholder="Search church music…" className="w-full bg-stone-100 rounded-xl px-3 py-2 text-sm text-stone-800" />{musicLoading && <p className="text-xs text-stone-500">Loading…</p>}{!musicQuery.trim() && <div className="flex flex-wrap gap-2">{MOOD_PICKS.map(({ mood, tags }) => <button key={mood} onClick={() => filterByMood(tags)} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">{mood}</button>)}</div>}{!musicLoading && musicQuery.trim() && musicResults.length === 0 && <p className="text-xs text-stone-500">No library tracks match — upload one in the Music tab first.</p>}<div className="space-y-2">{!musicLoading && musicResults.map((m:any) => <div key={m.id} className="flex items-center gap-3 rounded-xl bg-stone-100 p-2"><img src={m.cover_url || 'https://placehold.co/48x48/png'} alt="" className="w-12 h-12 rounded-lg" /><div className="flex-1 min-w-0"><p className="text-sm font-bold text-stone-800 truncate">{m.title}</p><p className="text-[11px] text-stone-500 truncate">{m.artist}</p></div><button onClick={() => togglePreview(m)} aria-label={previewId === m.id ? 'Stop preview' : 'Preview music'} className={`min-w-11 min-h-11 rounded-full bg-white text-xs font-bold ${previewFailedId === String(m.id) ? 'text-red-600' : 'text-stone-700'}`}>{previewId === m.id ? 'Stop' : previewFailedId === String(m.id) ? 'Retry' : 'Preview'}</button><button onClick={() => chooseMusic(m)} className="min-w-11 min-h-11 rounded-full bg-violet-600 text-white text-xs font-bold">Use</button></div>)}</div></div>}
      {notice && <div className="mx-4 mb-2"><ErrorMessage message={notice} /></div>}
      {adjusting && fileObj && fileObj.type.startsWith('image/') && (
        <ImageAdjuster file={fileObj} onCancel={() => setAdjusting(false)} onDone={applyAdjust} />
      )}
      <div className="px-4 pb-4 bg-white border-t border-stone-200"><input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write a caption..." className="w-full bg-stone-50 rounded-xl px-3 py-2 text-sm text-stone-800 outline-none" /><div className="mt-3 flex gap-2"><input value={textOverlay} onChange={e => setTextOverlay(e.target.value)} placeholder="Text overlay" className="flex-1 bg-stone-50 rounded-xl px-3 py-2 text-sm text-stone-800 outline-none" /><input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="w-12 h-10 rounded-lg border border-stone-200" /><button onClick={() => setTextBold(v => !v)} className={`rounded-xl px-3 py-2 text-xs font-bold ${textBold ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700'}`}>B</button></div></div>
    </div>
  )
}
