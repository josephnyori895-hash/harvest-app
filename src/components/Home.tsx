import { useState, useMemo, useEffect, useRef } from 'react'
import { getLikesTable, toggleLikeKey } from '../state/auth'
import { fetchFeed, useApi } from '../lib/api'
import StoryViewer from './Stories'
import Comments from './Comments'
import { showToast } from './Toast'

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

// Community moments strip: only the viewer's own 'Share' tile plus live stories
// from the server (see liveMoments below). Demo personas removed.
const momentsBase = [
  { name: 'Your moment', me: true, label: 'Share' },
]

// No demo posts: the community feed renders only real posts from the API.
// When there are no posts yet, an honest empty state is shown.
const updatesBase: any[] = []

const quickLinks = [
  { tab: 'chat', icon: '🙏', title: 'Prayer', text: 'Pray with someone' },
  { tab: 'groups', icon: '👥', title: 'Groups', text: 'Find your community' },
  { tab: 'departments', icon: '🤝', title: 'Departments', text: 'Serve with your gifts' },
  { tab: 'give', icon: '🤲', title: 'Give', text: 'Support the ministry' },
  { tab: 'music', icon: '🎶', title: 'Worship', text: 'Listen & worship' },
]

export default function Home({ setTab, users, onDeleteStory, refreshKey, onSwitchAccount }: { setTab: (t: string) => void; users: any[]; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: () => void }) {
  const [momentIdx, setMomentIdx] = useState<number | null>(null)
  const [likesTick, setLikesTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [approvedTick, setApprovedTick] = useState(0)
  const [menuPost, setMenuPost] = useState<string | null>(null)
  // Inline post comments (server-backed) — replaces the old "dump into chats" button.
  const [commentTarget, setCommentTarget] = useState<{ scope: 'post' | 'reel'; id: string; key: string } | null>(null)
  // Server-backed community feed (only in API mode; offline mode stays localStorage-first).
  const api = useApi()
  const [livePosts, setLivePosts] = useState<any[]>([])
  const [liveStories, setLiveStories] = useState<any[]>([])
  const [feedTick, setFeedTick] = useState(0)

  const approvedMoments: any[] = [] // demo approval flow removed — server API is the source of truth
  const approvedPosts: any[] = []

  useEffect(() => {
    if (!api) return undefined
    let cancelled = false
    fetchFeed(0, 20)
      .then((d: any) => {
        if (cancelled) return
        setLivePosts(Array.isArray(d?.posts) ? d.posts : [])
        setLiveStories(Array.isArray(d?.stories) ? d.stories : [])
      })
      .catch((e: any) => { if (!cancelled) console.warn('[feed] load failed', e?.message || e) })
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
    id: s.id,
    label: 'Story',
    img: s.media_type === 'video' ? undefined : (s.thumb_url || undefined),
    video: s.media_type === 'video' ? (s.video_url || undefined) : undefined,
    caption: s.caption,
  })), [liveStories])
  const liveUpdates = useMemo(() => livePosts.map((p: any) => ({
    key: `api_${p.kind}_${p.id}`,
    user: p.name || p.username || 'Harvest member',
    verified: Boolean(p.verified),
    loc: [p.group_name, p.constituency].filter(Boolean).join(' · ') || 'Harvest Family Church',
    time: timeAgo(p.created_at),
    likes: Number(p.likes) || 0,
    comments: Number(p.comments) || 0,
    img: p.thumb_url || undefined,
    caption: p.caption || '',
    kind: p.is_pinned ? 'Pinned' : p.kind === 'reel' ? 'Video' : 'Community',
  })), [livePosts])

  const allMoments = useMemo(() => [...liveMoments, ...momentsBase], [liveMoments])
  const allUpdates = useMemo(() => (liveUpdates.length ? liveUpdates : []), [liveUpdates])
  const likesTable = getLikesTable()
  const currentUser = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const isAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false } })()
  const toggleLike = (key: string) => { toggleLikeKey(key); setLikesTick(x => x + 1); showToast('Added to your gratitude ❤️', 'success', 1000) }
  const bumpCommentCount = (key: string, delta: number) => {
    setLivePosts(ps => ps.map((p: any) => {
      const k = `api_${p.kind}_${p.id}`
      return k === key ? { ...p, comments: Math.max((Number(p.comments) || 0) + delta, 0) } : p
    }))
  }
  const clearCache = () => { localStorage.removeItem('harvest_pending'); localStorage.removeItem('harvest_approved_posts'); localStorage.removeItem('harvest_approved_stories'); localStorage.removeItem('harvest_scheduled'); localStorage.removeItem('harvest_cache'); window.dispatchEvent(new Event('harvest:cache-clear')); showToast('Local cache cleared', 'success') }

  const onTouchStart = (e: any) => { startYRef.current = e.touches[0].clientY }
  const onTouchEnd = (e: any) => {
    if (startYRef.current === null) return
    const dy = e.changedTouches[0].clientY - startYRef.current; startYRef.current = null
    if (dy > 80 && containerRef.current && containerRef.current.scrollTop < 5 && !refreshing) { setRefreshing(true); setApprovedTick(x => x + 1); setLikesTick(x => x + 1); setFeedTick(x => x + 1); showToast('Community refreshed', 'success', 1200); setTimeout(() => setRefreshing(false), 700) }
  }

  return <div ref={containerRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-[calc(100vh-72px)] overflow-auto bg-[#FFFBF0] text-[#29251F]">
    {momentIdx !== null && <StoryViewer idx={momentIdx} setIdx={setMomentIdx} allStories={allMoments} users={users} />}
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
        <button onClick={() => onSwitchAccount?.()} className="flex items-center gap-3 text-left" aria-label="Open account switcher"><span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#7C3AED] to-[#F59E0B] text-white flex items-center justify-center text-sm font-extrabold shadow-sm">HF</span><span><span className="block text-[10px] uppercase tracking-[0.18em] text-[#7C3AED] font-bold">Harvest Family</span><span className="block text-[17px] font-extrabold text-[#29251F] leading-tight">Community</span></span></button>
        <div className="flex items-center gap-2"><button onClick={() => setTab('activity')} className="w-10 h-10 rounded-2xl bg-white border border-[#E8DEC9]" aria-label="Activity">🔔</button><button onClick={() => setTab('chat')} className="w-10 h-10 rounded-2xl bg-white border border-[#E8DEC9]" aria-label="Messages">💬</button>{isAdmin && <button onClick={clearCache} className="w-10 h-10 rounded-2xl bg-[#F4E8D0] border border-[#E8DEC9]" aria-label="Clear local cache">🧹</button>}</div>
      </div>
    </header>

    <main className="px-4 pb-8">
      <section className="pt-5"><div className="rounded-[28px] overflow-hidden bg-gradient-to-br from-[#5B21B6] via-[#6D28D9] to-[#B45309] text-white p-5 shadow-lg shadow-purple-900/10"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.18em] text-amber-200 font-bold">Karibu, family</p><h1 className="mt-1 text-[28px] leading-tight font-extrabold text-white">Grow. Pray. Serve.</h1><p className="mt-2 text-sm leading-5 text-purple-50 max-w-[280px]">A home for the people, ministries and moments of Harvest Family Church Nyeri.</p></div><div className="text-5xl select-none" aria-hidden="true">🌿</div></div><div className="mt-5 flex gap-2"><button onClick={() => setTab('chat')} className="px-4 py-2.5 rounded-xl bg-white text-[#5B21B6] text-xs font-extrabold">Ask for prayer</button><button onClick={() => setTab('groups')} className="px-4 py-2.5 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-bold">Find my group</button></div></div></section>

      <section className="mt-5"><div className="mb-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-bold">Today at Harvest</p><h2 className="text-lg font-extrabold">What’s happening</h2></div><div className="grid grid-cols-2 gap-3"><button onClick={() => setTab('chat')} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">🙏</span><p className="mt-2 font-extrabold text-sm">Chats</p><p className="mt-1 text-[11px] text-[#766E63]">Messages, prayer & announcements.</p></button><button onClick={() => setTab('music')} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">🎶</span><p className="mt-2 font-extrabold text-sm">Worship room</p><p className="mt-1 text-[11px] text-[#766E63]">Songs for your week.</p></button></div></section>

      <section className="mt-6"><div className="flex items-end justify-between mb-3"><div><p className="text-[10px] uppercase tracking-[0.16em] text-[#B45309] font-bold">Stories</p><h2 className="text-lg font-extrabold">Live for 24 hours</h2></div><button onClick={() => setTab('post')} className="text-xs font-extrabold text-[#7C3AED]">+ Add your story</button></div><div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">{allMoments.map((m: any, i: number) => { const isMine = m.me || m.name === currentUser || String(m.id).startsWith(currentUser + '_'); const hasPhoto = Boolean(m.img); return <div key={m.name + i} className="min-w-[88px] text-center"><button onClick={() => m.me ? setTab('post') : setMomentIdx(i)} className="mx-auto block rounded-[28px] p-[3px] bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 shadow-sm" aria-label={m.me ? 'Add your story' : `View ${m.name}'s story`}><span className="block w-[78px] h-[78px] rounded-[25px] border-2 border-[#FFFBF0] overflow-hidden relative"><span className={`absolute inset-0 flex items-center justify-center ${isMine ? 'bg-[#F4E8D0]' : 'bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7]'}`}>{hasPhoto
  ? <img src={m.img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
  : <span className="relative text-sm font-extrabold text-[#5B21B6]">{m.me ? '+' : m.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>}
  </span></span></button><p className="mt-1.5 text-[11px] font-bold truncate max-w-[88px]">{m.me ? 'Your story' : m.name}</p><p className="text-[10px] text-[#8B8175]">{m.me ? 'Tap to share' : (m.label || 'Story')}</p>{onDeleteStory && isMine && !m.me && <button onClick={() => onDeleteStory(m.id)} className="text-[10px] text-red-600 font-bold">Remove</button>}</div> })}{allMoments.length === 0 && <p className="text-sm text-[#8B8175] py-6">No stories yet — be the first to share a moment.</p>}</div></section>

      <section className="mt-6"><div className="rounded-2xl bg-[#F4E8D0] border border-[#E8DEC9] p-4"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-extrabold">This week’s encouragement</p><p className="mt-2 text-base font-bold leading-6 text-[#3D352B]">“Let us consider how we may spur one another on toward love and good deeds.”</p><p className="mt-2 text-[11px] font-semibold text-[#766E63]">Hebrews 10:24 · Grow together</p></div></section>

      <section className="mt-7"><div className="mb-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-bold">Church life</p><h2 className="text-lg font-extrabold">Community updates</h2></div><div className="space-y-5">{allUpdates.map((p: any, i: number) => { const key = p.key || `update_${p.user}_${p.img?.slice(-8) ?? i}_${i}`; const liked = !!likesTable[key]; const displayLikes = (Number(p.likes) || 0) + (liked ? 1 : 0); return <article key={key} className="rounded-[26px] overflow-hidden bg-white border border-[#E8DEC9] shadow-sm"><div className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-xs font-extrabold text-[#5B21B6]">{String(p.user).split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div><div><p className="text-sm font-extrabold">{p.user}{p.verified && <span className="ml-1 text-[#0F766E]">✓</span>}</p><p className="text-[11px] text-[#8B8175]">{p.loc} · {p.time}</p></div></div><button onClick={() => setMenuPost(menuPost === key ? null : key)} className="w-8 h-8 rounded-xl bg-[#FAF6EC] text-[#766E63] font-bold" aria-label="More options">•••</button>{menuPost === key && isAdmin && <div className="absolute" />}</div>{p.video ? <video src={p.video} controls playsInline poster={p.img} className="w-full aspect-[4/3] object-cover bg-[#29251F]" /> : p.img ? <img src={p.img} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover" /> : <div className="w-full aspect-[4/3] bg-[#F4E8D0] flex items-center justify-center text-4xl" aria-label="Image pending review">🙏</div>}<div className="p-4"><span className="inline-flex px-2.5 py-1 rounded-full bg-[#EDE9FE] text-[#5B21B6] text-[10px] font-extrabold">{p.kind || 'Community'}</span><p className="mt-3 text-sm leading-6 text-[#4B433A]"><strong className="text-[#29251F]">{p.user}</strong> {p.caption}</p><div className="mt-4 flex items-center gap-2"><button onClick={() => toggleLike(key)} className={`px-3 py-2 rounded-xl text-xs font-extrabold border ${liked ? 'bg-[#FCE7F3] border-[#F9A8D4] text-[#9D174D]' : 'bg-[#FAF6EC] border-[#E8DEC9] text-[#5B21B6]'}`}>{liked ? '♥ Grateful' : '♡ Appreciate'} · {displayLikes.toLocaleString()}</button><button onClick={() => setCommentTarget({ scope: p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), key })} className="px-3 py-2 rounded-xl bg-[#FAF6EC] border border-[#E8DEC9] text-xs font-extrabold text-[#5B21B6]">💬 Comments{Number(p.comments) > 0 ? ` · ${p.comments}` : ''}</button></div>{p.comments > 0 && <button onClick={() => setCommentTarget({ scope: p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), key })} className="mt-3 text-[11px] font-semibold text-[#8B8175]">{p.comments} people are talking about this — join them</button>}</div></article> })}</div></section>

      <section className="mt-7 grid grid-cols-2 gap-3">{quickLinks.map(q => <button key={q.tab} onClick={() => setTab(q.tab)} className="rounded-2xl bg-white border border-[#E8DEC9] p-4 text-left shadow-sm"><span className="text-2xl">{q.icon}</span><p className="mt-2 text-sm font-extrabold">{q.title}</p><p className="mt-1 text-[11px] text-[#8B8175]">{q.text}</p></button>)}</section>
      <div className="pt-8 text-center"><p className="text-[11px] font-bold text-[#8B8175]">Harvest Family Church · Nyeri</p><p className="text-[10px] text-[#A49A8E] mt-1">A place to belong, grow and serve.</p></div>
    </main>
    {refreshing && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-[#29251F] text-white text-xs font-bold shadow-xl">Refreshing community…</div>}
  </div>
}
