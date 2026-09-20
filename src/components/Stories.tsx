import MediaThumbnail from './MediaThumbnail'
import { useState, useEffect, useRef } from 'react'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { shareStoryToWhatsApp } from '../lib/whatsappShare'
import ImageAdjuster from './ImageAdjuster'
import SocialEditor from './SocialEditor'

// STORY VIEWER — immersive full-screen, auto-advance to next USER.
// Photo stories advance on a 4s timer; VIDEO stories play in full — the
// progress bar tracks the video itself and the next story loads on 'ended'.
export default function StoryViewer({ idx, setIdx, allStories, users = [], onOpenUser, onDeleted }: { idx: number; setIdx: (n: number | null) => void; allStories: any[]; users?: any[]; onOpenUser?: (u: any) => void; onDeleted?: (id: string) => void }) {
  const s = allStories[idx]
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [videoState, setVideoState] = useState<'loading' | 'playing' | 'blocked' | 'error'>('loading')
  const [deleting, setDeleting] = useState(false)
  const [reply, setReply] = useState('')
  const [replies, setReplies] = useState<any[]>([])
  const [replyBusy, setReplyBusy] = useState(false)
  const [showReplies, setShowReplies] = useState(false)
  const [editing, setEditing] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const historyPushedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const duration = 4000
  const isLastStory = idx >= allStories.length - 1
  const isVideo = Boolean(s?.video)
  const me = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const isAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false } })()
  const canDelete = Boolean(s?.id && (s.username === me || isAdmin))
  const canEdit = canDelete
  const loadReplies = async () => { try { const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/,''); const t=localStorage.getItem('harvest_token')||''; const r=await fetch(API+'/api/stories/'+encodeURIComponent(String(s.id))+'/replies',{headers:t?{Authorization:'Bearer '+t}:undefined}); const d=await r.json(); if(r.ok)setReplies(d.replies||[]) } catch {} }
  const sendReply = async () => { if(!reply.trim()||replyBusy)return; setReplyBusy(true); try { const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/,''); const t=localStorage.getItem('harvest_token')||''; const r=await fetch(API+'/api/stories/'+encodeURIComponent(String(s.id))+'/replies',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({body:reply.trim()})}); const d=await r.json(); if(!r.ok)throw new Error(d.error||'Could not send reply'); setReplies(x=>[...x,d.reply]); setReply(''); setShowReplies(true) } catch(e:any){window.alert(e.message||'Could not send reply')} finally{setReplyBusy(false)} }

  // Keep the Story viewer above the Android keyboard and make system Back close it.
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

  // Advance helper shared by photo timer and video 'ended'.
  const goNext = () => {
    if (idx < allStories.length - 1) setIdx(idx + 1)
    else setIdx(null)
  }

  // Photo auto-advance (videos advance via onended instead).
  useEffect(() => {
    if (!s || isVideo) return undefined
    setProgress(0)
    setIsPaused(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (isPaused) return undefined
    timerRef.current = setTimeout(() => goNext(), duration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [idx, isPaused, setIdx, allStories.length, duration, s, isVideo])

  // Reset per-story state.
  useEffect(() => {
    setVideoState('loading')
    setProgress(0)
    setIsPaused(false)
  }, [idx])

  // Video: try autoplay (muted is allowed in WebViews); fall back to an
  // explicit play() and, if that is blocked, a tap-to-play overlay. Without
  // this the raw video element shows a giant dead play glyph.
  useEffect(() => {
    if (!s || !isVideo) return
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    const tryPlay = () => {
      v.play().then(() => setVideoState('playing')).catch(() => setVideoState('blocked'))
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
  }, [idx, s, isVideo])

  // Pause/play sync for videos.
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

  // Photo progress interval (video progress comes from onTimeUpdate).
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

  // Record a unique view when the story becomes active. The server keys views by
  // story ID + member, so revisiting a story is idempotent.
  useEffect(() => {
    if (!s?.id) return
    const token = localStorage.getItem('harvest_token') || ''
    const API = (import.meta.env.VITE_API_URL || '').replace(/\\/$/, '')
    if (!token || !API) return
    void fetch(API + '/api/stories/' + encodeURIComponent(String(s.id)) + '/view', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }).catch(() => {})
  }, [s?.id])

  useEffect(() => { if (s?.id) { setReplies([]); setReply(''); void loadReplies() } }, [s?.id])
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
      window.alert(err?.message || 'Could not delete story')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col overscroll-none select-none" style={{ paddingBottom: keyboardInset ? `${keyboardInset}px` : "env(safe-area-inset-bottom)" }} onClick={handleTap}>
      <div className="flex gap-1 p-2 pt-3">{allStories.map((_: any, i: number) => <div key={i} className="flex-1 h-1 bg-zinc-800 rounded overflow-hidden relative"><div className="h-full bg-white rounded" style={{ width: i < idx ? '100%' : i === idx ? `${progress}%` : '0%', transition: i === idx ? 'none' : 'width 0.3s' }} /></div>)}</div>
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={(e) => { e.stopPropagation(); onOpenUser?.({ username: s.username || s.name, name: s.name }) }} className="flex items-center gap-3" aria-label={`View ${s.name}'s profile`}><div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold">{s.me ? '＋' : s.name[0].toUpperCase()}</div></div><div><p className="text-sm font-semibold text-white">{s.name}</p>{users.find((u: any) => u.username === s.name)?.role && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${users.find((u: any) => u.username === s.name)?.role === 'admin' ? 'bg-purple-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>{users.find((u: any) => u.username === s.name)?.role || 'member'}</span>}</div></button>
        <div className="flex items-center gap-2">{canDelete && <button onClick={deleteStory} disabled={deleting} className="min-w-11 min-h-11 px-2 text-white disabled:opacity-50 flex items-center justify-center" aria-label="Delete story" title="Delete story">{deleting ? '…' : '🗑'}</button>}{!isLastUserStory && <button onClick={(e) => { e.stopPropagation(); setIsPaused(!isPaused) }} className="min-w-11 min-h-11 px-2 text-white flex items-center justify-center">⏸</button>}<button onClick={(e) => { e.stopPropagation(); shareStoryToWhatsApp({ author: s.name, caption: s.caption, id: String(s.id) }) }} className="min-w-11 min-h-11 px-2 text-[#25D366] flex items-center justify-center" aria-label="Share story to WhatsApp" title="Share to WhatsApp">↗ WhatsApp</button><button onClick={(e) => { e.stopPropagation(); setIdx(null) }} className="min-w-11 min-h-11 px-2 text-white flex items-center justify-center">✕</button></div>
      </div>
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* object-contain: the whole photo/video stays visible and centered
            (posters/flyers keep their edges) instead of being cropped to fill. */}
        {s.img && !isVideo && <img src={s.img} alt="" className="max-w-full max-h-full w-auto h-auto object-contain" />}
        {isVideo && (
          <>
            <video
              ref={videoRef}
              src={s.video}
              muted
              playsInline
              preload="auto"
              onEnded={goNext}
              onTimeUpdate={e => { const el = e.currentTarget; if (el.duration > 0) setProgress((el.currentTime / el.duration) * 100) }}
              onError={() => setVideoState('error')}
              className={`max-w-full max-h-full w-auto h-auto object-contain ${videoState === 'playing' || videoState === 'blocked' ? '' : 'opacity-0'}`}
            />
            {videoState === 'loading' && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-12 h-12 rounded-full border-2 border-white/30 border-t-white animate-spin" /></div>}
            {videoState === 'blocked' && (
              <button
                onClick={e => { e.stopPropagation(); const v = videoRef.current; if (v) v.play().then(() => setVideoState('playing')).catch(() => setVideoState('error')) }}
                className="absolute inset-0 flex items-center justify-center bg-black/40"
                aria-label="Play story video"
              >
                <span className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-3xl text-black shadow-2xl">▶</span>
              </button>
            )}
            {videoState === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none">
                <p className="text-sm text-zinc-300">Video could not load</p>
                <p className="text-[11px] text-zinc-500 mt-1">Check your connection and try again</p>
              </div>
            )}
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6"><p className="font-bold text-white text-lg">{s.name}</p><p className="text-sm text-zinc-300 mt-1">{s.caption || 'Harvest story 🙏'}</p>{s.music && <div className="flex gap-2 items-center mt-2 p-2 bg-black/60 rounded-lg"><img src={s.music.cover} className="w-8 h-8 rounded" /><div className="flex-1"><p className="text-xs font-semibold">🎵 {s.music.title}</p><p className="text-[11px] text-zinc-400">{s.music.artist}</p></div><a href={s.music.url} target="_blank" rel="noreferrer" className="text-xs bg-white text-black px-2 py-1 rounded-full">▶</a></div>}</div>
        {idx > 0 && <button onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); setIdx(idx - 1) }} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 flex items-center justify-center text-white text-xl">‹</button>}
        {!isLastUserStory && <button onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); if (idx < allStories.length - 1) setIdx(idx + 1) }} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/20 flex items-center justify-center text-white text-xl">›</button>}
      </div>
      {showReplies && <div onClick={e=>e.stopPropagation()} className="absolute left-3 right-3 max-h-40 overflow-auto rounded-2xl bg-black/80 p-3 text-white" style={{ bottom: keyboardInset ? `${keyboardInset + 64}px` : "calc(env(safe-area-inset-bottom) + 6rem)" }}><div className="flex justify-between mb-2"><b className="text-xs">Replies</b><button onClick={()=>setShowReplies(false)}>×</button></div>{replies.length ? replies.map((r:any)=><p key={r.id} className="text-xs py-1"><b>{r.name||r.username}</b> {r.body}</p>) : <p className="text-xs text-zinc-400">No replies yet.</p>}</div>}
      <div onClick={e=>e.stopPropagation()} className="absolute left-3 right-3 flex gap-2" style={{ bottom: keyboardInset ? `${keyboardInset + 12}px` : "calc(env(safe-area-inset-bottom) + 3rem)" }}><input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void sendReply()}} placeholder="Reply to this story…" className="flex-1 min-h-11 rounded-full bg-white/95 text-black px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-400" /><button onClick={()=>void sendReply()} disabled={replyBusy} className="min-h-11 rounded-full bg-purple-600 text-white px-4 py-2 text-xs font-bold">{replyBusy?'…':'Send'}</button><button onClick={()=>{setShowReplies(v=>!v); if(!showReplies)void loadReplies()}} className="min-w-11 min-h-11 rounded-full bg-white/20 text-white px-3 py-2 text-xs">💬 {replies.length||''}</button></div>
      {canEdit && <button onClick={e=>{e.stopPropagation();setEditing(true)}} className="absolute top-14 right-16 min-h-11 text-white text-xs bg-black/50 px-3 py-2 rounded-full">✎ Edit</button>}
      {editing && <SocialEditor kind="story" id={String(s.id)} caption={s.caption||''} musicTrack={s.music} onDone={()=>{setEditing(false);window.location.reload()}} />}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-zinc-500">{isLastUserStory ? 'Tap to close' : '← Tap to rewind • Hold to pause • → Tap to forward'}</div>
    </div>
  )
}

const FILTERS = ['Original', 'Clarendon', 'Juno', 'Aden', 'Lark', 'Moody', 'Valencia', 'Perpetua', 'Willow', 'Gingham']
const STORY_STICKERS = ['🙏', '🔥', '❤️', '🎵', '🎤', '📍', '📷', '✝️', '🕊️', '💜', '👏', '😍', '🤗', '✨', '🎉', '🍕', '🌟', '⚽', '🎸', '💎']
const STORY_MUSIC = ['Worship 🎵', 'Hillsong 🎶', 'Sinach 🎤', 'Maverick 🔥', 'Elevation 🙏', 'Harvest 🎹']

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
  const [previewId, setPreviewId] = useState<any>(null)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  const isVideoFile = Boolean(fileObj?.type.startsWith('video/'))
  const [timer, setTimer] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [showMusic, setShowMusic] = useState(false)
  const [showMood, setShowMood] = useState(false)
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
  const applyFilter = (imgUrl: string, f: string) => { if (f === 'Original') return imgUrl; const c = document.createElement('canvas'); const ctx = c.getContext('2d'); if (!ctx) return imgUrl; const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { c.width = img.width; c.height = img.height; ctx.filter = f === 'Clarendon' ? 'saturate(1.2) contrast(1.1)' : f === 'Juno' ? 'saturate(1.4) contrast(1.15) brightness(1.1)' : f === 'Moody' ? 'saturate(0.8) contrast(1.3) brightness(0.85)' : f === 'Valencia' ? 'saturate(1.5) contrast(1.1) brightness(1.1)' : f === 'Willow' ? 'saturate(0.7) contrast(1.15) brightness(1.1)' : f === 'Gingham' ? 'saturate(1.3) contrast(1.2) brightness(1.1)' : f === 'Lark' ? 'saturate(0.9) contrast(1.0) brightness(1.1)' : f === 'Perpetua' ? 'saturate(1.1) contrast(1.2) brightness(1.15)' : f === 'Aden' ? 'saturate(1.3) contrast(1.0) brightness(0.95)' : ''; ctx.drawImage(img, 0, 0); setFileUrl(c.toDataURL()) }; img.src = imgUrl }
  const addSticker = (s: string) => { if (!stickers.includes(s)) setStickers([...stickers, s]) }
  const removeSticker = (s: string) => setStickers(stickers.filter(x => x !== s))
  const searchMusic = async (term: string) => { if (!term.trim()) { setMusicResults([]); return }; setMusicLoading(true); try { const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=8`); const j = await r.json(); setMusicResults(j.results.map((x: any) => ({ id: x.trackId, title: x.trackName, artist: x.artistName, cover: x.artworkUrl100?.replace('100x100', '200x200'), url: x.previewUrl }))) } catch { setMusicResults([]) }; setMusicLoading(false) }
  const togglePreview = (m: any) => { if (previewId === m.id) { previewRef.current?.pause(); setPreviewId(null); return }; if (previewRef.current) previewRef.current.pause(); const a = new Audio(m.url); a.play().catch(() => {}); (previewRef as any).current = a; setPreviewId(m.id); a.onended = () => setPreviewId(null) }
  const chooseMusic = (m: any) => { setMusicTrack(m); setShowMusic(false); setMusicQuery(''); setMusicResults([]) }
  const MOOD_PICKS = [
    { mood: '🙏 Worship', tags: ['worship', 'praise', 'hymn'] },
    { mood: '🎶 Choir', tags: ['choir', 'choral'] },
    { mood: '🔥 Youth', tags: ['youth', 'gospel'] },
    { mood: '❤️ Hymns', tags: ['hymn', 'traditional'] },
    { mood: '🎤 Gospel', tags: ['gospel', 'praise'] },
  ]
  const filterByMood = (tags: string[]) => { setShowMood(false); const matches = STORY_MUSIC.filter((m: any) => tags.some((t: string) => m.toLowerCase().includes(t))); if (matches.length) chooseMusic(matches[Math.floor(Math.random() * matches.length)]) }
  // Story uploads run in the background: the composer closes instantly and a
  // floating progress pill tracks the transfer (stories publish instantly, 24h expiry).
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
        },
      }).catch(() => {})
      onDone()
    } catch (e: any) {
      setNotice(e?.message || 'Could not share your story')
      setBusy(false)
    }
  }
  return (
    <div className="bg-zinc-50 text-white min-h-[calc(100vh-49px)] flex flex-col">
      <div className="flex justify-between items-center px-4 h-[56px] border-b border-zinc-200 bg-white"><button onClick={onDone} className="text-xl text-zinc-700">✕</button><p className="font-semibold text-sm text-zinc-900">Create Story</p><button onClick={() => void submit()} disabled={busy} className={`font-semibold text-sm ${busy ? 'text-zinc-400' : 'text-[#0095f6]'}`}>{busy ? 'Sharing…' : 'Share'}</button></div>
      <div className="flex-1 flex items-center justify-center p-4 relative bg-gradient-to-b from-zinc-50 to-white">{!fileUrl ? <label className="w-full aspect-[9/16] bg-white rounded-2xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center cursor-pointer hover:border-[#0095f6] transition"><input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden" /><div className="w-20 h-20 rounded-full bg-[#0095f6] flex items-center justify-center text-4xl text-white">📷</div><p className="text-sm text-zinc-600 mt-2">Tap to add story photo/video</p><p className="text-xs text-zinc-400 mt-1">Record with camera or pick from gallery</p></label> : <div className="relative aspect-[9/16] w-full max-w-[320px] mx-auto overflow-hidden rounded-2xl border border-zinc-200 shadow-lg bg-zinc-900">{isVideoFile
            ? <video src={fileUrl} controls playsInline className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain" />
            : <img src={fileUrl} alt="" className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain" />}{filter !== 'Original' && <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">🎨 {filter}</div>}{fileName && <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">📎 {fileName}</div>}{!isVideoFile && <button onClick={() => setAdjusting(true)} className="absolute top-9 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full font-bold">✎ Adjust</button>}{textOverlay && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/30 rounded-xl px-4 py-2" style={{ color: textColor, fontSize: '24px', fontWeight: textBold ? 'bold' : 'normal', textShadow: '2px 2px 4px rgba(0,0,0,0.8)' }}>{textOverlay}</div></div>}<div className="absolute bottom-8 left-4 flex gap-1 flex-wrap">{stickers.map((s, i) => <span key={i} className="text-2xl bg-black/50 rounded-full px-1 cursor-pointer hover:scale-110 transition" onClick={() => removeSticker(s)}>{s}</span>)}</div>{musicTrack && <div className="absolute top-14 right-4 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">🎵 {musicTrack.title}</div>}</div>}</div>
      {fileUrl && !isVideoFile && <><div className="px-4 pb-2 bg-white border-t border-zinc-200"><button onClick={() => { setShowFilters(!showFilters); setShowStickers(false); setShowMusic(false) }} className="text-xs text-[#0095f6] font-semibold">🎨 Filter: {filter}</button>{showFilters && <div className="flex gap-2 overflow-x-auto pb-2 mt-1">{FILTERS.map(f => <button key={f} onClick={() => { setFilter(f); applyFilter(fileUrl, f); setShowFilters(false) }} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filter === f ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-700'}`}>{f}</button>)}</div>}</div><div className="px-4 pb-2 bg-white border-t border-zinc-200"><button onClick={() => { setShowStickers(!showStickers); setShowFilters(false); setShowMusic(false) }} className="text-xs text-[#0095f6] font-semibold">📷 Stickers: {stickers.length > 0 ? stickers.join(' ') : 'none'}</button>{showStickers && <div className="flex gap-2 overflow-x-auto pb-2 mt-1 flex-wrap">{STORY_STICKERS.map(s => <button key={s} onClick={() => stickers.includes(s) ? removeSticker(s) : addSticker(s)} className={`text-xl px-2 py-1 rounded-full ${stickers.includes(s) ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-700'}`}>{s}</button>)}</div>}</div><div className="px-4 pb-2 bg-white border-t border-zinc-200 rounded-xl p-2"><button onClick={() => { setShowMusic(!showMusic); setShowMood(!showMood); setShowFilters(false); setShowStickers(false) }} className="text-xs text-[#0095f6] font-semibold">🎵 Music {musicTrack ? `• ${musicTrack.title} ✓` : ''}</button>{musicTrack && <div className="flex gap-2 items-center mt-2 p-2 bg-zinc-50 rounded-lg"><img src={musicTrack.cover} className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{musicTrack.title}</p><p className="text-[11px] text-zinc-400 truncate">{musicTrack.artist}</p></div><button onClick={() => togglePreview(musicTrack)} className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-xs">{previewId === musicTrack.id ? '⏸' : '▶'}</button><button onClick={() => setMusicTrack(null)} className="text-xs text-red-400">✕</button></div>}{showMood && <div className="flex gap-2 flex-wrap mt-2">{MOOD_PICKS.map(m => <button key={m.mood} onClick={() => filterByMood(m.tags)} className="px-3 py-2 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">{m.mood}</button>)}</div>}{showMusic && !showMood && <div className="mt-2"><div className="flex gap-2"><input value={musicQuery} onChange={e => { setMusicQuery(e.target.value); searchMusic(e.target.value) }} onKeyDown={e => e.key === 'Enter' && searchMusic(musicQuery)} placeholder="Search Hillsong/Maverick..." className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-3 py-2 text-xs outline-none" /><button onClick={() => searchMusic(musicQuery)} className="px-3 py-2 rounded-full bg-[#0095f6] text-white text-xs font-bold">Search</button></div>{musicLoading && <p className="text-xs text-zinc-500 text-center py-2">Searching…</p>}{!musicLoading && musicResults.length === 0 && musicQuery && <p className="text-xs text-zinc-500 text-center py-2">No results — try Hillsong/Maverick/Sinach</p>}{!musicLoading && musicResults.length === 0 && !musicQuery && <div className="flex gap-2 flex-wrap mt-2">{['Hillsong', 'Maverick', 'Sinach', 'Elevation', 'Harvest'].map(t => <button key={t} onClick={() => { setMusicQuery(t); searchMusic(t) }} className="px-3 py-1 rounded-full bg-zinc-100 text-xs">{t}</button>)}</div>}{musicResults.map((m: any) => <div key={m.id} className="flex gap-2 p-2 bg-zinc-50 rounded-lg items-center"><img src={m.cover} className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{m.title}</p><p className="text-[11px] text-zinc-400 truncate">{m.artist}</p></div><button onClick={() => togglePreview(m)} className="w-7 h-7 rounded-full bg-zinc-200 flex items-center justify-center text-xs">{previewId === m.id ? '⏸' : '▶'}</button><button onClick={() => chooseMusic(m)} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Use</button></div>)}</div>}</div><div className="px-4 pb-2 bg-white border-t border-zinc-200"><p className="text-xs text-[#0095f6] mb-1 font-semibold">✏️ Text overlay</p><input value={textOverlay} onChange={e => setTextOverlay(e.target.value)} placeholder="Add bold text..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none" /><div className="flex gap-2 mt-1 items-center"><span className="text-xs text-zinc-400">Color:</span>{['#ffffff', '#0095f6', '#ed4956', '#f77737', '#40d657', '#b546cf', '#000000'].map(c => <button key={c} onClick={() => setTextColor(c)} className="w-6 h-6 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: c }} />)}<button onClick={() => setTextBold(!textBold)} className={`ml-2 px-2 py-1 rounded-full text-xs font-bold ${textBold ? 'bg-[#0095f6] text-white' : 'bg-zinc-200 text-zinc-600'}`}>B:{textBold?'on':'off'}</button></div></div><div className="px-4 pb-2 bg-white border-t border-zinc-200"><p className="text-xs text-[#0095f6] mb-1 font-semibold">⏱️ Story timer</p><div className="flex gap-2">{[0, 3, 5, 10, 15].map(s => <button key={s} onClick={() => setTimer(s)} className={`px-3 py-1 rounded-full text-xs ${timer === s ? 'bg-[#0095f6] text-white' : 'bg-zinc-100 text-zinc-700'}`}>{s === 0 ? 'Off' : `${s}s`}</button>)}</div></div></>}
      {notice && <div role="alert" className="mx-4 mb-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
      {adjusting && fileObj && fileObj.type.startsWith('image/') && (
        <ImageAdjuster file={fileObj} onCancel={() => setAdjusting(false)} onDone={applyAdjust} />
      )}
      <div className="px-4 pb-4 bg-white border-t border-zinc-200"><input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write a caption..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none" /></div>
    </div>
  )
}
