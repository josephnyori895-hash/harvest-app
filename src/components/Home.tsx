import MediaThumbnail from './MediaThumbnail'
import VideoThumb from './VideoThumb'
import FeedCard from './FeedCard'
import { AdvertCard } from './FeedCard'
import { useState, useMemo, useEffect, useRef } from 'react'
import { getLikesTable, toggleLikeKey } from '../state/auth'
import { fetchFeed, useApi } from '../lib/api'
import StoryViewer from './Stories'
import Comments from './Comments'
import { showToast } from './Toast'
import { sharePostToWhatsApp } from '../lib/whatsappShare'
import SocialEditor from './SocialEditor'

import ErrorMessage from './ErrorMessage'
import { timeAgo } from '../lib/time'
import { Icon, Spinner, type IconName } from '../ui'

// No demo posts: the community feed renders only real posts from the API.
// When there are no posts yet, an honest empty state is shown.

// Shared centered-notice dialog scaffold (pastor notices and similar blockers).
function CenterNotice({ label, icon, kicker = 'bg-accent-soft text-accent', title, body, primary, onClose }: {
  label: string; icon: React.ReactNode; kicker?: string; title: string; body: React.ReactNode; primary: React.ReactNode; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="w-full max-w-[350px] rounded-[24px] border border-line bg-surface-raised p-6 text-center shadow-raised" onClick={e => e.stopPropagation()}>
        <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${kicker}`}>{icon}</div>
        <h2 className="mt-4 text-center text-base font-extrabold text-ink">{title}</h2>
        <p className="mt-2 text-center text-sm leading-6 text-ink-muted">{body}</p>
        <div className="mt-5 flex flex-col gap-2">
          {primary}
          <button type="button" onClick={onClose} className="min-h-11 w-full rounded-full border border-line text-sm font-bold text-ink-muted transition hover:bg-surface-sunken">Close</button>
        </div>
      </div>
    </div>
  )
}

// One navigation surface, listed once. Prayer lives in the hero CTA and the
// listen/watch destinations live in the media section, so nothing appears twice.
const quickLinks: { tab: string; icon: IconName; title: string }[] = [
  { tab: 'chat', icon: 'chat', title: 'Chats' },
  { tab: 'groups', icon: 'users', title: 'Groups' },
  { tab: 'departments', icon: 'building', title: 'Departments' },
  { tab: 'give', icon: 'gift', title: 'Give' },
]

export default function Home({ setTab, users, directoryLoading, directoryError, onRefreshDirectory, onDeleteStory, refreshKey, onSwitchAccount, onOpenUser, sharedContent, onSharedContentHandled, onOpenDm }: { setTab: (t: string) => void; users: any[]; directoryLoading?: boolean; directoryError?: boolean; onRefreshDirectory?: () => void; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: () => void; onOpenUser?: (u: any) => void; sharedContent?: { kind: 'post' | 'story' | 'reel'; id: string } | null; onSharedContentHandled?: () => void; onOpenDm?: (user: { id: string; username: string; name?: string }) => void }) {
  const [momentIdx, setMomentIdx] = useState<number | null>(null)
  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(() => new Set())
  const [likesTick, setLikesTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [approvedTick, setApprovedTick] = useState(0)
  // 'Pray with Pastor' — popup shown when no pastor account is configured/found.
  const [showNoPastor, setShowNoPastor] = useState(false)
  const [editPost, setEditPost] = useState<any | null>(null)
  const [menuPost, setMenuPost] = useState<{ key: string; kind: 'post' | 'reel'; id: string; user: string; caption: string; mine: boolean } | null>(null)
  // Admin-editable home content (hero banner + weekly verse). Falls back to
  // the shipped defaults when the fetch fails or values are not set.
  const [content, setContent] = useState<Record<string, string>>({})
  const [contentLoaded, setContentLoaded] = useState(false)
  useEffect(() => {
    const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    fetch(`${API}/api/content?view=home&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setContent(d?.content || {}))
      .catch(() => { /* defaults stay */ })
      .finally(() => setContentLoaded(true))
  }, [])
  const heroKicker = content.hero_kicker || 'Karibu, family'
  const heroTitle = content.hero_title || 'Compel. Raise. Release.'
  const heroSubtitle = content.hero_subtitle || 'Get one saved, keep one saved, get another saved.'
  const verseText = content.verse_text || 'Let us consider how we may spur one another on toward love and good deeds.'
  const verseRef = content.verse_ref || 'Hebrews 10:24 · Grow together'
  // Pastors are configured explicitly by stable username(s), not inferred from
  // display names. Legacy `pastor_username` remains supported; admins can
  // provide multiple accounts in `pastor_usernames` as a comma/newline list.
  const normName = (s: string) => s.trim().toLowerCase().replace(/^@/, '')
  const configuredPastorNames = [
    String(content.pastor_usernames || ''),
    String(content.pastor_username || ''),
  ]
    .flatMap(value => value.split(/[,\n]+/))
    .map(normName)
    .filter(Boolean)
  const configuredPastors = configuredPastorNames
    .filter((name: string, index: number, list: string[]) => list.indexOf(name) === index)
    .map(username => {
      const user = users.find((u: any) => normName(String(u.username || '')) === username) || null
      return {
        username,
        user: user
          ? { id: String(user.id), username: String(user.username), name: user.name || user.username, verified: Boolean(user.verified), avatar_url: user.avatar_url }
          : null,
      }
    })

  // If the admin has not configured a pastor, discover only verified accounts
  // whose identity explicitly indicates pastor/Pst/Rev. Never pick an arbitrary
  // verified member just because they have a verification badge.
  const discoveredPastors = configuredPastorNames.length === 0
    ? users
      .filter((u: any) => Boolean(u?.verified))
      .filter((u: any) =>
        /(^|[._-])(pastor|pst|rev)([._-]|$)/i.test(String(u.username || '')) ||
        /(^|\\s)(pastor|pst|rev)(\\.?)(\\s|$)/i.test(String(u.name || ''))
      )
      .map((u: any) => ({
        username: normName(String(u.username || '')),
        user: { id: String(u.id), username: String(u.username), name: u.name || u.username, verified: Boolean(u.verified), avatar_url: u.avatar_url },
      }))
      .filter((entry: any, index: number, list: any[]) => entry.username && list.findIndex(x => x.username === entry.username) === index)
    : []

  const effectivePastors = configuredPastorNames.length ? configuredPastors : discoveredPastors
  const availablePastors = effectivePastors.filter((entry: any) => Boolean(entry.user))
  const [showPastorPicker, setShowPastorPicker] = useState(false)
  const [showPastorUnavailable, setShowPastorUnavailable] = useState<string | null>(null)
  const [showDirectoryError, setShowDirectoryError] = useState(false)
  const openPastorChat = () => {
    if (directoryError && users.length === 0) {
      setShowDirectoryError(true)
      return
    }
    if (directoryLoading || !contentLoaded) {
      setShowPastorPicker(true)
      return
    }
    if (effectivePastors.length === 0) {
      setShowNoPastor(true)
      return
    }
    if (effectivePastors.length === 1) {
      const pastor = effectivePastors[0].user
      if (pastor && onOpenDm) {
        onOpenDm({ id: String(pastor.id), username: pastor.username, name: pastor.name || pastor.username })
      } else {
        setShowPastorUnavailable(effectivePastors[0].username)
      }
      return
    }
    setShowPastorPicker(true)
  }
  // Inline post comments (server-backed) — replaces the old "dump into chats" button.
  const [commentTarget, setCommentTarget] = useState<{ scope: 'post' | 'reel'; id: string; key: string } | null>(null)
  // Server-backed community feed (only in API mode; offline mode stays localStorage-first).
  const api = useApi()
  const [livePosts, setLivePosts] = useState<any[]>([])
  const [liveStories, setLiveStories] = useState<any[]>([])
  const [liveProjects, setLiveProjects] = useState<any[]>([])
  const [feedTick, setFeedTick] = useState(0)
  const [feedLoaded, setFeedLoaded] = useState(false)
  const [feedLoadFailed, setFeedLoadFailed] = useState(false)
  const [feedOffset, setFeedOffset] = useState(0)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
  const pendingLikesRef = useRef(new Set<string>())
  const pendingSavesRef = useRef(new Set<string>())
  const lastFeedFetchRef = useRef(0)

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
        setLiveProjects(Array.isArray(d?.projects) ? d.projects : [])
        const nextStories = Array.isArray(d?.stories) ? d.stories : []
        setLiveStories(nextStories)
        // Rehydrate viewed state from the server while preserving stories already
        // viewed during this session. This keeps badges correct after reloads and
        // when the same account opens Harvest on another device.
        const serverViewed = new Set<string>(
          nextStories
            .filter((s: any) => Boolean(s?.viewed))
            .map((s: any) => String(s.id))
        )
        if (serverViewed.size) {
          setViewedStoryIds(prev => {
            const next = new Set(prev)
            serverViewed.forEach(id => next.add(id))
            return next
          })
        }
        setFeedLoaded(true)
        setFeedOffset(Number(d?.nextOffset) || 20)
        setFeedHasMore(Boolean(d?.hasMore))
        lastFeedFetchRef.current = Date.now()
      })
      .catch((e: any) => {
        if (cancelled) return
        setFeedLoadFailed(true)
        setFeedLoaded(true)
        lastFeedFetchRef.current = Date.now()
        console.warn('[feed] load failed', e?.message || e)
      })
    return () => { cancelled = true }
  }, [api, feedTick])

  // Reliable further-page loading for the community feed. The /api/feed contract
  // is { posts, stories, nextOffset, hasMore } — hasMore means "nextOffset is
  // populated", so paging advances only while it stays true. Appends with a
  // kind_id dedupe so retries/overlays can never double-insert a post.
  const loadMoreFeed = async () => {
    if (!api || feedLoadingMore || !feedHasMore) return
    setFeedLoadingMore(true)
    try {
      const d: any = await fetchFeed(feedOffset, 20)
      const incoming: any[] = Array.isArray(d?.posts) ? d.posts : []
      const seen = new Set<string>()
      setLivePosts(prev => {
        const next = [...prev]
        for (const p of incoming) {
          const k = `api_${p.kind}_${p.id}`
          if (seen.has(k)) continue
          seen.add(k)
          next.push(p)
        }
        return next
      })
      setFeedOffset(Number(d?.nextOffset) || feedOffset + 20)
      setFeedHasMore(Boolean(d?.hasMore))
    } catch (e: any) {
      showToast(e?.message || 'Could not load more updates', 'error', 2200)
    } finally {
      setFeedLoadingMore(false)
    }
  }

  useEffect(() => {
    const bump = () => setApprovedTick(x => x + 1)
    const bumpFeed = () => setFeedTick(x => x + 1)
    window.addEventListener('storage', bump); window.addEventListener('harvest:approved' as any, bump); window.addEventListener('harvest:verified' as any, bump)
    window.addEventListener('harvest:feed-updated' as any, bumpFeed)
    return () => { window.removeEventListener('storage', bump); window.removeEventListener('harvest:approved' as any, bump); window.removeEventListener('harvest:verified' as any, bump); window.removeEventListener('harvest:feed-updated' as any, bumpFeed) }
  }, [])

  // Signed media URLs in the feed expire after ~10 minutes (thumbs; 30 min
  // video; 1 h music). Home stays mounted across tabs, so when the member
  // returns from >9 min away the old URLs are dead — refetch to re-sign.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (!api) return
      if (Date.now() - lastFeedFetchRef.current < 540_000) return
      setFeedTick(x => x + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [api])

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
    music: s.music || null,
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

  const liveUpdates = useMemo(() => livePosts.map((p: any) => {
    if (p.kind === 'advert') return p
    return {
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
    img: p.kind === 'reel' ? (p.thumb_url || undefined) : (p.thumb_url || undefined),
    video: p.kind === 'reel' ? (p.hls_url || undefined) : undefined,
    caption: p.caption || '',
    kind: p.is_pinned ? 'Pinned' : p.kind === 'reel' ? 'Video' : 'Community',
    music: p.music || null,
    liked: Boolean(p.liked),
    saved: Boolean(p.saved),
    }
  }), [livePosts])

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
  const myStoryAllViewed = Boolean(myStoryGroup?.items.length) && myStoryGroup.items.every((item: any) => viewedStoryIds.has(String(item.id)))
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
        showToast(data.liked ? 'Added to your gratitude' : 'Appreciation removed', 'success', 1000)
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
    showToast('Added to your gratitude', 'success', 1000)
  }
  const toggleSave = async (key: string) => {
    if (!api) return
    if (pendingSavesRef.current.has(key)) return
    const post = livePosts.find((p: any) => `api_${p.kind}_${p.id}` === key)
    if (!post?.id) return
    pendingSavesRef.current.add(key)
    const wasSaved = Boolean(post.saved)
    const endpoint = post.kind === 'reel' ? `/api/reels/${encodeURIComponent(String(post.id))}/save` : `/api/posts/${encodeURIComponent(String(post.id))}/save`
    setLivePosts(ps => ps.map((p: any) => `api_${p.kind}_${p.id}` === key ? { ...p, saved: !wasSaved } : p))
    const revert = () => setLivePosts(ps => ps.map((p: any) => `api_${p.kind}_${p.id}` === key ? { ...p, saved: wasSaved } : p))
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const res = await fetch(`${API}${endpoint}`, {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) { revert(); showToast('Could not update Saved — try again', 'error', 1800); return }
      showToast(wasSaved ? 'Removed from Saved' : 'Saved — find it in your profile', 'success', 1400)
    } catch {
      revert()
      showToast('Network problem — could not update Saved', 'error', 1800)
    } finally {
      pendingSavesRef.current.delete(key)
    }
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

  const reelCount = livePosts.filter((p: any) => p.kind === 'reel').length

  const onTouchStart = (e: any) => { startYRef.current = e.touches[0].clientY }
  const onTouchEnd = (e: any) => {
    if (startYRef.current === null) return
    const dy = e.changedTouches[0].clientY - startYRef.current; startYRef.current = null
    if (dy > 80 && containerRef.current && containerRef.current.scrollTop < 5 && !refreshing) { setRefreshing(true); setApprovedTick(x => x + 1); setLikesTick(x => x + 1); setFeedTick(x => x + 1); showToast('Community refreshed', 'success', 1200); setTimeout(() => setRefreshing(false), 700) }
  }

  return <div data-qa-moment={String(momentIdx)} data-qa-stories={String(allMoments.length)} ref={containerRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-[calc(100vh-72px)] overflow-auto bg-surface text-ink">
    {momentIdx !== null && <StoryViewer idx={momentIdx} setIdx={setMomentIdx} allStories={allMoments} users={users} onOpenUser={onOpenUser} onViewed={markStoryViewed} onDeleted={(id) => { setLiveStories(ss => ss.filter(x => String(x.id) !== String(id))) }} />}
    {showPastorPicker && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-sm" onClick={() => setShowPastorPicker(false)} role="dialog" aria-modal="true" aria-label="Choose a pastor">
        <div className="max-h-[82dvh] w-full overflow-auto rounded-t-[28px] border-t border-line bg-surface-raised p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] shadow-raised sm:max-w-lg sm:rounded-[28px]" onClick={e => e.stopPropagation()}>
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
          <div className="mb-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xs font-bold uppercase tracking-[0.16em] text-accent">Prayer</p>
              <h2 className="truncate text-heading font-extrabold text-ink">Choose a pastor</h2>
            </div>
            <button type="button" onClick={() => setShowPastorPicker(false)} aria-label="Close pastor picker" className="touch-target shrink-0 rounded-full bg-surface-sunken text-ink-muted transition hover:text-ink"><Icon name="close" size={18} /></button>
          </div>
          <p className="mb-4 text-2xs text-ink-muted">Choose someone you'd like to pray with.</p>
          {directoryLoading ? (
            <div className="py-8 text-center" role="status" aria-live="polite">
              <Spinner size={28} className="mx-auto text-accent" />
              <p className="mt-3 text-2xs font-semibold text-ink-muted">Checking pastor availability…</p>
            </div>
          ) : directoryError && availablePastors.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface-sunken p-4">
              <p className="text-sm font-extrabold text-ink">Couldn't load pastors</p>
              <p className="mt-1 text-2xs leading-5 text-ink-muted">Check your connection and try again.</p>
              <button type="button" onClick={onRefreshDirectory} className="mt-3 inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-2xs font-extrabold text-white">Retry</button>
            </div>
          ) : !contentLoaded ? (
            <div className="py-8 text-center" role="status" aria-live="polite">
              <Spinner size={28} className="mx-auto text-accent" />
              <p className="mt-3 text-2xs font-semibold text-ink-muted">Loading pastor support…</p>
            </div>
          ) : effectivePastors.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface-sunken p-4 text-center">
              <p className="text-sm font-extrabold text-ink">Pastor support isn't configured yet</p>
              <p className="mt-1 text-2xs leading-5 text-ink-muted">You can still ask the Harvest Family to pray with you in Chats.</p>
              <button type="button" onClick={() => { setShowPastorPicker(false); setShowNoPastor(true) }} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-2xs font-extrabold text-white"><Icon name="heart" size={15} /> Ask for prayer in Chats</button>
            </div>
          ) : (
            <>
              {availablePastors.length === 0 && (
                <div className="mb-3 rounded-2xl border border-gold/30 bg-gold-soft p-3">
                  <p className="text-2xs font-extrabold text-gold-strong">No pastors are available right now.</p>
                  <p className="mt-1 text-2xs leading-5 text-ink-muted">The configured pastors haven't joined Harvest yet.</p>
                </div>
              )}
              <div className="space-y-2">
                {configuredPastors.map((entry: any) => {
                  const pastor = entry.user
                  const displayName = pastor?.name || entry.username
                  const initials = String(displayName).split(/[\s_.-]/).filter(Boolean).map((part: string) => part[0]).slice(0, 2).join('').toUpperCase()
                  return (
                    <button
                      key={pastor?.id || `configured_${entry.username}`}
                      type="button"
                      disabled={!pastor}
                      onClick={() => {
                        if (!pastor) return
                        setShowPastorPicker(false)
                        onOpenDm?.({ id: String(pastor.id), username: pastor.username, name: pastor.name || pastor.username })
                      }}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 text-left transition-colors ${pastor ? 'border-line bg-surface-sunken hover:bg-accent-wash' : 'cursor-not-allowed border-line bg-surface-sunken/60 opacity-60'}`}
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-gold-soft text-2xs font-extrabold text-accent-strong">{initials}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink">{pastor?.name || entry.username}</p>
                        <p className="truncate text-2xs text-ink-muted">@{entry.username}</p>
                        {!pastor && <p className="mt-0.5 text-2xs font-semibold text-gold-strong">Not on Harvest yet</p>}
                      </div>
                      {pastor ? <Icon name="chevron-right" size={16} className="shrink-0 text-accent" /> : <span className="text-2xs font-bold text-ink-subtle">Unavailable</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    )}
    {showPastorUnavailable && (
      <CenterNotice
        label="Pastor unavailable" icon={<Icon name="heart" size={26} />} title="Pastor isn't on Harvest yet"
        body={<>@{showPastorUnavailable} hasn't joined the app yet. You can still ask the Harvest Family to pray with you in Chats.</>}
        onClose={() => setShowPastorUnavailable(null)}
        primary={<button type="button" onClick={() => { setShowPastorUnavailable(null); setTab('chat') }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-extrabold text-white">Ask for prayer in Chats</button>}
      />
    )}
    {showDirectoryError && (
      <CenterNotice
        label="Pastor directory unavailable" icon={<Icon name="alert" size={26} />} kicker="bg-danger-soft text-danger" title="Couldn't load pastors"
        body="Check your connection and try again. We won't assume a pastor hasn't joined when the directory is unavailable."
        onClose={() => setShowDirectoryError(false)}
        primary={<button type="button" onClick={() => { setShowDirectoryError(false); onRefreshDirectory?.() }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-extrabold text-white">Retry</button>}
      />
    )}
    {showNoPastor && (
      <CenterNotice
        label="Pastor support unavailable" icon={<Icon name="heart" size={26} />} title="Pastor support isn't available yet"
        body="You can still share a prayer request in Chats — the Harvest Family is ready to pray with you."
        onClose={() => setShowNoPastor(false)}
        primary={<button type="button" onClick={() => { setShowNoPastor(false); setTab('chat') }} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-sm font-extrabold text-white">Ask for prayer in Chats</button>}
      />
    )}
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

    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-xl">
      {/* pr-14 reserves the footprint of the shell's floating notification bell,
          so the header's own actions never sit underneath it. */}
      <div className="flex items-center justify-between gap-2 py-3 pl-4 pr-14">
        <button onClick={() => onSwitchAccount?.()} className="flex items-center gap-3 text-left" aria-label="Open account switcher">
          <img src="/logo.png" alt="" className="h-10 w-10 rounded-2xl border border-line bg-surface-sunken object-contain" />
          <span>
            <span className="block text-2xs font-bold uppercase tracking-[0.18em] text-accent">Harvest Family</span>
            <span className="block truncate text-heading font-extrabold leading-tight text-ink">Nyeri</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('music')} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-raised px-3 text-2xs font-extrabold text-accent-strong transition hover:bg-surface-sunken" aria-label="Songs & worship" title="Songs & worship"><Icon name="music" size={16} />Songs &amp; worship</button>
        </div>
      </div>
    </header>

    <main className="px-4 pb-8">
      <nav aria-label="Quick actions" className="sticky top-16 z-10 -mx-4 border-b border-line/60 bg-surface/90 px-4 py-2 backdrop-blur-xl">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {quickLinks.map(q => (
            <button
              key={q.tab}
              onClick={() => setTab(q.tab)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-raised px-3.5 py-2 text-2xs font-extrabold text-ink transition hover:border-accent/40 hover:text-accent-strong"
            >
              <Icon name={q.icon} size={15} className="text-accent" />
              {q.title}
            </button>
          ))}
        </div>
      </nav>

      <section className="pt-4">
        <div className="overflow-hidden rounded-card bg-gradient-to-br from-accent-strong via-accent to-accent-strong p-4 text-white shadow-raised">
          <p className="text-2xs font-bold uppercase tracking-[0.18em] text-gold-soft">{heroKicker}</p>
          <h1 className="mt-1 text-title font-extrabold text-white">{heroTitle}</h1>
          <p className="mt-1 text-2xs leading-5 text-white/75">{heroSubtitle}</p>
          {/* The week's verse lives here instead of taking a section of its own. */}
          <div className="mt-3 rounded-2xl bg-white/10 p-3">
            <p className="text-caption font-semibold leading-6 text-white">“{verseText}”</p>
            <p className="mt-1 text-2xs font-semibold text-white/70">{verseRef}</p>
          </div>
          <button onClick={openPastorChat} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-2xs font-extrabold text-accent-strong shadow-card"><Icon name="heart" size={15} /> Ask for prayer</button>
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3">
          <h2 className="text-heading font-extrabold text-ink">Listen &amp; watch</h2>
          <p className="mt-0.5 text-2xs text-ink-muted">Recordings from Harvest Family.</p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {([
            { tab: 'sermons', icon: 'mic', title: 'Sermons', text: 'Listen & watch' },
            { tab: 'reels', icon: 'reels', title: 'Videos', text: `${reelCount} in feed` },
            { tab: 'music', icon: 'music', title: 'Worship', text: 'Songs for you' },
          ] as { tab: string; icon: IconName; title: string; text: string }[]).map(item => (
            <button key={item.tab} type="button" onClick={() => setTab(item.tab)} className="rounded-2xl border border-line bg-surface-raised px-2 py-3.5 text-center shadow-card transition hover:bg-surface-sunken active:scale-[.99]">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent"><Icon name={item.icon} size={18} /></span>
              <span className="mt-2 block truncate text-caption font-extrabold text-ink">{item.title}</span>
              <span className="mt-0.5 block truncate text-2xs text-ink-muted">{item.text}</span>
            </button>
          ))}
        </div>
      </section>


      <section className="mt-6"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-heading font-extrabold text-ink">Stories</h2><p className="mt-0.5 text-2xs text-ink-muted">Live for 24 hours</p></div><button onClick={() => setTab('post')} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-2xs font-extrabold text-accent"><Icon name="plus" size={13} /> Add story</button></div><div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
        {/* Your story tile: opens your latest story sequence, or the composer if none */}
        <div className="min-w-[88px] text-center"><button onClick={() => { if (!myStoryGroup) { setTab('post'); return }; const firstUnviewed = myStoryGroup.items.find((item: any) => !viewedStoryIds.has(String(item.id))); setMomentIdx((firstUnviewed || myStoryGroup.items[0]).flatIndex) }} className={`mx-auto block rounded-[28px] p-[3px] ${myStoryAllViewed ? 'bg-line' : 'bg-gradient-to-tr from-gold via-accent to-accent-strong'} shadow-sm`} aria-label={myStoryGroup ? 'View your story' : 'Add your story'}><span className="block w-[78px] h-[78px] rounded-[25px] border-2 border-surface overflow-hidden relative"><span className="absolute inset-0 flex items-center justify-center bg-surface-sunken">{myStoryGroup?.items[0]?.img
          ? <img src={myStoryGroup.items[0].img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : myStoryGroup ? <Icon name="reels" size={22} className="relative text-ink-subtle" />
          : <Icon name="plus" size={22} className="relative text-accent" />}
        </span></span></button><p className="mt-1.5 max-w-[88px] truncate text-2xs font-bold text-ink">Your story</p><p className="truncate text-2xs text-ink-subtle">{myStoryGroup ? `${myStoryGroup.items.length} live` : 'Tap to share'}</p></div>
        {/* One ring per person (all their stories play in sequence) */}
        {storyGroups.filter(g => g.username !== currentUser).map(g => { const first = g.items[0]; const hasPhoto = Boolean(first.img); const isVideo = Boolean(first.video); const allViewed = g.items.every((item: any) => viewedStoryIds.has(String(item.id))); return <div key={g.username || g.name} className="min-w-[88px] text-center"><button onClick={() => { const firstUnviewed = g.items.find((item: any) => !viewedStoryIds.has(String(item.id))); setMomentIdx((firstUnviewed || first).flatIndex) }} className={`mx-auto block rounded-[28px] p-[3px] ${allViewed ? 'bg-line' : 'bg-gradient-to-tr from-gold via-accent to-accent-strong'} shadow-sm`} aria-label={`View ${g.name}'s stories`}><span className="block w-[78px] h-[78px] rounded-[25px] border-2 border-surface overflow-hidden relative"><span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-accent-soft to-gold-soft">{hasPhoto
          ? <img src={first.img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          : isVideo ? <Icon name="reels" size={22} className="relative text-ink-subtle" />
          : <span className="relative text-base font-extrabold text-accent-strong">{g.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>}
          </span>{isVideo && hasPhoto && <span className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-ink/70 text-white"><Icon name="play" size={10} /></span>}{g.items.length > 1 && <span className="absolute right-1 top-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-2xs font-extrabold text-white">{g.items.length}</span>}
        </span></button><p className="mt-1.5 max-w-[88px] truncate text-2xs font-bold text-ink">{g.name}</p><p className="truncate text-2xs text-ink-subtle">{allViewed ? 'Viewed' : (g.items.length > 1 ? `${g.items.length} stories` : (first.label || 'Story'))}</p></div> })}
        {storyGroups.length === 0 && <p className="text-sm text-ink-subtle py-6">No stories yet — be the first to share a moment.</p>}
      </div></section>

      {feedLoadFailed && <div className="mt-5"><ErrorMessage message="We couldn’t load the latest community updates." action={<button type="button" onClick={() => { setFeedLoadFailed(false); setFeedTick(x => x + 1) }} className="text-xs font-bold underline">Retry</button>} /></div>}
      {liveProjects.length > 0 && (
      <section className="mt-7">
        <div className="mb-3">
          <h2 className="text-heading font-extrabold text-ink">Church projects</h2>
          <p className="mt-0.5 text-2xs text-ink-muted">Shared goals from Harvest Family.</p>
        </div>
        <div className="space-y-3">
          {/* Same campaign card as the sponsored slot inside the feed and the
              Give screen — one project design everywhere, never a bespoke tile. */}
          {liveProjects.map((p: any) => {
            const project = p.project || p
            return (
              <AdvertCard
                key={p.id}
                advert={{
                  ...p,
                  kind: 'advert',
                  title: project.name || p.name,
                  body: project.description || p.caption || '',
                  project,
                }}
                onOpen={() => setTab('give')}
                onBrowseProjects={() => setTab('give')}
              />
            )
          })}
        </div>
      </section>
      )}

      <section className="mt-7"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-heading font-extrabold text-ink">Community</h2><p className="mt-0.5 text-2xs text-ink-muted">Latest from your church family</p></div><button type="button" onClick={() => { setFeedLoadFailed(false); setFeedTick(x => x + 1) }} disabled={!api} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3 text-2xs font-extrabold text-accent-strong transition hover:bg-surface-sunken disabled:opacity-40"><Icon name="retry" size={13} /> Refresh</button></div><div className="-mx-4 divide-y divide-line border-t border-line">{!feedLoaded && !feedLoadFailed && [0, 1].map(i => (
          <div key={`sk_${i}`} className="bg-surface py-4" aria-hidden="true">
            <div className="flex items-center gap-2.5 px-3">
              <div className="skeleton h-8 w-8 rounded-full" />
              <div className="min-w-0 flex-1"><div className="skeleton h-3 w-1/3 rounded-full" /><div className="skeleton mt-2 h-2.5 w-1/2 rounded-full" /></div>
            </div>
            <div className="skeleton mt-3 aspect-[4/3] w-full" />
            <div className="px-3"><div className="skeleton mt-3 h-3 w-4/5 rounded-full" /></div>
          </div>
        ))}{allUpdates.map((p: any, i: number) => { const key = p.key || `update_${p.user}_${p.img?.slice(-8) ?? i}_${i}`;
        if (p.kind === 'advert') return <div key={String(p.id)} className="px-3 py-4"><AdvertCard advert={p} onOpen={() => setTab('give')} onBrowseProjects={() => setTab('give')} /></div>
        const liked = api ? Boolean(p.liked) : !!likesTable[key]; const displayLikes = api ? (Number(p.likes) || 0) : (Number(p.likes) || 0) + (liked ? 1 : 0); return (
        <FeedCard
          key={key}
          p={{ ...p, key: String(key) }}
          liked={liked}
          displayLikes={displayLikes}
          menuOpen={menuPost?.key === key}
          onToggleMenu={() => setMenuPost(menuPost?.key === key ? null : { key, kind: p.kind === 'Video' || p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), user: p.user, caption: p.caption, mine: p.username === currentUser })}
          onLike={() => toggleLike(key)}
          onComment={() => setCommentTarget({ scope: p.kind === 'Video' || p.kind === 'reel' ? 'reel' : 'post', id: String(p.id), key })}
          onShare={() => sharePostToWhatsApp({ author: p.user, caption: p.caption, id: String(p.id), kind: p.kind === 'Video' || p.kind === 'reel' ? 'reel' : 'post' })}
          saved={api ? Boolean(p.saved) : false}
          onSave={api ? () => toggleSave(key) : undefined}
          onOpenUser={onOpenUser}
        />
      ) })}</div>
        {feedHasMore && (
          <button type="button" onClick={() => void loadMoreFeed()} disabled={!api || feedLoadingMore} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface-raised text-2xs font-extrabold text-accent-strong transition hover:bg-surface-sunken disabled:opacity-40">
            {feedLoadingMore ? <><Spinner size={14} /> Loading more…</> : 'Load more updates'}
          </button>
        )}
      </section>

      <div className="pt-8 text-center">
        <p className="text-2xs font-bold text-ink-subtle">Harvest Family Church · Nyeri</p>
        <p className="mt-1 text-2xs text-ink-subtle">A place to belong, grow and serve.</p>
        {/* Admin-only maintenance, kept out of the header so it can never read as
            an action on the content beside it. */}
        {isAdmin && (
          <button type="button" onClick={clearCache} className="mt-3 text-2xs font-semibold text-ink-subtle underline underline-offset-2">
            Clear local cache
          </button>
        )}
      </div>
    </main>
    {menuPost && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-sm" onClick={() => setMenuPost(null)} role="dialog" aria-label="Post options">
        <div className="w-full rounded-t-[24px] border-t border-line bg-surface-raised p-2 pb-[max(0.5rem,var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))] shadow-raised sm:max-w-lg sm:rounded-[24px]" onClick={e => e.stopPropagation()}>
          <div className="mx-auto my-2 h-1 w-10 rounded-full bg-line" />
          {menuPost.mine || isAdmin ? <button onClick={() => { const m=menuPost; setMenuPost(null); setEditPost(m) }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-ink transition hover:bg-surface-sunken active:bg-surface-sunken"><Icon name="copy" size={17} className="text-ink-muted" /> Edit caption</button> : null}
          {menuPost.mine || isAdmin ? <button onClick={() => { const m = menuPost; setMenuPost(null); void deleteMedia(m.kind, m.id) }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-danger transition hover:bg-danger-soft active:bg-danger-soft"><Icon name="trash" size={17} /> Delete</button> : null}
          <button onClick={() => { const m = menuPost; setMenuPost(null); sharePostToWhatsApp({ author: m.user, caption: m.caption, id: m.id, kind: m.kind }) }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-success transition hover:bg-success-soft active:bg-success-soft"><Icon name="share" size={17} /> Share to WhatsApp</button>
          <button onClick={() => setMenuPost(null)} className="flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-ink-muted transition hover:bg-surface-sunken active:bg-surface-sunken">Cancel</button>
        </div>
      </div>
    )}
    {editPost && <SocialEditor kind={editPost.kind} id={editPost.id} caption={editPost.caption || ''} onDone={() => { setEditPost(null); setFeedTick(x => x + 1) }} />} {refreshing && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-ink text-white text-xs font-bold shadow-xl">Refreshing community…</div>}
  </div>
}
