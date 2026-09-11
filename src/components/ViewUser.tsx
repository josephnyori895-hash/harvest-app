import { useState, useMemo } from 'react'
import { isMutual, toggleFollowMutual, getFollowsMap } from '../state/auth'
import StoryViewer from './Stories'

export default function ViewUser({ user, onBack }: { user: any; onBack: () => void }) {
  if (!user) return null
  const approvedPosts: any[] = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_approved_posts')||'[]')}catch{return []}})()
  const allUserPosts = [...approvedPosts.filter((p:any)=>p.user===user.username), ...postsStatic.filter(p => p.user === user.username)]
  const userPosts = allUserPosts
  const approvedStories: any[] = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_approved_stories')||'[]')}catch{return []}})()
  const userStories = approvedStories.filter((s:any)=> s.name===user.username || String(s.id).startsWith(user.username+'_'))
  const hasStory = userStories.length>0
  const [storyIdx, setStoryIdx] = useState<number|null>(null)
  const [postIdx, setPostIdx] = useState<number|null>(null)
  const allProfileStories = useMemo(()=> userStories.map((s:any)=>({name:s.name, id:s.id, img:s.img, caption:s.caption})), [userStories])
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || localStorage.getItem('harvest_username') || 'allan' } catch { return 'allan' }
  })()
  const viewerIsAdmin = (() => {
    try { return localStorage.getItem('harvest_role') === 'admin' || currentUser === 'allan' } catch { return false }
  })()
  const { role: myRole } = (() => { try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0] || {} } catch { return {} } })()

  const [tick, setTick] = useState(0)
  const followingMap = getFollowsMap()
  const viewerFollowsTarget = (followingMap[currentUser] ?? []).includes(user.username)
  const canSee = viewerIsAdmin || isMutual(currentUser, user.username)
  const toggle = () => { toggleFollowMutual(currentUser, user.username); setTick(x => x + 1) }

  // Admin controls
  const toggleVerify = () => {
    const updated = JSON.parse(localStorage.getItem('harvest_users')||'[]').map((u:any) => u.username === user.username ? {...u, verified: !u.verified} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const cycleRole = () => {
    const roles: Record<string, string> = { member: 'leader', leader: 'admin', admin: 'member' }
    const updated = JSON.parse(localStorage.getItem('harvest_users')||'[]').map((u:any) => u.username === user.username ? {...u, role: roles[u.role] || 'member'} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const addToGroup = (group: string) => {
    const updated = JSON.parse(localStorage.getItem('harvest_users')||'[]').map((u:any) => u.username === user.username ? {...u, group, assignedGroupIds: [...(u.assignedGroupIds||[]), group]} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  return (
    <div className="bg-black text-white min-h-[70vh]">
      {storyIdx!==null && <StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allProfileStories} />}
      <div className="flex items-center gap-3 px-4 h-[56px] border-b border-zinc-800"><button onClick={onBack} className="text-xl">‹</button><p className="font-bold text-sm">{user.username}</p>{user.verified && <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span>}{user.role && <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${user.role==='admin'?'bg-purple-600 text-white':user.role==='leader'?'bg-blue-600 text-white':'bg-zinc-700 text-zinc-300'}`}>{user.role||'member'}</span>}</div>
      <div className="px-4 py-4 flex gap-4 items-center">
        <button onClick={()=> hasStory && setStoryIdx(0)} className={`w-20 h-20 rounded-full p-[2px] ${hasStory?'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600':'bg-zinc-700'}`} disabled={!hasStory}><div className="w-full h-full rounded-full bg-black flex items-center justify-center font-bold text-lg border-2 border-black">{user.username[0].toUpperCase()}</div></button>
        <div className="flex gap-6 flex-1 justify-around text-center"><div><p className="font-bold">{userPosts.length}</p><p className="text-xs text-zinc-400">posts</p></div><div><p className="font-bold">{user.followers||0}</p><p className="text-xs text-zinc-400">followers</p></div><div><p className="font-bold">48</p><p className="text-xs text-zinc-400">following</p></div></div>
      </div>
      <div className="px-4"><p className="text-sm font-semibold">{user.name}</p>
        {canSee ? <p className="text-sm text-zinc-400">{user.username} • 📍 {user.location || 'Nyeri'} • 👥 {user.group || 'Harvest'}</p> : <p className="text-sm text-zinc-400">{user.username} • 📍 Hidden — mutual follow to see location</p>}
        <div className="flex gap-2 mt-2">
          <span className={`text-xs px-2 py-1 rounded-full ${canSee ? 'bg-zinc-800' : 'bg-zinc-800 opacity-50'}`}>📍 {canSee ? (user.location || 'Nyeri') : 'Hidden'}</span>
          <span className="text-xs bg-gradient-to-r from-yellow-500 to-purple-600 text-black px-2 py-1 rounded-full font-semibold">👥 {user.group || 'Harvest'}</span>
        </div>
        <button onClick={toggle} className={`mt-3 w-full py-1.5 rounded-lg text-sm font-semibold ${viewerFollowsTarget ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-[#0095f6] text-white'}`}>
          {viewerFollowsTarget ? 'Following ✓ (tap to unfollow)' : 'Follow'}
        </button>

        {/* Admin-only controls */}
        {viewerIsAdmin && (
          <div className="mt-3 space-y-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <p className="text-[11px] font-bold text-amber-400">ADMIN CONTROLS</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={toggleVerify} className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-bold">{user.verified ? '✕ Unverify' : '✓ Verify'}</button>
              <button onClick={cycleRole} className="px-3 py-1.5 rounded-full bg-purple-600 text-white text-xs font-bold">Role: {user.role||'member'}</button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['Harvest Central','Harvest Skuta','Harvest Kamakwa','Harvest Ruringu'].map(g => (
                <button key={g} onClick={() => addToGroup(g)} className="px-2 py-1 rounded-full bg-zinc-800 text-white text-[10px]">+ {g}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-[1px] bg-zinc-800 mt-4">{userPosts.length ? userPosts.map((p: any, i: number) => <button key={i} onClick={()=> setPostIdx(i)} className="aspect-square bg-zinc-900"><img src={p.img} alt="" className="w-full h-full object-cover" /></button>) : <div className="col-span-3 py-12 text-center text-sm text-zinc-500">No posts yet — follow to see when {user.username} shares</div>}</div>
      {postIdx!==null && allUserPosts[postIdx] && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col" onClick={()=> setPostIdx(null)}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800"><p className="font-bold text-sm">{user.username} • {postIdx+1}/{allUserPosts.length}</p><button onClick={()=> setPostIdx(null)} className="text-xl px-2">✕</button></div>
          <div className="flex-1 flex items-center justify-center p-4 relative" onClick={e=>e.stopPropagation()}>
            <button onClick={()=> setPostIdx(i=> i! >0 ? i!-1 : null)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">‹</button>
            <div className="w-full max-w-[390px]">
              {allUserPosts[postIdx].video ? <video src={allUserPosts[postIdx].video} controls playsInline className="w-full aspect-square object-cover bg-zinc-900" poster={allUserPosts[postIdx].img} /> : <img src={allUserPosts[postIdx].img} alt="" className="w-full aspect-square object-cover bg-zinc-900" />}
              <p className="text-sm mt-3 px-2"><span className="font-semibold">{user.username}</span> {allUserPosts[postIdx].caption}</p>
            </div>
            <button onClick={()=> setPostIdx(i=> i! < allUserPosts.length-1 ? i!+1 : null)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">›</button>
          </div>
          <p className="text-xs text-zinc-500 text-center py-2">Tap outside to close • Swipe posts — {postIdx+1}/{allUserPosts.length}</p>
        </div>
      )}
    </div>
  )
}
