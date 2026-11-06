import { useState, useEffect, useMemo, useRef } from 'react'
import { VerifiedBadge } from './VerifiedBadge'
import { Icon, type IconName } from '../ui'

// PreviewTile — IG-style browse tile: a muted looping preview of the actual
// reel. One video element per tile, mounted once (remounting stalls and
// flashes black on slow networks). Plays automatically while the tile is in
// view (touch and desktop both), pauses when it scrolls out, and hovering
// forces play on desktop.
function HoverPreviewTile({ videoSrc, fallback, ariaLabel, onClick, overlay }: {
  videoSrc?: string
  fallback: React.ReactNode
  ariaLabel: string
  onClick: () => void
  overlay: React.ReactNode
}) {
  const [hot, setHot] = useState(false)
  const [visible, setVisible] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const vidRef = useRef<HTMLVideoElement | null>(null)
  const timer = useRef<number | null>(null)
  const enter = () => { if (timer.current) return; timer.current = window.setTimeout(() => setHot(true), 180) }
  const leave = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null } setHot(false) }
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  // Track whether the tile is comfortably on screen.
  useEffect(() => {
    if (!videoSrc) return
    const btn = btnRef.current
    if (!btn || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.55), { threshold: [0, 0.55, 1] })
    io.observe(btn)
    return () => io.disconnect()
  }, [videoSrc])
  // One play/pause authority: in view OR hovered → play; otherwise pause.
  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (visible || hot) { v.muted = true; if (v.paused) v.play().catch(() => {}) }
    else if (!v.paused) v.pause()
  }, [visible, hot])
  return (
    <button ref={btnRef} onClick={onClick} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave} aria-label={ariaLabel} className="aspect-square bg-surface-sunken overflow-hidden relative group">
      {videoSrc
        ? <video ref={vidRef} src={videoSrc} className="w-full h-full object-cover" muted loop playsInline preload="metadata" />
        : fallback}
      {overlay}
    </button>
  )
}

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

type Filter = 'all' | 'members' | 'groups' | 'departments' | 'reels' | 'sermons' | 'places'

const FILTERS: { id: Filter; label: string; icon: IconName }[] = [
  { id: 'all', label: 'All', icon: 'sparkle' },
  { id: 'members', label: 'Members', icon: 'user' },
  { id: 'groups', label: 'Groups', icon: 'users' },
  { id: 'departments', label: 'Departments', icon: 'building' },
  { id: 'reels', label: 'Reels', icon: 'reels' },
  { id: 'sermons', label: 'Sermons', icon: 'bookmark' },
  { id: 'places', label: 'Places', icon: 'map' },
]

const fmtDuration = (s?: number | null) => {
  const n = Number(s) || 0
  if (!n) return ''
  const m = Math.floor(n / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

// Church-wide search: members, groups, departments, reels, sermons and
// places — one query, filter chips narrow the scope. Lists are fetched once
// and filtered client-side (each endpoint is small; no worker changes needed).

// Recent searches persist per device so members can re-run common lookups
// (the pastor's name, their own group) with one tap. Debounced saves only —
// a query counts as "recent" after 600 ms of typing pause and 2+ characters.
const RECENT_KEY = 'harvest_recent_searches'
const RECENT_MAX = 8
const loadRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [] } catch { return [] }
}

// Tile image that degrades to the gradient/emoji fallback if the object is
// missing or corrupt instead of showing the browser's broken-image glyph.
function TileImg({ src, className = 'w-full h-full object-cover' }: { src?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return null
  return <img src={src} alt="" loading="lazy" className={className} onError={() => setFailed(true)} />
}

export default function Search({ users, onView, onOpenUser, onOpenGroups, onOpenDepartments, onOpenSermons, onOpenReel }: {
  users: any[]
  onView: (u: any) => void
  onOpenUser?: (u: any) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: (sermonId: string) => void
  onOpenReel?: (reelId: string) => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [recentFeed, setRecentFeed] = useState<any[]>([])
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecent)
  // Lazy-loaded search corpora. null = not fetched, 'error' = failed (retryable).
  const [groups, setGroups] = useState<any[] | 'error' | null>(null)
  const [departments, setDepartments] = useState<any[] | 'error' | null>(null)
  const [reels, setReels] = useState<any[] | 'error' | null>(null)
  const [sermons, setSermons] = useState<any[] | 'error' | null>(null)
  const [bump, setBump] = useState(0) // retry counter for failed corpora
  // Discover is a browse surface, not a member dump: scope chips over a card
  // rail, with ministries lifted out of the member rows as entry points.
  const [discoverScope, setDiscoverScope] = useState<'all' | 'verified' | 'ministry'>('all')

  const query = q.trim().toLowerCase()
  const showGrid = query === ''

  // Save a search to recents after a short typing pause (not per keystroke),
  // newest first, deduplicated case-insensitively, capped at RECENT_MAX.
  useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length < 2) return
    const t = window.setTimeout(() => {
      setRecentSearches(prev => {
        const next = [trimmed, ...prev.filter(x => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_MAX)
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage full — recents are best-effort */ }
        return next
      })
    }, 600)
    return () => window.clearTimeout(t)
  }, [q])

  const removeRecent = (entry: string) => {
    setRecentSearches(prev => {
      const next = prev.filter(x => x !== entry)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* best-effort */ }
      return next
    })
  }

  const clearRecent = () => {
    setRecentSearches([])
    try { localStorage.removeItem(RECENT_KEY) } catch { /* best-effort */ }
  }

  // Everything except members comes from the API — fetch once per session,
  // retryable via the error banner. `bump` in deps drives the retry.
  useEffect(() => {
    if (showGrid && filter !== 'reels') return
    let cancelled = false
    const need = { groups, departments, reels, sermons }
    const want = filter === 'all' || filter === 'places'
      ? ['groups', 'departments', 'reels', 'sermons']
      : [filter]
    const missing = want.filter(k => need[k as keyof typeof need] === null || need[k as keyof typeof need] === 'error')
    if (!missing.length) return
    const get = (key: string, url: string, pick: (d: any) => any, set: (v: any) => void) =>
      fetch(url, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then(d => { if (!cancelled) set(pick(d)) })
        .catch(() => { if (!cancelled) set('error') })
    if (missing.includes('groups')) get('groups', `${API}/api/groups`, d => Array.isArray(d.groups) ? d.groups : [], setGroups)
    if (missing.includes('departments')) get('departments', `${API}/api/departments`, d => Array.isArray(d.departments) ? d.departments : [], setDepartments)
    if (missing.includes('reels')) get('reels', `${API}/api/reels?limit=50`, d => Array.isArray(d.reels) ? d.reels : [], setReels)
    if (missing.includes('sermons')) get('sermons', `${API}/api/sermons?limit=50`, d => Array.isArray(d.sermons) ? d.sermons : [], setSermons)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGrid, filter, query, bump])

  // Real "explore" grid: latest approved posts from the community feed.
  useEffect(() => {
    if (!showGrid) return
    let cancelled = false
    fetch(`${API}/api/feed?limit=9`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('no feed'))))
      .then(d => { if (!cancelled) setRecentFeed(Array.isArray(d.posts) ? d.posts : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [showGrid])

  // Relevance: starts-with > word-start > contains. Keeps "bon" → "Bonkey"
  // above a member whose bio merely mentions "bonfire".
  const rank = (text: string): number => {
    const t = String(text || '').toLowerCase()
    if (!t) return 3
    if (t.startsWith(query)) return 0
    const words = t.split(/[\s_.@-]+/)
    if (words.some(w => w.startsWith(query))) return 1
    return t.includes(query) ? 2 : 3
  }
  const byRank = (getTexts: (item: any) => string[]) => (a: any, b: any) => {
    const ra = Math.min(...getTexts(a).map(rank))
    const rb = Math.min(...getTexts(b).map(rank))
    return ra - rb
  }

  const memberHits = useMemo(() => query === '' ? [] : users.filter(u =>
    (u.username || '').toLowerCase().includes(query) ||
    (u.name || '').toLowerCase().includes(query) ||
    (u.group_name || u.group || '').toLowerCase().includes(query)
  ).sort(byRank(u => [u.name || u.username, u.username])), [users, query])

  const me = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const myMinistry = useMemo(() => {
    const mine = users.find(u => u.username === me)
    return mine?.group_name || mine?.group || ''
  }, [users, me])
  // Verified people first, then a stable name order, so the rail is a
  // deterministic "featured" list instead of raw signup order.
  const discoverPeople = useMemo(() => {
    const pool = users.filter(u => u && u.username)
    const scoped = discoverScope === 'verified' ? pool.filter(u => u.verified)
      : discoverScope === 'ministry' && myMinistry ? pool.filter(u => (u.group_name || u.group) === myMinistry)
      : pool
    return [...scoped].sort((a, b) =>
      Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
      String(a.name || a.username).localeCompare(String(b.name || b.username))
    )
  }, [users, discoverScope, myMinistry])
  const ministries = useMemo(() => {
    const counts = new Map<string, number>()
    users.forEach(u => { const g = u?.group_name || u?.group; if (g) counts.set(g, (counts.get(g) || 0) + 1) })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [users])

  const groupHits = useMemo(() => query === '' || !Array.isArray(groups) ? [] : groups.filter(g =>
    (g.name || '').toLowerCase().includes(query) ||
    (g.description || '').toLowerCase().includes(query) ||
    (g.community || '').toLowerCase().includes(query)
  ).sort(byRank(g => [g.name, g.community || ''])), [groups, query])

  const departmentHits = useMemo(() => query === '' || !Array.isArray(departments) ? [] : departments.filter(d =>
    (d.name || '').toLowerCase().includes(query) ||
    (d.description || '').toLowerCase().includes(query)
  ).sort(byRank(d => [d.name])), [departments, query])

  const reelHits = useMemo(() => !Array.isArray(reels) ? [] : (query === '' ? reels : reels.filter(r =>
    (r.caption || '').toLowerCase().includes(query) ||
    (r.username || '').toLowerCase().includes(query)
  )), [reels, query])

  const sermonHits = useMemo(() => query === '' || !Array.isArray(sermons) ? [] : sermons.filter(s =>
    (s.title || '').toLowerCase().includes(query) ||
    (s.speaker || '').toLowerCase().includes(query) ||
    (s.scripture || '').toLowerCase().includes(query) ||
    (s.description || '').toLowerCase().includes(query)
  ).sort(byRank(s => [s.title, s.speaker || ''])), [sermons, query])

  // Places: members' congregation/location text plus groups' area labels.
  // NOTE: non-mutual members' exact location is nulled by the server for
  // privacy — group_name/constituency still match, which is by design.
  const placeHits = useMemo(() => {
    if (query === '') return [] as { kind: 'member' | 'group'; item: any }[]
    const out: { kind: 'member' | 'group'; item: any }[] = []
    users.filter(u =>
      (u.location || '').toLowerCase().includes(query) ||
      (u.group_name || u.group || '').toLowerCase().includes(query) ||
      (u.constituency || '').toLowerCase().includes(query)
    ).forEach(item => out.push({ kind: 'member', item }))
    ;(Array.isArray(groups) ? groups : []).filter(g =>
      (g.location_label || '').toLowerCase().includes(query) ||
      (g.community || '').toLowerCase().includes(query)
    ).forEach(item => out.push({ kind: 'group', item }))
    return out
  }, [users, groups, query])

  const loading = !showGrid && [
    ['groups', groups], ['departments', departments], ['reels', reels], ['sermons', sermons],
  ].some(([key, v]) => v === null && (filter === 'all' || filter === 'places' || filter === key))
  const failedCorpora = [
    ['groups', groups], ['departments', departments], ['reels', reels], ['sermons', sermons],
  ].filter(([key, v]) => v === 'error' && (filter === 'all' || filter === 'places' || filter === key))
  const totalHits = memberHits.length + groupHits.length + departmentHits.length + reelHits.length + sermonHits.length

  const openPost = (p: any) => { onOpenUser?.({ username: p.username, name: p.name }) }

  const SectionTitle = ({ children, count }: { children: React.ReactNode; count: number }) => count > 0 && (
    <p className="text-xs text-ink-subtle px-1 mt-4 mb-1 font-bold uppercase tracking-wider">{children} · {count}</p>
  )

  const MemberRow = ({ u }: { u: any }) => (
    <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-white flex items-center justify-center text-sm font-bold text-accent-strong border-2 border-white shadow-sm">{String(u.username)[0].toUpperCase()}</div></div>
      <div className="flex-1 min-w-0"><p className="text-sm font-bold flex items-center gap-1 truncate">{u.name || u.username} {u.verified && <VerifiedBadge size={14} />}</p><p className="text-xs text-ink-muted truncate">@{u.username} • {u.group_name || u.group || 'Harvest'}</p></div>
      <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">View</span>
    </button>
  )

  return (
    <div className="bg-surface text-ink min-h-[70vh] p-2 pb-8">
      {/* Search bar — pr-14 keeps clear of the fixed notifications bell */}
      <div className="bg-white rounded-2xl flex items-center gap-2 px-3 py-2.5 pr-0 mr-14 border border-line shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B8175" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the church…" aria-label="Search the church" autoCapitalize="none" className="bg-transparent outline-none text-sm flex-1 placeholder:text-ink-subtle" />
        {q && <button onClick={() => setQ('')} className="min-w-[44px] min-h-[44px] -my-2 -mr-1 flex items-center justify-center rounded-full text-ink-muted text-base" aria-label="Clear search"><Icon name="close" size={16} /></button>}
      </div>
      {/* Screen-reader announcement of result counts as the query changes. */}
      <p aria-live="polite" className="sr-only">{showGrid ? '' : loading ? 'Searching…' : `${totalHits} results found`}</p>

      {/* Filter chips */}
      <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Search filters">
        {FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border transition ${filter === f.id ? 'bg-accent text-white border-accent shadow-sm' : 'bg-white text-ink-muted border-line'}`}
          >
            <span className="inline-flex items-center gap-1.5"><Icon name={f.icon} size={13} />{f.label}</span>
          </button>
        ))}
      </div>

      {showGrid ? (
        <>
          {recentSearches.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-ink-subtle font-bold uppercase tracking-wider">Recent searches</p>
                <button onClick={clearRecent} className="text-[11px] font-bold text-accent px-2 py-1.5 rounded-full active:bg-surface-sunken" aria-label="Clear recent searches">Clear</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recentSearches.map(entry => (
                  <span key={entry} className="flex items-center gap-0.5 pl-1 pr-1 py-1 rounded-full bg-white border border-line">
                    <button
                      onClick={() => setQ(entry)}
                      className="pl-2 pr-1 py-1 rounded-full text-xs font-semibold text-ink active:bg-surface-sunken"
                      aria-label={`Search for ${entry}`}
                    >{entry}</button>
                    <button onClick={() => removeRecent(entry)} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-subtle text-xs" aria-label={`Remove ${entry} from recent searches`}><Icon name="close" size={13} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {filter === 'reels' ? (
            <div className="mt-4">
              <p className="text-xs text-ink-subtle px-1 mb-2 font-bold uppercase tracking-wider">Reels • {reelHits.length}</p>
              {reelHits.length > 0 ? (
                <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden">
                  {reelHits.map((r, i) => (
                    <HoverPreviewTile
                      key={r.id || i}
                      videoSrc={r.hls_url || undefined}
                      ariaLabel={`Reel by ${r.username}`}
                      onClick={() => onOpenReel ? onOpenReel(String(r.id)) : onOpenUser?.({ username: r.username, name: r.username })}
                      fallback={<>{r.thumb_url ? <TileImg src={r.thumb_url} /> : null}{!r.thumb_url && r.hls_url ? <video src={`${r.hls_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" /> : null}{!r.thumb_url && !r.hls_url && <div className="w-full h-full bg-gradient-to-br from-accent-soft to-gold-soft flex items-center justify-center" aria-hidden="true"><Icon name="reels" size={22} className="text-accent-strong/60" /></div>}</>}
                      overlay={<span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span>}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-subtle py-6 text-center">No reels yet — be the first to share one.</p>
              )}
            </div>
          ) : (
          <>
          <div className="mt-4 px-1">
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[17px] font-black leading-tight tracking-tight">Discover people</p>
                <p className="mt-0.5 text-xs text-ink-subtle truncate">
                  {users.length} member{users.length === 1 ? '' : 's'}
                  {ministries.length ? ` · ${ministries.length} minister${ministries.length === 1 ? 'y' : 'ies'}` : ''}
                </p>
              </div>
              <button onClick={() => setFilter('members')} className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-2xs font-bold text-accent active:bg-surface-sunken">See all</button>
            </div>

            {/* Scope chips — the rail answers "who is here?" without a search. */}
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Discover scope">
              {([
                { id: 'all', label: 'Everyone' },
                { id: 'verified', label: 'Verified' },
                ...(myMinistry ? [{ id: 'ministry' as const, label: myMinistry }] : []),
              ] as const).map(c => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={discoverScope === c.id}
                  onClick={() => setDiscoverScope(c.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-2xs font-bold transition ${discoverScope === c.id ? 'bg-accent text-white' : 'bg-white text-ink-muted border border-line'}`}
                >{c.label}</button>
              ))}
            </div>

            {discoverPeople.length ? (
              <div className="mt-2 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2">
                {discoverPeople.slice(0, 12).map(u => (
                  <button
                    key={u.username}
                    onClick={() => onView(u)}
                    className="w-[138px] shrink-0 snap-start rounded-3xl border border-line bg-white p-3 text-left shadow-sm transition active:scale-[.98]"
                    aria-label={`Open ${u.name || u.username}'s profile`}
                  >
                    <span className="block w-fit rounded-full bg-gradient-to-tr from-gold to-accent p-[2px]">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-accent-soft text-sm font-extrabold text-accent-strong">
                        {String(u.username)[0].toUpperCase()}
                      </span>
                    </span>
                    <span className="mt-2 flex min-w-0 items-center gap-1">
                      <span className="truncate text-sm font-bold">{u.name || u.username}</span>
                      {u.verified && <VerifiedBadge size={13} />}
                    </span>
                    <span className="block truncate text-2xs text-ink-subtle">@{u.username}</span>
                    <span className="mt-1.5 block truncate rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-accent-strong">
                      {u.group_name || u.group || (u.role === 'admin' ? 'Church admin' : 'Harvest')}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-line bg-white p-4 text-center text-xs text-ink-subtle">
                {discoverScope === 'ministry' ? `No one else listed under ${myMinistry} yet.` : 'No members to show here yet.'}
              </p>
            )}

            {ministries.length > 0 && (
              <div className="mt-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">Browse by ministry</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ministries.map(([name, count]) => (
                    <button
                      key={name}
                      onClick={() => setQ(name)}
                      className="rounded-full bg-surface-sunken px-3 py-1.5 text-2xs font-bold text-ink-muted active:bg-accent-soft"
                    >
                      {name} <span className="text-ink-subtle">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {recentFeed.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-ink-subtle px-1 mb-2 font-bold uppercase tracking-wider">Recent from the community</p>
              <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden">
                {recentFeed.map((p, i) => (
                  <HoverPreviewTile
                    key={p.id || i}
                    videoSrc={p.kind === 'reel' && p.hls_url ? p.hls_url : undefined}
                    ariaLabel={`Post by ${p.name || p.username}`}
                    onClick={() => openPost(p)}
                    fallback={<>{p.thumb_url ? <TileImg src={p.thumb_url} /> : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-soft to-gold-soft" aria-hidden="true"><Icon name="sparkle" size={22} className="text-accent-strong/60" /></div>}</>}
                    overlay={p.kind === 'reel' ? <span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span> : null}
                  />
                ))}
              </div>
            </div>
          )}
          </>
          )}
        </>
      ) : (
        <div className="mt-1">
          {loading && <p className="text-sm text-ink-subtle text-center py-8">Searching…</p>}
          {!loading && failedCorpora.length > 0 && (
            <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 mt-2 flex items-center gap-3">
              <span className="flex-1">Some results may be missing ({failedCorpora.map(([k]) => k).join(', ')}) — couldn't reach the directory.</span>
              <button onClick={() => setBump(b => b + 1)} className="shrink-0 px-3 py-2 rounded-full bg-accent text-white text-xs font-bold">Retry</button>
            </div>
          )}

          {/* ── Members ── */}
          {(filter === 'all' || filter === 'members') && <SectionTitle count={memberHits.length}>Members</SectionTitle>}
          {(filter === 'all' || filter === 'members') && (
            <div className="space-y-1">
              {(filter === 'all' ? memberHits.slice(0, 4) : memberHits).map(u => <MemberRow key={u.username} u={u} />)}
            </div>
          )}

          {/* ── Groups ── */}
          {(filter === 'all' || filter === 'groups') && <SectionTitle count={groupHits.length}>Groups</SectionTitle>}
          {(filter === 'all' || filter === 'groups') && (
            <div className="space-y-1">
              {(filter === 'all' ? groupHits.slice(0, 3) : groupHits).map(g => (
                <button key={g.slug || g.id} onClick={() => onOpenGroups?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent-soft to-gold-soft flex items-center justify-center text-sm font-extrabold text-accent-strong shrink-0">{String(g.name).split(/\s+/).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{g.name}{g.joined && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#0F766E] text-white font-extrabold align-middle">MEMBER</span>}</p><p className="text-xs text-ink-muted truncate">{g.community ? `${g.community} · ` : ''}{g.member_count} member{g.member_count === 1 ? '' : 's'}</p></div>
                  <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Departments ── */}
          {(filter === 'all' || filter === 'departments') && <SectionTitle count={departmentHits.length}>Departments</SectionTitle>}
          {(filter === 'all' || filter === 'departments') && (
            <div className="space-y-1">
              {(filter === 'all' ? departmentHits.slice(0, 3) : departmentHits).map(d => (
                <button key={d.slug || d.id} onClick={() => onOpenDepartments?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-accent-soft flex items-center justify-center shrink-0"><Icon name="building" size={18} className="text-accent-strong" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{d.name}{d.joined && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#0F766E] text-white font-extrabold align-middle">JOINED</span>}</p><p className="text-xs text-ink-muted truncate">{d.member_count} serving{d.description ? ` · ${d.description}` : ''}</p></div>
                  <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Reels ── */}
          {(filter === 'all' || filter === 'reels') && <SectionTitle count={reelHits.length}>Reels</SectionTitle>}
          {(filter === 'all' || filter === 'reels') && reelHits.length > 0 && (
            <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden mt-1">
              {(filter === 'all' ? reelHits.slice(0, 6) : reelHits).map((r, i) => (
                <HoverPreviewTile
                  key={r.id || i}
                  videoSrc={r.hls_url || undefined}
                  ariaLabel={`Reel by ${r.username}`}
                  onClick={() => onOpenReel ? onOpenReel(String(r.id)) : onOpenUser?.({ username: r.username, name: r.username })}
                  fallback={r.thumb_url ? <img src={r.thumb_url} alt="" className="w-full h-full object-cover" /> : r.hls_url
                    ? <video src={`${r.hls_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    : <div className="w-full h-full bg-gradient-to-br from-accent-soft to-gold-soft flex items-center justify-center" aria-hidden="true"><Icon name="reels" size={22} className="text-accent-strong/60" /></div>}
                  overlay={<>
                    <span className="absolute bottom-1 left-1 right-1 text-[9px] font-bold text-white truncate drop-shadow">@{r.username}</span>
                    <span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span>
                  </>}
                />
              ))}
            </div>
          )}

          {/* ── Sermons ── */}
          {(filter === 'all' || filter === 'sermons') && <SectionTitle count={sermonHits.length}>Sermons</SectionTitle>}
          {(filter === 'all' || filter === 'sermons') && (
            <div className="space-y-1">
              {(filter === 'all' ? sermonHits.slice(0, 3) : sermonHits).map(s => (
                <button key={s.id} onClick={() => onOpenSermons?.(String(s.id))} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-gold-soft flex items-center justify-center shrink-0"><Icon name="bookmark" size={18} className="text-gold-strong" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{s.title}</p><p className="text-xs text-ink-muted truncate">{[s.speaker, s.scripture, fmtDuration(s.duration_secs)].filter(Boolean).join(' · ') || 'Sermon'}</p></div>
                  <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">Listen</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Places ── */}
          {(filter === 'all' || filter === 'places') && <SectionTitle count={placeHits.length}>Places & areas</SectionTitle>}
          {(filter === 'all' || filter === 'places') && (
            <div className="space-y-1">
              {(filter === 'all' ? placeHits.slice(0, 4) : placeHits).map(({ kind, item }) => kind === 'member' ? (
                <button key={`m_${item.username}`} onClick={() => onView(item)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-success-soft flex items-center justify-center shrink-0"><Icon name="map" size={18} className="text-success" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{item.name || item.username}</p><p className="text-xs text-ink-muted truncate">{[item.location, item.group_name || item.group, item.constituency].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">View</span>
                </button>
              ) : (
                <button key={`g_${item.slug || item.id}`} onClick={() => onOpenGroups?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-surface-sunken/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-success-soft flex items-center justify-center shrink-0"><Icon name="map" size={18} className="text-success" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{item.name}</p><p className="text-xs text-ink-muted truncate">{[item.location_label, item.community].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-xs bg-surface-sunken text-accent-strong px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && filter !== 'all' && (
            (filter === 'members' && !memberHits.length) ||
            (filter === 'groups' && !groupHits.length) ||
            (filter === 'departments' && !departmentHits.length) ||
            (filter === 'reels' && !reelHits.length) ||
            (filter === 'sermons' && !sermonHits.length) ||
            (filter === 'places' && !placeHits.length)
          ) && (
            <div className="text-center py-10">
              <Icon name="search" size={26} className="mx-auto mb-2 text-ink-subtle" />
              <p className="text-sm font-bold">Nothing found for "{q}"</p>
              <p className="text-xs text-ink-subtle mt-1">Try another spelling, or search All.</p>
            </div>
          )}
          {!loading && filter === 'all' && totalHits === 0 && failedCorpora.length === 0 && (
            <div className="text-center py-10">
              <Icon name="search" size={26} className="mx-auto mb-2 text-ink-subtle" />
              <p className="text-sm font-bold">Nothing found for "{q}"</p>
              <p className="text-xs text-ink-subtle mt-1">Try a member, group, department, reel, sermon or place.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
