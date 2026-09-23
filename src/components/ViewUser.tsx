import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../state/auth'
import StoryViewer from './Stories'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export default function ViewUser({ user, onBack, onEditProfile }: { user: any; onBack: () => void; onEditProfile?: () => void }) {
  const safeUser = user || { username: '', name: '', role: 'member', verified: false, location: '', group_name: 'Harvest Central' }
  const { isAdmin, username: viewerName } = useAuth()

  const [posts, setPosts] = useState<any[]>([])
  const [stories, setStories] = useState<any[]>([])
  const [followState, setFollowState] = useState({ following: false, follows_you: false, mutual: false })
  const [profile, setProfile] = useState(safeUser)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  const [storyIdx, setStoryIdx] = useState<number | null>(null)
  const [postIdx, setPostIdx] = useState<number | null>(null)

  const isSelf = Boolean(viewerName) && viewerName === safeUser.username

  // Viewing your own profile: /api/me is fresher than the directory snapshot
  // (name/phone/avatar edits show up immediately after saving).
  useEffect(() => {
    if (!isSelf) return
    fetch(`${API}/api/me`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('me unavailable'))))
      .then(d => { if (d.user) setProfile((p: any) => ({ ...p, ...d.user })) })
      .catch(() => {})
  }, [isSelf])

  useEffect(() => {
    if (!safeUser.username) return
    let cancelled = false
    setLoaded(false)
    // Profile posts + stories come from the ranked feed filtered by username.
    fetch(`${API}/api/feed?limit=50`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('feed unavailable'))))
      .then(d => {
        if (cancelled) return
        setPosts((d.posts || []).filter((p: any) => p.username === safeUser.username))
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    fetch(`${API}/api/stories`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('no stories'))))
      .then(d => {
        if (cancelled) return
        setStories((d.stories || []).filter((s: any) => s.username === safeUser.username))
      })
      .catch(() => {})
    // Follow state from the server.
    fetch(`${API}/api/users/${encodeURIComponent(safeUser.username)}/mutual`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('no follow state'))))
      .then(d => { if (!cancelled) setFollowState({ following: !!d.following, follows_you: !!d.follows_you, mutual: !!d.mutual }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [safeUser.username])

  const allProfileStories = useMemo(() => stories.map(s => ({ name: s.name || s.username, username: s.username, id: s.id, img: s.thumb_url, video: String(s.media_type) === 'video' ? (s.video_url || s.original_url || undefined) : undefined, caption: '' })), [stories])

  if (!user) return null

  const toggleFollow = async () => {
    if (busy || isSelf) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/api/users/${encodeURIComponent(safeUser.username)}/follow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Action failed')
      setFollowState(s => ({ ...s, following: !!d.following, mutual: !!d.mutual }))
    } catch { /* keep previous state on failure */ } finally { setBusy(false) }
  }

  const adminPatch = async (body: any) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/api/admin/users/${encodeURIComponent(safeUser.username)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Update failed')
      if (d.user) setProfile((p: any) => ({ ...p, ...d.user, group: d.user.group_name }))
      window.dispatchEvent(new Event('harvest:verified'))
    } catch (e: any) {
      alert(e?.message || 'Could not update this member')
    } finally { setBusy(false) }
  }

  const toggleVerify = () => adminPatch({ verified: !profile.verified })
  const cycleRole = () => adminPatch({ role: profile.role === 'admin' ? 'member' : 'admin' })
  const groups = ['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo']
  const addToGroup = (group: string) => adminPatch({ group_name: group })

  const displayName = profile.name || profile.username
  const groupName = profile.group_name || profile.group || 'Harvest Central'

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-purple-50 text-neutral-900">
      {storyIdx !== null && <StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allProfileStories} users={[]} />}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-neutral-200 flex items-center gap-4 px-4 h-14">
        <button onClick={onBack} className="text-2xl hover:opacity-70 transition">‹</button>
        <h1 className="font-bold text-lg truncate">{displayName}</h1>
        {profile.verified ? <span className="ml-auto text-sm badge-verified shrink-0">✓ Verified</span> : <span className="ml-auto text-xs text-neutral-500 shrink-0">{followState.follows_you ? 'Follows you' : ''}</span>}
      </div>
      <div className="px-4 py-6 bg-white/50">
        <div className="flex gap-4 items-start">
          <button
            onClick={() => { if (stories.length) setStoryIdx(0) }}
            disabled={!stories.length}
            aria-label={stories.length ? `View ${displayName}'s status` : 'No status'}
            className={`flex-shrink-0 w-24 h-24 rounded-full p-1 ${stories.length ? 'bg-gradient-to-br from-amber-400 to-purple-600 cursor-pointer active:scale-95 transition-transform' : 'bg-neutral-200'}`}
          >
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-neutral-300 to-neutral-400 flex items-center justify-center text-4xl font-bold text-white">{displayName.charAt(0).toUpperCase()}</div>
            )}
          </button>
          <div className="flex-1 pt-2">
            <h2 className="text-xl font-bold mb-1 truncate">{displayName}</h2>
            <p className="text-sm text-neutral-600 mb-4">@{profile.username}</p>
            <div className="flex gap-4 text-center">
              <div className="flex-1"><p className="text-lg font-bold text-gradient-warm">{loaded ? posts.length : '…'}</p><p className="text-xs text-neutral-600">Posts</p></div>
              <div className="flex-1"><p className="text-lg font-bold text-gradient-warm">{stories.length}</p><p className="text-xs text-neutral-600">Stories</p></div>
              <div className="flex-1"><p className="text-lg font-bold text-gradient-warm">{followState.follows_you ? 'Yes' : '—'}</p><p className="text-xs text-neutral-600">Follows you</p></div>
            </div>
          </div>
          <div className="text-right"><span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap block ${profile.role === 'admin' ? 'badge-admin' : profile.verified ? 'badge-verified' : 'badge-member'}`}>{profile.role === 'admin' ? 'Admin' : profile.verified ? 'Verified' : 'Member'}</span></div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm"><span className="text-xl">📍</span><span className="font-medium">{profile.location || 'Nyeri'}</span></div>
          <div className="flex items-center gap-2 text-sm"><span className="text-xl">👥</span><span className="font-medium bg-gradient-to-r from-amber-400 to-purple-600 bg-clip-text text-transparent">{groupName}</span></div>
        </div>
        {!isSelf && (
          <button onClick={() => void toggleFollow()} disabled={busy} className={`w-full mt-4 py-2.5 rounded-lg font-semibold transition-all ${followState.following ? 'btn-secondary' : 'btn-primary'}`}>
            {followState.mutual ? '✓ Friends' : followState.following ? 'Following' : '+ Follow'}
          </button>
        )}
        {isSelf && onEditProfile && (
          <button onClick={() => onEditProfile()} className="w-full mt-4 py-2.5 rounded-lg btn-primary font-semibold">✏️ Edit profile</button>
        )}
        {isSelf && !onEditProfile && <p className="w-full mt-4 py-2.5 rounded-lg bg-white border border-neutral-200 text-center text-sm text-neutral-500 font-semibold">This is you</p>}
      </div>
      {isAdmin && !isSelf && (
        <div className="mx-4 mt-4 p-4 spiritual-container">
          <p className="text-xs font-bold text-purple-700 mb-3">⚙️ ADMIN CONTROLS</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void toggleVerify()} disabled={busy} className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${profile.verified ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>{profile.verified ? '✕ Unverify' : '✓ Verify'}</button>
            <button onClick={() => void cycleRole()} disabled={busy} className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition-all">Role: {profile.role === 'admin' ? 'Admin' : 'Member'}</button>
          </div>
          <p className="text-xs text-neutral-600 mt-3 mb-2 font-medium">Move to Group:</p>
          <div className="flex flex-wrap gap-2">{groups.map(g => <button key={g} disabled={busy || g === groupName} onClick={() => addToGroup(g)} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${g === groupName ? 'bg-purple-600 text-white' : 'bg-white border-2 border-purple-200 text-purple-700 hover:bg-purple-50'}`}>{g === groupName ? `✓ ${g.split(' ')[1]}` : `→ ${g.split(' ')[1]}`}</button>)}</div>
        </div>
      )}
      {stories.length > 0 && (
        <div className="mt-6 px-4"><h3 className="font-bold text-neutral-900 mb-3">Stories</h3><div className="flex gap-3 overflow-x-auto pb-2">{stories.slice(0, 5).map((s: any, i: number) => <button key={s.id || i} onClick={() => setStoryIdx(i)} className="flex-shrink-0 w-20 h-28 rounded-xl overflow-hidden border-2 border-neutral-200 hover:border-purple-400 transition-all hover-lift relative">{s.thumb_url ? <img src={s.thumb_url} alt="" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} /> : String(s.media_type) === 'video' ? (s.video_url ? <video src={`${s.video_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" /> : <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-2xl">🎥</div>) : <div className="w-full h-full bg-gradient-to-br from-amber-200 to-purple-300 flex items-center justify-center text-2xl">🌅</div>}{String(s.media_type) === 'video' && s.thumb_url && <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-[#141210]/60 flex items-center justify-center text-[10px] text-white">▶</span>}</button>)}</div></div>
      )}
      <div className="mt-6 px-4">
        <h3 className="font-bold text-neutral-900 mb-3">Posts</h3>
        {posts.length === 0 ? <div className="text-center py-12"><div className="text-5xl mb-3">📸</div><p className="text-neutral-600 font-medium">{loaded ? 'No posts yet' : 'Loading…'}</p></div> : <div className="grid grid-cols-3 gap-1 bg-neutral-200 rounded-xl overflow-hidden">{posts.map((p: any, i: number) => <button key={p.id || i} onClick={() => setPostIdx(i)} className="aspect-square overflow-hidden hover:opacity-80 transition-opacity group relative">{p.thumb_url ? <img src={p.thumb_url} alt="" className="w-full h-full object-cover" /> : p.hls_url ? <video src={`${p.hls_url}#t=0.001`} className="w-full h-full object-cover" muted playsInline preload="metadata" /> : <div className="w-full h-full bg-neutral-100 flex items-center justify-center text-2xl">🙏</div>}{p.hls_url && <span className="absolute top-1.5 right-1.5 text-white drop-shadow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1"><rect x="2" y="2" width="20" height="20" rx="5" fill="none" strokeWidth="2" /><path d="M10 8l6 4-6 4z" /></svg></span>}</button>)}</div>}
      </div>
      {postIdx !== null && posts[postIdx] && (
        <div className="fixed inset-0 bg-[#141210]/90 z-50 flex flex-col" onClick={() => setPostIdx(null)}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700"><p className="font-bold text-sm text-white">{profile.username} • {postIdx + 1}/{posts.length}</p><button onClick={() => setPostIdx(null)} className="text-white text-2xl hover:opacity-70">✕</button></div>
          <div className="flex-1 flex items-center justify-center p-4 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPostIdx(i => i! > 0 ? i! - 1 : null)} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition">‹</button>
            <div className="w-full max-w-[390px]">{posts[postIdx].hls_url ? <video src={posts[postIdx].hls_url} controls playsInline className="w-full aspect-square object-cover bg-[#141210] rounded-xl" poster={posts[postIdx].thumb_url} /> : posts[postIdx].thumb_url ? <img src={posts[postIdx].thumb_url} alt="" className="w-full aspect-square object-cover rounded-xl" /> : <div className="w-full aspect-square bg-neutral-800 rounded-xl flex items-center justify-center text-4xl">🙏</div>}<p className="text-sm mt-3 px-2 text-white"><span className="font-semibold">{profile.username}</span> {posts[postIdx].caption}</p></div>
            <button onClick={() => setPostIdx(i => i! < posts.length - 1 ? i! + 1 : null)} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition">›</button>
          </div>
          <p className="text-xs text-neutral-400 text-center py-2">Tap outside to close • {postIdx + 1}/{posts.length}</p>
        </div>
      )}
    </div>
  )
}
