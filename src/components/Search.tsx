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
    <div className="bg-black text-white min-h-[70vh] p-2">
      <div className="bg-zinc-900 rounded-xl flex items-center gap-2 px-3 py-2.5 border border-zinc-800"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.7"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by username" autoCapitalize="none" className="bg-transparent outline-none text-sm flex-1 placeholder:text-zinc-500" /></div>
      {q && <p className="text-xs text-zinc-500 px-1 mt-2">{filtered.length} users found for "{q}"</p>}
      {!showGrid ? (
        <div className="mt-3 space-y-1">
          {filtered.map(u => (
            <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-3 hover:bg-zinc-900 rounded-xl text-left">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-sm font-bold border border-black">{String(u.username)[0].toUpperCase()}</div></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold flex items-center gap-1">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span>}</p><p className="text-xs text-zinc-400 truncate">{u.name} • {u.group_name || u.group || 'Harvest'}</p></div>
              <span className="text-xs bg-zinc-800 px-4 py-1.5 rounded-full font-semibold">View</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No members found with that name</p>}
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-500 px-1 mt-3">Suggested • {users.length} members</p>
          <div className="mt-2 space-y-1">
            {users.slice(0, 5).map(u => (
              <button key={u.username} onClick={() => onView(u)} className="w-full flex gap-3 items-center px-3 py-2 hover:bg-zinc-900 rounded-xl text-left">
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-xs">{String(u.username)[0].toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-semibold">{u.name || u.username}</p><p className="text-xs text-zinc-500">@{u.username}</p></div>
                <button onClick={() => onView(u)} className="text-blue-500 text-sm font-semibold">View</button>
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-zinc-500 px-1 mb-2">Recent from the community</p>
              <div className="grid grid-cols-3 gap-[2px]">
                {recent.map((p, i) => (
                  <button key={p.id || i} onClick={() => openPost(p)} className="aspect-square bg-zinc-900 overflow-hidden relative group">
                    {p.kind === 'reel'
                      ? <video src={p.hls_url || p.thumb_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      : p.thumb_url ? <img src={p.thumb_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">🙏</div>}
                    {(p.kind === 'reel' || p.hls_url) && <span className="absolute top-1 right-1 text-xs">▶</span>}
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
