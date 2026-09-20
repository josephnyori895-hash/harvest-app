import MediaThumbnail from './MediaThumbnail'
import { useState, useMemo, useEffect, useRef } from 'react'
import { getLikesTable, toggleLikeKey } from '../state/auth'
import { fetchFeed, useApi } from '../lib/api'
import StoryViewer from './Stories'
import Comments from './Comments'
import { showToast } from './Toast'
import { sharePostToWhatsApp, shareStoryToWhatsApp } from '../lib/whatsappShare'
import SocialEditor from './SocialEditor'

function timeAgo(iso?: string) {
  if (!iso) return 'Just now'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

// No demo posts: the community feed renders only real posts from the API.
// When there are no posts yet, an honest empty state is shown.

function MediaPreview({ src, poster, alt = '' }: { src: string; poster?: string; alt?: string }) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setReady(false); setFailed(false)
    if (!poster) { setReady(true); return () => { cancelled = true } }
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => { if (!cancelled) setReady(true) }
    img.onerror = () => { if (!cancelled) setFailed(true) }
    img.src = poster
    return () => { cancelled = true; img.onload = null; img.onerror = null }
  }, [poster])
  return <div className="relative w-full aspect-[4/3] overflow-hidden bg-[#F4E8D0]">
    {!ready && !failed && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#F4E8D0] via-[#EDE9FE] to-[#F4E8D0]" aria-label="Loading video preview" />}
    {poster && !failed && <img src={poster} alt={alt} decoding="async" fetchPriority="high" className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`} />}
    {failed && <div className="absolute inset-0 flex items-center justify-center text-4xl" aria-label="Video preview unavailable">🎥</div>}
    <video src={src} poster={poster || undefined} controls playsInline preload={poster ? "metadata" : "auto"} className={`absolute inset-0 w-full h-full object-cover bg-[#1a1714] shadow-inner transition-opacity duration-200 ${ready || !poster ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} aria-label="Video" />
    {poster && ready && <span className="absolute inset-0 pointer-events-none flex items-center justify-center"><span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-2xl text-white">▶</span></span>}
  </div>
}

const updatesBase: any[] = []

const quickLinks = [
  { tab: 'chat', icon: '🙏', title: 'Prayer', text: 'Pray with someone' },
  { tab: 'groups', icon: '👥', title: 'Groups', text: 'Find your community' },
  { tab: 'departments', icon: '🤝', title: 'Departments', text: 'Serve with your gifts' },
  { tab: 'give', icon: '🤲', title: 'Give', text: 'Support the ministry' },
  { tab: 'music', icon: '🎶', title: 'Worship', text: 'Listen & worship' },
]

export default function Home({ setTab, users, onDeleteStory, refreshKey, onSwitchAccount, onOpenUser, sharedContent, onSharedContentHandled }: { setTab: (t: string) => void; users: any[]; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: () => void; onOpenUser?: (u: any) => void; sharedContent?: { kind: 'post' | 'story' | 'reel'; id: string } | null; onSharedContentHandled?: () => void }) {
  const [momentIdx, setMomentIdx] = useState<number | null>(null)
  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(() => new Set())
  const [likesTick, setLikesTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [approvedTick, setApprovedTick] = useState(0)
  const [editPost, setEditPost] = useState<any | null>(null)
  const [menuPost, setMenuPost] = useState<{ key: string; kind: 'post' | 'reel'; id: string; user: string; caption: string; mine: boolean } | null>(null)
  // Admin-editable home content (hero banner + weekly verse). Falls back to
  // the shipped defaults when the fetch fails or values are not set.
  const [content, setContent] = useState<Record<string, string>>({})
  useEffect(() => {
    const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    fetch(`${API}/api/content`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setContent(d?.content || {}))
      .catch(() => { /* defaults stay */ })
  }, [])
  const heroKicker = content.hero_kicker || 'Karibu, family'
  const heroTitle = content.hero_title || 'Compel. Raise. Release.'
  const heroSubtitle = content.hero_subtitle || 'Get one saved, keep one saved, get another saved.'
  const verseText = content.verse_text || 'Let us consider how we may spur one another on toward love and good deeds.'
  const verseRef = content.verse_ref || 'Hebrews 10:24 · Grow together'
  // Inline post comments (server-backed) — replaces the old "dump into chats" button.
  const [commentTarget, setCommentTarget] = useState<{ scope: 'post' | 'reel'; id: string; key: string } | null>(null)
  // Server-backed community feed (only in API mode; offline mode stays localStorage-first).
  const api = useApi()
  const [livePosts, setLivePosts] = useState<any[]>([])
  const [liveStories, setLiveStories] = useState<any[]>([])
  const [feedTick, setFeedTick] = useState(0)
  const [feedLoaded, setFeedLoaded] = useState(false)
  const [feedLoadFailed, setFeedLoadFailed] = useState(false)
  const pendingLikesRef = useRef(new Set<string>())

  const approvedMoments: any[] = [] // demo approval flow removed — server API is the source of truth
  const approvedPosts: any[] = []

  useEffect(() => {
    if (!api) return undefined
    let cancelled = false
    setFeedLoadFailed(false)
    fetchFeed(0, 20)
      .then((d: any) => {
        if (cancelled) return
        setLivePosts(Array.isArray(d?.posts) ? d.posts : [])
        setLiveStories(Array.isArray(d?.stories) ? d.stories : [])
        setFeedLoaded(true)
      })
      .catch((e: any) => {
        if (cancelled) return
        setFeedLoadFailed(true)
        setFeedLoaded(true)
        console.warn('[feed] load failed', e?.message || e)
      })
    return () => { cancelled = true }
  }, [api, feedTick])

  useEffect(() => {
    const bump = () => setApprovedTick(x => x + 1)
    window.addEventListener('storage', bump); window.addEventListener('harvest:approved' as any, bump); window.addEventListener('harvest:verified' as any, bump)
    return () => { window.removeEventListener('storage', bump); window.removeEventListener('harvest:approved' as any, bump); window.removeEventListener('harvest:verified' as any, bump) }
  }, [])

  useEffect(() => {
    if (!refreshKey) return
    setRefreshing(true); setApprovedTick(x => x + 1); setLikesTick(x => x + 1); setFeedTick(x => x + 1)
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    showToast('Community refreshed', 'success', 1200)
    const t = setTimeout(() => setRefreshing(false), 700); return () => clearTimeout(t)
  }, [refreshKey])

  // Map API rows onto the card shape this screen already renders.
  const liveMoments = useMemo(() => liveStories.map((s: any) => ({
    name: s.name || s.username || 'Harvest',
    username: s.username || '',
    id: s.id,
    label: 'Story',
    // thumb_url is a poster IMAGE only — the server never hands a video URL
    // here anymore (a video in <img> renders the broken-image glyph in rings).
    img: s.thumb_url || undefined,
    video: s.media_type === 'video' ? (s.video_url || undefined) : undefined,
    caption: s.caption,
  })), [liveStories])

  // IG-style grouping: one ring per person, no matter how many stories they posted.
  // Each group keeps the flat indices so tapping the ring opens that person's full
  // sequence in the StoryViewer (which advances through everything, then the next
  // person — exactly like Instagram).
  const storyGroups = useMemo(() => {
    const map = new Map<string, { name: string; username: string; items: any[] }>()
    liveMoments.forEach((m: any, i: number) => {
      const gk = m.username || m.name
      const g = map.get(gk)
      if (g) g.items.push({ ...m, flatIndex: i })
      else map.set(gk, { name: m.name, username: m.username, items: [{ ...m, flatIndex: i }] })
    })
    return [...map.values()]
  }, [liveMoments])

  const liveUpdates = useMemo(() => livePosts.map((p: any) => ({
    id: p.id,
    key: `api_${p.kind}_${p.id}`,
    user: p.name || p.username || 'Harvest member',
    username: p.username,
    verified: Boolean(p.verified),
    loc: [p.group_name, p.constituency].filter(Boolean).join(' · ') || 'Harvest Family Church',
    time: timeAgo(p.created_at),
    likes: Number(p.likes) || 0,
    comments: Number(p.comments) || 0,
    // Reels: the video itself is the preview (posters are optional). Only real
    // images go through img — feeding a video URL to <img> renders broken.
    img: p.kind === 'reel' ? undefined : (p.thumb_url || undefined),
    video: p.kind === 'reel' ? (p.hls_url || undefined) : undefined,
    caption: p.caption || '',
    kind: p.is_pinned ? 'Pinned' : p.kind === 'reel' ? 'Video' : 'Community',
    music: p.music || null,
    liked: Boolean(p.liked),
  })), [livePosts])

  // Viewer list: live stories ONLY. The 'Your moment' composer placeholder must
  // never be in here or the viewer lands on an empty black story at the end.
  const allMoments = useMemo(() => liveMoments, [liveMoments])
  const allUpdates = useMemo(() => (liveUpdates.length ? liveUpdates : []), [liveUpdates])
  const likesTable = getLikesTable()
  // Declared BEFORE first use (story grouping below reads it).
  const currentUser = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const isAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false } })()
  useEffect(() => {
    if (!sharedContent || sharedContent.kind === 'reel' || !feedLoaded) return
    if (feedLoadFailed) {
      showToast('Unable to open that shared content right now. Please try again.', 'warning', 3000)
      onSharedContentHandled?.()
      return
    }
    if (sharedContent.kind === 'story') {
      const index = allMoments.findIndex((s: any) => String(s.id) === sharedContent.id)
      if (index >= 0) {
        setMomentIdx(index)
      } else {
        showToast('That shared story is no longer available.', 'warning', 2500)
      }
      onSharedContentHandled?.()
      return
    }
    const postIndex = livePosts.findIndex((p: any) => String(p.id) === sharedContent.id)
    if (postIndex >= 0) {
      const el = document.querySelector(`[data-post-id="${CSS.escape(sharedContent.id)}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      showToast('That shared post is no longer available.', 'warning', 2500)
    }
    onSharedContentHandled?.()
  }, [sharedContent, feedLoaded, feedLoadFailed, livePosts, allMoments, onSharedContentHandled])
  const markStoryViewed = (id: string) => {
    setViewedStoryIds(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }
  const myStoryGroup = storyGroups.find(g => g.username === currentUser)
  const toggleLike = async (key: string) => {
    if (pendingLikesRef.current.has(key)) return
    const post = livePosts.find((p: any) => `api_${p.kind}_${p.id}` === key)
    if (api && post?.id) {
      pendingLikesRef.current.add(key)
      const wasLiked = Boolean(post.liked)
      setLivePosts(ps => ps.map((p: any) => `api_${p.kind}_${p.id}` === key
        ? { ...p, liked: !wasLiked, likes: Math.max((Number(p.likes) || 0) + (wasLiked ? -1 : 1), 0) }
        : p))
      try {
        const token = localStorage.getItem('harvest_token') || ''
        const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
        const res = await fetch(`${API}/api/likes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ scope: post.kind === 'reel' ? 'reel' : 'post', id: String(post.id) }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `Could not update like (${res.status})`)
        setLivePosts(ps => ps.map((p: any) => `api_${p.kind}_${p.id}` === key
          ? { ...p, liked: Boolean(data.liked), likes: Number(data.likes) || 0 }
          : p))
        showToast(data.liked ? 'Added to your gratitude ❤️' : 'Appreciation removed', 'success', 1000)
      } catch (e: any) {
        setLivePosts(ps => ps.map((p: any) => `api_${p.kind}_${p.id}` === key
          ? { ...p, liked: wasLiked, likes: Number(post.likes) || 0 }
          : p))
        showToast(e?.message || 'Could not update appreciation', 'error', 2000)
      } finally {
        pendingLikesRef.current.delete(key)
      }
      return
    }
    toggleLikeKey(key)
    setLikesTick(x => x + 1)
    showToast('Added to your gratitude ❤️', 'success', 1000)
  }
  const bumpCommentCount = (key: string, delta: number) => {
    setLivePosts(ps => ps.map((p: any) => {
      const k = `api_${p.kind}_${p.id}`
      return k === key ? { ...p, comments: Math.max((Number(p.comments) || 0) + delta, 0) } : p
    }))
  }
  const clearCache = () => { localStorage.removeItem('harvest_pending'); localStorage.removeItem('harvest_approved_posts'); localStorage.removeItem('harvest_approved_stories'); localStorage.removeItem('harvest_scheduled'); localStorage.removeItem('harvest_cache'); window.dispatchEvent(new Event('harvest:cache-clear')); showToast('Local cache cleared', 'success') }

  // Instagram-style delete: authors remove their own posts/stories; admin can remove anything.
  const deleteMedia = async (kind: 'post' | 'reel' | 'story', id: string) => {
    if (!window.confirm('Delete this? This cannot be undone.')) return
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${API}/api/${kind === 'post' ? 'posts' : kind === 'reel' ? 'reels' : 'stories'}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not delete (${r.status})`)
      if (kind === 'story') {
        setLiveStories(ss => ss.filter(x => String(x.id) !== String(id)))
      } else {
        setLivePosts(ps => ps.filter(x => !(String(x.id) === String(id) && (kind === 'reel' ? x.kind === 'reel' : x.kind !== 'reel'))))
      }
      showToast('Deleted', 'success', 1500)
    } catch (e: any) {
      showToast(e?.message || 'Could not delete', 'error', 2500)
    }
  }

  const onTouchStart = (e: any) => { startYRef.current = e.touches[0].clientY }
  const onTouchEnd = (e: any) => {
    if (startYRef.current === null) return
    const dy = e.changedTouches[0].clientY - startYRef.current; startYRef.current = null
    if (dy > 80 && containerRef.current && containerRef.current.scrollTop < 5 && !refreshing) { setRefreshing(true); setApprovedTick(x => x + 1); setLikesTick(x => x + 1); setFeedTick(x => x + 1); showToast('Community refreshed', 'success', 1200); setTimeout(() => setRefreshing(false), 700) }
  }

  return <div ref={containerRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-[calc(100vh-72px)] overflow-auto bg-[#FFFBF0] text-[#29251F]">
    {momentIdx !== null && <StoryViewer idx={momentIdx} setIdx={setMomentIdx} allStories={allMoments} users={users} onOpenUser={onOpenUser} onViewed={markStoryViewed} onDeleted={(id) => { setLiveStories(ss => ss.filter(x => String(x.id) !== String(id))) }} />}
    {commentTarget && (
      <Comments
        scope={commentTarget.scope}
        postId={commentTarget.id}
        me={currentUser}
        isAdmin={isAdmin}
        onCountChange={d => bumpCommentCount(commentTarget.key, d)}
        onClose={() => setCommentTarget(null)}
      />
    )}

    <header className="sticky top-0 z-20 bg-[#FFFBF0]/95 backdrop-blur-md border-b border-[#E8DEC9]">
      <div className="px-4 py-3 flex items-center justify-between">
        <button onClick={() => onSwitchAccount?.()} className="flex items-center gap-3 text-left" aria-label="Open account switcher"><img src="/logo.png" alt="" className="w-10 h-10 rounded-2xl object-contain bg-[#F5F1E8] shadow-sm" /><span><span className="block text-[10px] uppercase tracking-[0.18em] text-[#7C3AED] font-bold">Harvest Family</span><span className="block text-[17px] font-extrabold text-[#29251F] leading-tight">Nyeri</span></span></button>
        <div className="flex items-center gap-2"><button onClick={() => setTab('activity')} className="w-10 h-10 rounded-2xl bg-white border border-[#E8DEC9]" aria-label="Activity">🔔</button><button onClick={() => setTab('chat')} className="w-10 h-10 rounded-2xl bg-white border border-[#E8DEC9]" aria-label="Messages">💬</button>{isAdmin && <button onClick={clearCache} className="w-10 h-10 rounded-2xl bg-[#F4E8D0] border border-[#E8DEC9]" aria-label="Clear local cache">🧹</button>}</div>
      </div>
    </header>

    <main className="px-4 pb-8">
      <section className="pt-5"><div className="rounded-[28px] overflow-hidden bg-gradient-to-br from-[#5B21B6] via-[#6D28D9] to-[#B45309] text-white p-5 shadow-lg shadow-purple-900/10"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.18em] text-amber-200 font-bold">{heroKicker}</p><h1 className="mt-1 text-[28px] leading-tight font-extrabold text-white">{heroTitle}</h1><p className="mt-2 text-sm leading-5 text-purple-50 max-w-[280px]">{heroSubtitle}</p></div><div className="text-5xl select-none" aria-hidden="true">🌿</div></div><div className="mt-5 flex gap-2"><button onClick={() => setTab('chat')} className="px-4 py-2.5 rounded-xl bg-white text-[#5B21B6] text-xs font-extrabold">Ask for prayer</button><button onClick={() => setTab('groups')} className="px-4 py-2.5 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-bold">Find my group</button></div></div></section>

      <section className="mt-5"><div className="mb-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-bold">Today at Harvest</p><h2 className="text-lg font-extrabold">What’s happening</h2></div><div className="grid grid-cols-3 gap-3"><button onClick={() => setTab('chat')} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">🙏</span><p className="mt-2 font-extrabold text-sm">Chats</p><p className="mt-1 text-[11px] text-[#766E63]">Messages, prayer & announcements.</p></button><button onClick={() => setTab('sermons')} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">🎙</span><p className="mt-2 font-extrabold text-sm">Sermons</p><p className="mt-1 text-[11px] text-[#766E63]">Listen, watch & download.</p></button><button onClick={() => setTab('music')} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">🎶</span><p className="mt-2 font-extrabold text-sm">Worship room</p><p className="mt-1 text-[11px] text-[#766E63]">Songs for your week.</p></button></div></section>

      <section className="mt-6"><div className="flex items-end justify-between mb-3"><div><p className="text-[10px] uppercase tracking-[0.16em] text-[#B45309] font-bold">Stories</p><h2 className="text-lg font-extrabold">Live for 24 hours</h2></div><button onClick={() => setTab('post')} className="text-xs font-extrabold text-[#7C3AED]">+ Add your story</button></div><div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        {/* Your story tile: opens your latest story sequence, or the composer if none */}
        <div className="min-w-[88px] text-center"><button onClick={() => myStoryGroup ? setMomentIdx(myStoryGroup.items[0].flatIndex) : setTab('post')} className={`mx-auto block rounded-[28px] p-[3px] ${allViewed ? 'bg-zinc-300' : 'bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600'} shadow-sm`} aria-label={myStoryGroup ? 'View your story' : 'Add your story'}><span className="block w-[78px] h-[78px] rounded-[25px] border-2 border-[#FFFBF0] overflow-hidden relative"><span className="absolute inset-0 flex items-center justify-center bg-[#F4E8D0]">{myStoryGroup?.items[0]?.img
          ? <img src={myStoryGroup.items[0].img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : myStoryGroup ? <span className="relative text-lg">🎥</span>
          : <span className="relative text-sm font-extrabold text-[#5B21B6]">+</span>}
        </span></span></button><p className="mt-1.5 text-[11px] font-bold truncate max-w-[88px]">Your story</p><p className="text-[10px] text-[#8B8175]">{myStoryGroup ? `${myStoryGroup.items.length} live` : 'Tap to share'}</p></div>
        {/* One ring per person (all their stories play in sequence) */}
        {storyGroups.filter(g => g.username !== currentUser).map(g => { const first = g.items[0]; const hasPhoto = Boolean(first.img); const isVideo = Boolean(first.video); const allViewed = g.items.every((item: any) => viewedStoryIds.has(String(item.id))); return <div key={g.username || g.name} className="min-w-[88px] text-center"><button onClick={() => setMomentIdx(first.flatIndex)} className="mx-auto block rounded-[28px] p-[3px] bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 shadow-sm" aria-label={`View ${g.name}'s stories`}><span className="block w-[78px] h-[78px] rounded-[25px] border-2 border-[#FFFBF0] overflow-hidden relative"><span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7]">{hasPhoto
          ? <img src={first.img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : isVideo ? <span className="relative text-lg">🎥</span>
          : <span className="relative text-sm font-extrabold text-[#5B21B6]">{g.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>}
          </span>{isVideo && hasPhoto && <span className="absolute bottom-1 left-1 w-4 h-4 rounded-full bg-black/60 text-white text-[8px] flex items-center justify-center">▶</span>}{g.items.length > 1 && <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[9px] font-extrabold">×{g.items.length}</span>}
        </span></button><p className="mt-1.5 text-[11px] font-bold truncate max-w-[88px]">{g.name}</p><p className="text-[10px] text-[#8B8175]">{allViewed ? 'Viewed' : (g.items.length > 1 ? `${g.items.length} stories` : (first.label || 'Story'))}</p></div> })}
        {storyGroups.length === 0 && <p className="text-sm text-[#8B8175] py-6">No stories yet — be the first to share a moment.</p>}
      </div></section>

      <section className="mt-6"><div className="rounded-2xl bg-[#F4E8D0] border border-[#E8DEC9] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-extrabold">This week’s encouragement</p><p className="mt-2 text-base font-bold leading-6 text-[#3D352B]">“{verseText}”</p><p className="mt-2 text-[11px] font-semibold text-[#766E63]">{verseRef}</p></div></section>

      <section className="mt-7"><div className="mb-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-bold">Church life</p><h2 className="text-lg font-extrabold">Community updates</h2></div><div className="space-y-5">{allUpdates.map((p: any, i: number) => { const key = p.key || `update_${p.user}_${p.img?.slice(-8) ?? i}_${i}`; const liked = api ? Boolean(p.liked) : !!likesTable[key]; const displayLikes = api ? (Number(p.likes) || 0) : (Number(p.likes) || 0) + (liked ? 1 : 0); return <article data-post-id={String(p.id ?? key)} key={key} className="rounded-[26px] overflow-hidden bg-white border border-[#E8DEC9] shadow-sm"><div className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><button onClick={() => onOpenUser?.({ username: p.username, name: p.name || p.user, verified: p.verified, group_name: p.group_name })} className="flex items-center gap-3" aria-label={`View ${p.user}'s profile`}><div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-xs font-extrabold text-[#5B21B6]">{String(p.user).split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div></button><button onClick={() => onOpenUser?.({ username: p.username, name: p.name || p.user, verified: p.verified, group_name: p.group_name })} className="text-left" aria-label={`View ${p.user}'s profile`}><p className="text-sm font-extrabold">{p.user}{p.verified && <span className="ml-1 text-[#0F766E]">✓</span>}</p><p className="text-[11px] text-[#8B8175]">{p.loc} · {p.time}</p></button></div><button onClick={() => setMenuPost(menuPost?.key === key ? null : { key, kind: p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), user: p.user, caption: p.caption, mine: p.username === currentUser })} className="w-8 h-8 rounded-xl bg-[#FAF6EC] text-[#766E63] font-bold" aria-label="More options">•••</button></div>{p.video ? <MediaPreview src={p.video} poster={p.img} />: p.img ? <img src={p.img} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#F4E8D0] flex items-center justify-center text-4xl" aria-label="Image pending review">🙏</div>}<div className="p-4"><span className="inline-flex px-2.5 py-1 rounded-full bg-[#EDE9FE] text-[#5B21B6] text-[10px] font-extrabold">{p.kind || 'Community'}</span><p className="mt-3 text-sm leading-6 text-[#4B433A]"><strong className="text-[#29251F]">{p.user}</strong> {p.caption}</p><div className="mt-4 flex items-center gap-2"><button onClick={() => toggleLike(key)} className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${liked ? 'bg-[#FCE7F3] border-[#F9A8D4] text-[#9D174D]' : 'bg-[#FAF6EC] border-[#E8DEC9] text-[#5B21B6]'}`}>{liked ? '♥ Grateful' : '♡ Appreciate'} · {displayLikes.toLocaleString()}</button><button onClick={() => setCommentTarget({ scope: p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), key })} className="px-3 py-2 rounded-xl bg-[#FAF6EC] border border-[#E8DEC9] text-xs font-extrabold text-[#5B21B6]">💬 Comments{Number(p.comments) > 0 ? ` · ${p.comments}` : ''}</button><button onClick={() => sharePostToWhatsApp({ author: p.user, caption: p.caption, id: String(p.id), kind: p.kind === 'reel' ? 'reel' : 'post' })} className="px-3 py-2 rounded-xl bg-[#25D366]/10 border border-[#25D366]/40 text-xs font-extrabold text-[#128C4A]" aria-label="Share to WhatsApp" title="Share to WhatsApp">↗ Share on WhatsApp</button></div>{p.music && <div className="mt-3 flex items-center gap-2 rounded-xl bg-purple-50 p-2"><span>🎵</span><span className="text-[11px] font-bold truncate">{p.music.title} · {p.music.artist}</span></div>}{p.comments > 0 && <button onClick={() => setCommentTarget({ scope: p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), key })} className="mt-3 text-[11px] font-semibold text-[#8B8175]">{p.comments} people are talking about this — join them</button>}</div></article> })}</div></section>

      <section className="mt-7 grid grid-cols-2 gap-3">{quickLinks.map(q => <button key={q.tab} onClick={() => setTab(q.tab)} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">{q.icon}</span><p className="mt-2 text-sm font-extrabold">{q.title}</p><p className="mt-1 text-[11px] text-[#8B8175]">{q.text}</p></button>)}</section>
      <div className="pt-8 text-center"><p className="text-[11px] font-bold text-[#8B8175]">Harvest Family Church · Nyeri</p><p className="text-[10px] text-[#A49A8E] mt-1">A place to belong, grow and serve.</p></div>
    </main>
    {menuPost && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setMenuPost(null)} role="dialog" aria-label="Post options">
        <div className="w-full sm:max-w-lg bg-white rounded-t-[28px] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
          <div className="w-10 h-1 rounded-full bg-[#E8DEC9] mx-auto my-2" />
          {menuPost.mine || isAdmin ? <button onClick={() => { const m=menuPost; setMenuPost(null); setEditPost(m) }} className="w-full py-3.5 text-center font-bold border-b border-[#F4E8D0] active:bg-[#FAF6EC]">✎ Edit</button> : null}{menuPost.mine || isAdmin ? <button onClick={() => { const m = menuPost; setMenuPost(null); void deleteMedia(m.kind, m.id) }} className="w-full py-3.5 text-center text-red-600 font-bold border-b border-[#F4E8D0] active:bg-red-50">🗑 Delete</button> : null}
          <button onClick={() => { const m = menuPost; setMenuPost(null); sharePostToWhatsApp({ author: m.user, caption: m.caption, id: m.id, kind: m.kind }) }} className="w-full py-3.5 text-center text-[#128C4A] font-bold border-b border-[#F4E8D0] active:bg-green-50">↗ Share to WhatsApp</button>
          <button onClick={() => setMenuPost(null)} className="w-full py-3.5 text-center font-bold text-[#766E63] active:bg-[#FAF6EC]">Cancel</button>
        </div>
      </div>
    )}
    {editPost && <SocialEditor kind={editPost.kind} id={editPost.id} caption={editPost.caption || ''} onDone={() => { setEditPost(null); setFeedTick(x => x + 1) }} />} {refreshing && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-[#29251F] text-white text-xs font-bold shadow-xl">Refreshing community…</div>}
  </div>
}
