import MediaThumbnail from './MediaThumbnail'
import { useState, useEffect, useRef } from 'react'
import { startBackgroundUpload, uploadTooLarge } from '../lib/backgroundUploads'
import { shareStoryToWhatsApp } from '../lib/whatsappShare'
import ImageAdjuster from './ImageAdjuster'
import SocialEditor from './SocialEditor'

import ErrorMessage from './ErrorMessage'
import { Icon, Spinner } from '../ui'
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
// Preview-only approximations of the filters that burnDecorations applies to
// the pixels at submit. The composer must show what the viewer will get.
const FILTER_CSS: Record<string, string> = {
  Original: 'none',
  Clarendon: 'brightness(1.06) contrast(1.14) saturate(1.18)',
  Juno: 'brightness(1.05) contrast(1.1) saturate(1.3) hue-rotate(-6deg)',
  Aden: 'brightness(1.08) contrast(1.06) saturate(1.2) hue-rotate(4deg)',
  Lark: 'brightness(1.06) contrast(1.04) saturate(1.12) hue-rotate(-8deg)',
  Moody: 'brightness(0.88) contrast(1.12) saturate(1.2) hue-rotate(8deg)',
  Valencia: 'brightness(1.1) contrast(1.05) saturate(1.24) hue-rotate(4deg)',
  Perpetua: 'brightness(1.06) contrast(1.02) saturate(1.26) hue-rotate(-4deg)',
  Willow: 'brightness(0.98) contrast(1.04) saturate(0.9) hue-rotate(10deg)',
  Gingham: 'brightness(1.06) contrast(1.06) saturate(1.1) hue-rotate(-10deg)',
}
const TEXT_COLORS = ['#ffffff', '#000000', '#f5c451', '#7ed6a5', '#8ec5ff', '#ff9fc4', '#c9a6ff', '#ffb27a']

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
  const [timer, setTimer] = useState(5)
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [showText, setShowText] = useState(false)
  const [showLength, setShowLength] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [adjusting, setAdjusting] = useState(false)
  const onFile = (e: any) => {
    const f: File | undefined = e.target.files?.[0]
    if (!f) return
    // Reject before the upload starts, with the same story limit the server
    // enforces — the composer must never queue a file that cannot land.
    const tooBig = uploadTooLarge('story', f.size)
    if (tooBig) { setNotice(tooBig); e.target.value = ''; return }
    // Fresh media starts clean — stale decorations from a previous pick must
    // not get burned into a different photo.
    setFilter('Original'); setTextOverlay(''); setStickers([]); setTextBold(false)
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
  // Compose the preview-era decorations (filter, text overlay, stickers) INTO
  // the pixels at submit time — what the member saw is what every viewer gets.
  // Videos can't be re-encoded client-side here, so the decoration controls are
  // hidden for video picks instead of pretending.
  const burnDecorations = async (file: File): Promise<File> => {
    const hasText = !!textOverlay.trim()
    if (filter === 'Original' && !hasText && stickers.length === 0) return file
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (!ctx) return file
    const img = new Image()
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('could not decode image'))
      img.src = URL.createObjectURL(file)
    })
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    ctx.drawImage(img, 0, 0)
    if (filter !== 'Original') {
      const pixel = ctx.getImageData(0, 0, c.width, c.height)
      const data = pixel.data
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (filter === 'Clarendon') { data[i] = Math.min(255, r * 1.2); data[i + 1] = Math.min(255, g * 1.05 + 12); data[i + 2] = Math.min(255, b * 1.1 + 10) }
        else if (filter === 'Juno') { data[i] = Math.min(255, r * 1.15); data[i + 1] = Math.min(255, g * 1.02); data[i + 2] = Math.min(255, b * 1.25) }
        else if (filter === 'Aden') { data[i] = Math.min(255, r * 1.25); data[i + 1] = Math.min(255, g * 1.1); data[i + 2] = Math.min(255, b * 0.9) }
        else if (filter === 'Lark') { data[i] = Math.min(255, r * 0.98); data[i + 1] = Math.min(255, g * 1.15); data[i + 2] = Math.min(255, b * 0.96) }
        else if (filter === 'Moody') { data[i] = Math.min(255, r * 0.7); data[i + 1] = Math.min(255, g * 0.9); data[i + 2] = Math.min(255, b * 1.2) }
        else if (filter === 'Valencia') { data[i] = Math.min(255, r * 1.3); data[i + 1] = Math.min(255, g * 0.96); data[i + 2] = Math.min(255, b * 0.9) }
        else if (filter === 'Perpetua') { data[i] = Math.min(255, r * 1.18); data[i + 1] = Math.min(255, g * 1.08); data[i + 2] = Math.min(255, b * 1.22) }
        else if (filter === 'Willow') { data[i] = Math.min(255, r * 0.9); data[i + 1] = Math.min(255, g * 1.08); data[i + 2] = Math.min(255, b * 0.88) }
        else if (filter === 'Gingham') { data[i] = Math.min(255, r * 1.12); data[i + 1] = Math.min(255, g * 0.9); data[i + 2] = Math.min(255, b * 1.18) }
      }
      ctx.putImageData(pixel, 0, 0)
    }
    if (hasText) {
      const fs = Math.max(28, Math.round(c.width * 0.05))
      ctx.font = `${textBold ? 700 : 400} ${fs}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = textColor
      ctx.shadowColor = 'rgba(0,0,0,.6)'
      ctx.shadowBlur = fs * 0.35
      ctx.shadowOffsetY = fs * 0.1
      const maxWidth = c.width * 0.86
      const words = textOverlay.trim().split(/\s+/)
      const lines: string[] = []
      let line = ''
      for (const w of words) {
        const next = line ? `${line} ${w}` : w
        if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w } else { line = next }
      }
      if (line) lines.push(line)
      lines.slice(0, 5).forEach((l, i) => ctx.fillText(l, c.width / 2, fs * 1.4 + i * fs * 1.25))
    }
    if (stickers.length > 0) {
      const sfs = Math.max(24, Math.round(c.width * 0.062))
      ctx.font = `${sfs}px system-ui`
      ctx.textAlign = 'left'
      ctx.shadowColor = 'rgba(0,0,0,.35)'
      ctx.shadowBlur = sfs * 0.2
      let x = c.width * 0.06
      let y = c.height - sfs * 0.8
      for (const s of stickers) {
        const w = ctx.measureText(s).width
        if (x + w > c.width * 0.95 && y > sfs * 2.2) { x = c.width * 0.06; y -= sfs * 1.25 }
        ctx.fillText(s, x, y)
        x += w + sfs * 0.35
      }
    }
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.92))
    if (!blob) return file
    return new File([blob], 'story.jpg', { type: 'image/jpeg' })
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
  // One panel open at a time; tapping the active tool closes it.
  const openTool = (id: string) => {
    const on = id === 'filters' ? showFilters
      : id === 'text' ? showText
      : id === 'stickers' ? showStickers
      : id === 'music' ? showMusic
      : showLength
    setShowFilters(id === 'filters' && !on)
    setShowText(id === 'text' && !on)
    setShowStickers(id === 'stickers' && !on)
    setShowMusic(id === 'music' && !on)
    setShowLength(id === 'length' && !on)
  }
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
      let blob: File | Blob = fileObj
      if (!isVideoFile) blob = await burnDecorations(fileObj)
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
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-white">
      {/* top bar — close, title, one primary action */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <button onClick={onDone} aria-label="Close story composer" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition active:scale-95">
          <Icon name="close" size={20} />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-extrabold">New story</p>
        <button
          onClick={() => void submit()}
          disabled={busy || !fileObj}
          className="inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-2xs font-extrabold text-white disabled:opacity-40"
        >
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </div>

      {/* canvas — full-bleed portrait stage, exactly what viewers will see */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        <div className="relative h-full w-full max-w-[440px] overflow-hidden rounded-2xl bg-black">
          {fileUrl ? (
            isVideoFile
              ? <video src={fileUrl} controls playsInline className="h-full w-full object-contain" />
              : <img src={fileUrl} alt="Story preview" className="h-full w-full object-cover" style={{ filter: FILTER_CSS[filter] || 'none' }} />
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10">
                <Icon name="plus" size={28} />
              </span>
              <span className="mt-1 text-sm font-extrabold">Add to your story</span>
              <span className="text-2xs text-white/60">Photo or video · up to 30 MB</span>
            </button>
          )}
          {/* Always mounted: the same picker both adds and replaces the media. */}
          <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden" />

          {fileUrl && (
            <>
              {textOverlay && (
                <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center px-4">
                  <span
                    className="rounded-lg px-2 text-center text-xl"
                    style={{ color: textColor, fontWeight: textBold ? 700 : 400, textShadow: '0 2px 10px rgba(0,0,0,.55)' }}
                  >
                    {textOverlay}
                  </span>
                </div>
              )}
              {stickers.length > 0 && (
                <div className="absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5">
                  {stickers.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => removeSticker(s)}
                      className="rounded-lg bg-black/35 px-2 py-1 text-2xl backdrop-blur-sm"
                      aria-label={`Remove ${s} sticker`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {musicTrack && (
                <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 py-1 pl-1 pr-2 text-2xs font-bold backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => togglePreview(musicTrack)}
                    className="grid h-7 w-7 place-items-center rounded-full bg-white/15"
                    aria-label={previewId === String(musicTrack.id) ? 'Stop music preview' : `Preview ${musicTrack.title}`}
                  >
                    {previewFailedId === String(musicTrack.id)
                      ? <Icon name="alert" size={13} />
                      : <Icon name={previewId === String(musicTrack.id) ? 'pause' : 'play'} size={12} />}
                  </button>
                  <span className="max-w-[120px] truncate">{musicTrack.title}</span>
                  <button
                    type="button"
                    aria-label="Remove music"
                    onClick={() => { stopPreview(); setPreviewFailedId(null); setMusicTrack(null) }}
                    className="grid h-6 w-6 place-items-center rounded-full bg-white/15"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )}
              {!isVideoFile && filter !== 'Original' && (
                <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-2xs font-bold backdrop-blur-sm">{filter}</span>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-3 right-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 text-2xs font-extrabold backdrop-blur-sm"
              >
                <Icon name="retry" size={13} /> Replace
              </button>
            </>
          )}
        </div>
      </div>

      {/* tools — one rail, one open panel at a time */}
      {fileUrl && (
        <div className="shrink-0">
          {showFilters && !isVideoFile && (
            <div className="border-t border-white/10 px-3 pb-2 pt-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {FILTERS.map(f => (
                  <button key={f} onClick={() => setFilter(f)} className={`shrink-0 text-center ${filter === f ? 'text-white' : 'text-white/60'}`} aria-pressed={filter === f}>
                    <span className={`block h-16 w-14 overflow-hidden rounded-lg border ${filter === f ? 'border-white' : 'border-transparent'}`}>
                      <img src={fileUrl} alt="" className="h-full w-full object-cover" style={{ filter: FILTER_CSS[f] || 'none' }} />
                    </span>
                    <span className="mt-1 block text-2xs">{f}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showText && (
            <div className="space-y-2 border-t border-white/10 px-3 pb-2 pt-3">
              <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-white/50">On the photo</p>
              <input
                value={textOverlay}
                onChange={e => setTextOverlay(e.target.value)}
                maxLength={80}
                placeholder="Type something…"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1.5 overflow-x-auto">
                  {TEXT_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setTextColor(c)}
                      aria-label={`Text colour ${c}`}
                      aria-pressed={textColor === c}
                      className={`h-7 w-7 shrink-0 rounded-full border-2 ${textColor === c ? 'border-white' : 'border-white/20'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <button onClick={() => setTextBold(v => !v)} aria-pressed={textBold} aria-label="Bold text" className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-extrabold ${textBold ? 'bg-white text-ink' : 'bg-white/10 text-white'}`}>B</button>
              </div>
              <p className="pt-1 text-2xs font-extrabold uppercase tracking-[0.12em] text-white/50">Caption (optional)</p>
              <input
                value={caption}
                onChange={e => setCaption(e.target.value)}
                maxLength={300}
                placeholder="Describe this moment…"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none"
              />
            </div>
          )}

          {showStickers && (
            <div className="border-t border-white/10 px-3 pb-2 pt-3">
              <div className="grid grid-cols-8 gap-1.5">
                {STORY_STICKERS.map(s => (
                  <button
                    key={s}
                    onClick={() => addSticker(s)}
                    className={`grid h-9 place-items-center rounded-lg text-xl transition ${stickers.includes(s) ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}
                    aria-pressed={stickers.includes(s)}
                    aria-label={`Add ${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showMusic && (
            <div className="space-y-2 border-t border-white/10 px-3 pb-2 pt-3">
              <input
                value={musicQuery}
                onChange={e => setMusicQuery(e.target.value)}
                placeholder="Search church music…"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none"
              />
              {musicLoading && <p className="flex items-center gap-2 text-2xs text-white/60"><Spinner size={12} /> Searching…</p>}
              {!musicQuery.trim() && (
                <div className="flex flex-wrap gap-1.5">
                  {MOOD_PICKS.map(({ mood, tags }) => (
                    <button key={mood} onClick={() => filterByMood(tags)} className="rounded-full bg-white/10 px-3 py-1 text-2xs font-bold text-white/80">{mood}</button>
                  ))}
                </div>
              )}
              {!musicLoading && musicQuery.trim() && musicResults.length === 0 && (
                <p className="text-2xs text-white/60">No tracks match — upload it in the Music tab first.</p>
              )}
              <div className="max-h-40 space-y-1 overflow-auto">
                {musicResults.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-xl bg-white/5 p-1.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                      {m.cover_url ? <img src={m.cover_url} alt="" className="h-full w-full object-cover" /> : <Icon name="music" size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xs font-bold">{m.title}</span>
                      <span className="block truncate text-2xs text-white/60">{m.artist}</span>
                    </span>
                    <button
                      onClick={() => togglePreview(m)}
                      aria-label={previewId === m.id ? 'Stop preview' : 'Preview music'}
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 ${previewFailedId === String(m.id) ? 'text-gold' : 'text-white'}`}
                    >
                      {previewId === m.id ? <Icon name="pause" size={13} /> : <Icon name="play" size={13} />}
                    </button>
                    <button onClick={() => chooseMusic(m)} className="min-h-9 shrink-0 rounded-full bg-accent px-3 text-2xs font-extrabold">Use</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showLength && !isVideoFile && (
            <div className="border-t border-white/10 px-3 pb-2 pt-3">
              <div className="flex gap-2" role="radiogroup" aria-label="Story length in seconds">
                {[3, 5, 8, 12].map(s => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={timer === s}
                    onClick={() => setTimer(s)}
                    className={`min-h-9 flex-1 rounded-xl text-2xs font-extrabold ${timer === s ? 'bg-white text-ink' : 'bg-white/10 text-white'}`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-1.5 overflow-x-auto border-t border-white/10 px-3 py-2">
            {([
              { id: 'filters', label: 'Filters', icon: 'sparkle', photoOnly: true },
              { id: 'text', label: 'Text', icon: 'pencil', photoOnly: true },
              { id: 'stickers', label: 'Stickers', icon: 'smile', photoOnly: true },
              { id: 'music', label: 'Music', icon: 'music', photoOnly: false },
              { id: 'length', label: 'Length', icon: 'clock', photoOnly: true },
            ] as const).filter(t => !(isVideoFile && t.photoOnly)).map(t => {
              const active = t.id === 'filters' ? showFilters
                : t.id === 'text' ? showText
                : t.id === 'stickers' ? showStickers
                : t.id === 'music' ? showMusic
                : showLength
              return (
                <button
                  key={t.id}
                  onClick={() => openTool(t.id)}
                  aria-pressed={active}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-2xs font-extrabold transition ${active ? 'bg-white text-ink' : 'bg-white/10 text-white'}`}
                >
                  <Icon name={t.icon} size={14} /> {t.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {notice && <div className="px-3 pb-2"><ErrorMessage message={notice} /></div>}

      {adjusting && fileObj && fileObj.type.startsWith('image/') && (
        <ImageAdjuster file={fileObj} onCancel={() => setAdjusting(false)} onDone={applyAdjust} />
      )}
    </div>
  )
}
