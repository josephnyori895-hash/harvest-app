import { useState, useEffect, useMemo } from 'react'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

type Filter = 'all' | 'members' | 'groups' | 'departments' | 'reels' | 'sermons' | 'places'

const FILTERS: { id: Filter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '✨' },
  { id: 'members', label: 'Members', icon: '👤' },
  { id: 'groups', label: 'Groups', icon: '👥' },
  { id: 'departments', label: 'Departments', icon: '🏛️' },
  { id: 'reels', label: 'Reels', icon: '🎥' },
  { id: 'sermons', label: 'Sermons', icon: '📖' },
  { id: 'places', label: 'Places', icon: '📍' },
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
export default function Search({ users, onView, onOpenUser, onOpenGroups, onOpenDepartments, onOpenSermons, onOpenReel }: {
  users: any[]
  onView: (u: any) => void
  onOpenUser?: (u: any) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: () => void
  onOpenReel?: (reelId: string) => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [recent, setRecent] = useState<any[]>([])
  // Lazy-loaded search corpora (null = not fetched yet).
  const [groups, setGroups] = useState<any[] | null>(null)
  const [departments, setDepartments] = useState<any[] | null>(null)
  const [reels, setReels] = useState<any[] | null>(null)
  const [sermons, setSermons] = useState<any[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const query = q.trim().toLowerCase()
  const showGrid = query === ''

  // Everything except members comes from the API — fetch when a search starts.
  useEffect(() => {
    if (showGrid) return
    let cancelled = false
    const need = { groups, departments, reels, sermons }
    const want = filter === 'all' || filter === 'places'
      ? ['groups', 'departments', 'reels', 'sermons']
      : [filter]
    const missing = want.filter(k => need[k as keyof typeof need] === null)
    if (!missing.length) return
    if (missing.includes('groups')) fetch(`${API}/api/groups`, { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (!cancelled) setGroups(Array.isArray(d.groups) ? d.groups : []) }).catch(() => { if (!cancelled) setLoadFailed(true) })
    if (missing.includes('departments')) fetch(`${API}/api/departments`, { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (!cancelled) setDepartments(Array.isArray(d.departments) ? d.departments : []) }).catch(() => { if (!cancelled) setLoadFailed(true) })
    if (missing.includes('reels')) fetch(`${API}/api/reels?limit=50`, { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (!cancelled) setReels(Array.isArray(d.reels) ? d.reels : []) }).catch(() => { if (!cancelled) setLoadFailed(true) })
    if (missing.includes('sermons')) fetch(`${API}/api/sermons?limit=50`, { headers: authHeaders() }).then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (!cancelled) setSermons(Array.isArray(d.sermons) ? d.sermons : []) }).catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGrid, filter, query])

  // Real "explore" grid: latest approved posts from the community feed.
  useEffect(() => {
    if (!showGrid) return
    let cancelled = false
    fetch(`${API}/api/feed?limit=9`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('no feed'))))
      .then(d => { if (!cancelled) setRecent(Array.isArray(d.posts) ? d.posts : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [showGrid])

  const memberHits = useMemo(() => query === '' ? [] : users.filter(u =>
    (u.username || '').toLowerCase().includes(query) ||
    (u.name || '').toLowerCase().includes(query) ||
    (u.group_name || u.group || '').toLowerCase().includes(query)
  ), [users, query])

  const groupHits = useMemo(() => query === '' || !groups ? [] : groups.filter(g =>
    (g.name || '').toLowerCase().includes(query) ||
    (g.description || '').toLowerCase().includes(query) ||
    (g.community || '').toLowerCase().includes(query)
  ), [groups, query])

  const departmentHits = useMemo(() => query === '' || !departments ? [] : departments.filter(d =>
    (d.name || '').toLowerCase().includes(query) ||
    (d.description || '').toLowerCase().includes(query)
  ), [departments, query])

  const reelHits = useMemo(() => query === '' || !reels ? [] : reels.filter(r =>
    (r.caption || '').toLowerCase().includes(query) ||
    (r.username || '').toLowerCase().includes(query)
  ), [reels, query])

  const sermonHits = useMemo(() => query === '' || !sermons ? [] : sermons.filter(s =>
    (s.title || '').toLowerCase().includes(query) ||
    (s.speaker || '').toLowerCase().includes(query) ||
    (s.scripture || '').toLowerCase().includes(query) ||
    (s.description || '').toLowerCase().includes(query)
  ), [sermons, query])

  // Places: members' congregation/location text plus groups' area labels.
  const placeHits = useMemo(() => {
    if (query === '') return [] as { kind: 'member' | 'group'; item: any }[]
    const out: { kind: 'member' | 'group'; item: any }[] = []
    users.filter(u =>
      (u.location || '').toLowerCase().includes(query) ||
      (u.group_name || u.group || '').toLowerCase().includes(query) ||
      (u.constituency || '').toLowerCase().includes(query)
    ).forEach(item => out.push({ kind: 'member', item }))
    ;(groups || []).filter(g =>
      (g.location_label || '').toLowerCase().includes(query) ||
      (g.community || '').toLowerCase().includes(query)
    ).forEach(item => out.push({ kind: 'group', item }))
    return out
  }, [users, groups, query])

  const loading = !showGrid && (groups === null || departments === null || reels === null || sermons === null) && !loadFailed
  const totalHits = memberHits.length + groupHits.length + departmentHits.length + reelHits.length + sermonHits.length

  const openPost = (p: any) => { onOpenUser?.({ username: p.username, name: p.name }) }

  const SectionTitle = ({ children, count }: { children: React.ReactNode; count: number }) => count > 0 && (
    <p className="text-xs text-[#8B8175] px-1 mt-4 mb-1 font-bold uppercase tracking-wider">{children} · {count}</p>
  )

  const MemberRow = ({ u }: { u: any }) => (
    <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-white flex items-center justify-center text-sm font-bold text-[#5B21B6] border-2 border-white shadow-sm">{String(u.username)[0].toUpperCase()}</div></div>
      <div className="flex-1 min-w-0"><p className="text-sm font-bold flex items-center gap-1 truncate">{u.name || u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-[#0F766E] flex items-center justify-center text-[8px] text-white shrink-0">✓</span>}</p><p className="text-xs text-[#766E63] truncate">@{u.username} • {u.group_name || u.group || 'Harvest'}</p></div>
      <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">View</span>
    </button>
  )

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-2 pb-8">
      {/* Search bar */}
      <div className="bg-white rounded-2xl flex items-center gap-2 px-3 py-2.5 border border-[#E8DEC9] shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B8175" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the church…" autoCapitalize="none" className="bg-transparent outline-none text-sm flex-1 placeholder:text-[#A49A8E]" />
        {q && <button onClick={() => setQ('')} className="w-7 h-7 rounded-full bg-[#F4E8D0] text-[#766E63] text-xs font-bold" aria-label="Clear search">✕</button>}
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Search filters">
        {FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border transition ${filter === f.id ? 'bg-[#7C3AED] text-white border-[#7C3AED] shadow-sm' : 'bg-white text-[#5C554C] border-[#E8DEC9]'}`}
          >
            <span aria-hidden="true" className="mr-1">{f.icon}</span>{f.label}
          </button>
        ))}
      </div>

      {showGrid ? (
        <>
          <p className="text-xs text-[#8B8175] px-1 mt-3 font-bold uppercase tracking-wider">Suggested • {users.length} members</p>
          <div className="mt-2 space-y-1">
            {users.slice(0, 5).map(u => (
              <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-2 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-xs font-extrabold text-[#5B21B6]">{String(u.username)[0].toUpperCase()}</div>
                <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{u.name || u.username}</p><p className="text-xs text-[#8B8175] truncate">@{u.username}{u.group_name ? ` • ${u.group_name}` : ''}</p></div>
                <span className="text-[#7C3AED] text-sm font-bold shrink-0">View</span>
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-[#8B8175] px-1 mb-2 font-bold uppercase tracking-wider">Recent from the community</p>
              <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden">
                {recent.map((p, i) => (
                  <button key={p.id || i} onClick={() => openPost(p)} className="aspect-square bg-[#F4E8D0] overflow-hidden relative group">
                    {p.kind === 'reel'
                      ? p.hls_url
                        ? <video src={`${p.hls_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                        : p.thumb_url ? <img src={p.thumb_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-2xl">🎥</div>
                      : p.thumb_url ? <img src={p.thumb_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">🙏</div>}
                    {p.kind === 'reel' && <span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mt-1">
          {loading && <p className="text-sm text-[#8B8175] text-center py-8">Searching…</p>}
          {!loading && loadFailed && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 mt-2">Some results may be missing — the church directory couldn't be reached. Check your connection and search again.</div>}

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
                <button key={g.slug || g.id} onClick={() => onOpenGroups?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-sm font-extrabold text-[#5B21B6] shrink-0">{String(g.name).split(/\s+/).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{g.name}{g.joined && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#0F766E] text-white font-extrabold align-middle">MEMBER</span>}</p><p className="text-xs text-[#766E63] truncate">{g.community ? `${g.community} · ` : ''}{g.member_count} member{g.member_count === 1 ? '' : 's'}</p></div>
                  <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Departments ── */}
          {(filter === 'all' || filter === 'departments') && <SectionTitle count={departmentHits.length}>Departments</SectionTitle>}
          {(filter === 'all' || filter === 'departments') && (
            <div className="space-y-1">
              {(filter === 'all' ? departmentHits.slice(0, 3) : departmentHits).map(d => (
                <button key={d.slug || d.id} onClick={() => onOpenDepartments?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-[#F3E8FF] flex items-center justify-center text-lg shrink-0">🏛️</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{d.name}{d.joined && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#0F766E] text-white font-extrabold align-middle">JOINED</span>}</p><p className="text-xs text-[#766E63] truncate">{d.member_count} serving{d.description ? ` · ${d.description}` : ''}</p></div>
                  <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Reels ── */}
          {(filter === 'all' || filter === 'reels') && <SectionTitle count={reelHits.length}>Reels</SectionTitle>}
          {(filter === 'all' || filter === 'reels') && reelHits.length > 0 && (
            <div className="grid grid-cols-3 gap-[3px] rounded-2xl overflow-hidden mt-1">
              {(filter === 'all' ? reelHits.slice(0, 6) : reelHits).map((r, i) => (
                <button key={r.id || i} onClick={() => onOpenReel ? onOpenReel(String(r.id)) : onOpenUser?.({ username: r.username, name: r.username })} className="aspect-square bg-[#F4E8D0] overflow-hidden relative">
                  {r.thumb_url ? <img src={r.thumb_url} alt="" className="w-full h-full object-cover" /> : r.hls_url
                    ? <video src={`${r.hls_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    : <div className="w-full h-full bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-2xl">🎥</div>}
                  <span className="absolute bottom-1 left-1 right-1 text-[9px] font-bold text-white truncate drop-shadow">@{r.username}</span>
                  <span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span>
                </button>
              ))}
            </div>
          )}

          {/* ── Sermons ── */}
          {(filter === 'all' || filter === 'sermons') && <SectionTitle count={sermonHits.length}>Sermons</SectionTitle>}
          {(filter === 'all' || filter === 'sermons') && (
            <div className="space-y-1">
              {(filter === 'all' ? sermonHits.slice(0, 3) : sermonHits).map(s => (
                <button key={s.id} onClick={() => onOpenSermons?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-[#FEF3C7] flex items-center justify-center text-lg shrink-0">📖</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{s.title}</p><p className="text-xs text-[#766E63] truncate">{[s.speaker, s.scripture, fmtDuration(s.duration_secs)].filter(Boolean).join(' · ') || 'Sermon'}</p></div>
                  <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">Listen</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Places ── */}
          {(filter === 'all' || filter === 'places') && <SectionTitle count={placeHits.length}>Places & areas</SectionTitle>}
          {(filter === 'all' || filter === 'places') && (
            <div className="space-y-1">
              {(filter === 'all' ? placeHits.slice(0, 4) : placeHits).map(({ kind, item }) => kind === 'member' ? (
                <button key={`m_${item.username}`} onClick={() => onView(item)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-[#D1FAE5] flex items-center justify-center text-lg shrink-0">📍</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{item.name || item.username}</p><p className="text-xs text-[#766E63] truncate">{[item.location, item.group_name || item.group, item.constituency].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">View</span>
                </button>
              ) : (
                <button key={`g_${item.slug || item.id}`} onClick={() => onOpenGroups?.()} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                  <div className="w-10 h-10 rounded-2xl bg-[#D1FAE5] flex items-center justify-center text-lg shrink-0">📍</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate">{item.name}</p><p className="text-xs text-[#766E63] truncate">{[item.location_label, item.community].filter(Boolean).join(' · ')}</p></div>
                  <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold shrink-0">Open</span>
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
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm font-bold">Nothing found for "{q}"</p>
              <p className="text-xs text-[#8B8175] mt-1">Try another spelling, or search All.</p>
            </div>
          )}
          {!loading && filter === 'all' && totalHits === 0 && !loadFailed && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm font-bold">Nothing found for "{q}"</p>
              <p className="text-xs text-[#8B8175] mt-1">Try a member, group, department, reel, sermon or place.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
