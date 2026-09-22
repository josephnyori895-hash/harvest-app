import { useState, useEffect } from 'react'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export default function Search({ users, onView, onOpenUser }: { users: any[]; onView: (u: any) => void; onOpenUser?: (u: any) => void }) {
  const [q, setQ] = useState('')
  const [recent, setRecent] = useState<any[]>([])
  const filtered = q.trim() === '' ? [] : users.filter(u => (u.username || '').toLowerCase().includes(q.toLowerCase()) || (u.name || '').toLowerCase().includes(q.toLowerCase()))
  const showGrid = q.trim() === ''

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

  // Tapping a community tile opens the author's profile (their post grid follows).
  const openPost = (p: any) => { onOpenUser?.({ username: p.username, name: p.name }) }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-2">
      <div className="bg-white rounded-2xl flex items-center gap-2 px-3 py-2.5 border border-[#E8DEC9] shadow-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B8175" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by username" autoCapitalize="none" className="bg-transparent outline-none text-sm flex-1 placeholder:text-[#A49A8E]" /></div>
      {q && <p className="text-xs text-[#8B8175] px-1 mt-2">{filtered.length} users found for "{q}"</p>}
      {!showGrid ? (
        <div className="mt-3 space-y-1">
          {filtered.map(u => (
            <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-white flex items-center justify-center text-sm font-bold text-[#5B21B6] border-2 border-white shadow-sm">{String(u.username)[0].toUpperCase()}</div></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-bold flex items-center gap-1">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-[#0F766E] flex items-center justify-center text-[8px] text-white">✓</span>}</p><p className="text-xs text-[#766E63] truncate">{u.name} • {u.group_name || u.group || 'Harvest'}</p></div>
              <span className="text-xs bg-[#F4E8D0] text-[#5B21B6] px-4 py-1.5 rounded-full font-bold">View</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-[#8B8175] text-center py-8">No members found with that name</p>}
        </div>
      ) : (
        <>
          <p className="text-xs text-[#8B8175] px-1 mt-3 font-bold uppercase tracking-wider">Suggested • {users.length} members</p>
          <div className="mt-2 space-y-1">
            {users.slice(0, 5).map(u => (
              <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-2 hover:bg-[#F4E8D0]/60 rounded-2xl text-left">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-xs font-extrabold text-[#5B21B6]">{String(u.username)[0].toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-bold">{u.name || u.username}</p><p className="text-xs text-[#8B8175]">@{u.username}</p></div>
                <span className="text-[#7C3AED] text-sm font-bold">View</span>
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
                      // IG pattern: the grid tile IS the video's visible frame.
                      // #t=0.001 makes mobile WebViews render the first frame even
                      // without a poster; a static tinted tile is the fallback.
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
      )}
    </div>
  )
}
