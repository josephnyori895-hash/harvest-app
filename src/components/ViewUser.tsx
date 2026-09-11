import { useState, useMemo } from 'react'
import { isMutual, toggleFollowMutual, getFollowsMap } from '../state/auth'
import StoryViewer from './Stories'

const postsStatic = [
  { user: 'allan', verified: true, loc: 'Nyeri • Main Sanctuary', time: '2h', likes: 1243, img: 'https://images.unsplash.com/photo-1507692049790-de582271b65a?w=500&h=500&fit=crop', caption: 'Blessed Sunday service 🙏' },
]

export default function ViewUser({ user, onBack }: { user: any; onBack: () => void }) {
  const username = user?.username || ''
  const approvedPosts: any[] = (() => { try { return JSON.parse(localStorage.getItem('harvest_approved_posts') || '[]') } catch { return [] } })()
  const allUserPosts = [...approvedPosts.filter((p: any) => p.user === username), ...postsStatic.filter(p => p.user === username)]
  const approvedStories: any[] = (() => { try { return JSON.parse(localStorage.getItem('harvest_approved_stories') || '[]') } catch { return [] } })()
  const userStories = approvedStories.filter((s: any) => s.name === username || String(s.id).startsWith(username + '_'))
  const hasStory = userStories.length > 0

  const [storyIdx, setStoryIdx] = useState<number | null>(null)
  const [postIdx, setPostIdx] = useState<number | null>(null)
  const allProfileStories = useMemo(() => userStories.map((s: any) => ({ name: s.name, id: s.id, img: s.img, caption: s.caption })), [userStories])

  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || localStorage.getItem('harvest_username') || 'allan' } catch { return 'allan' } })()
  const viewerIsAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' || currentUser === 'allan' } catch { return false } })()

  const [, setTick] = useState(0)
  const followingMap = getFollowsMap()
  const viewerFollowsTarget = (followingMap[currentUser] ?? []).includes(username)
  const canSee = viewerIsAdmin || isMutual(currentUser, username)
  const toggle = () => { toggleFollowMutual(currentUser, username); setTick(x => x + 1) }

  if (!user) return null

  const toggleVerify = () => {
    const updated = JSON.parse(localStorage.getItem('harvest_users') || '[]').map((u: any) => u.username === user.username ? { ...u, verified: !u.verified } : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const cycleRole = () => {
    const roles: Record<string, string> = { member: 'leader', leader: 'admin', admin: 'member' }
    const updated = JSON.parse(localStorage.getItem('harvest_users') || '[]').map((u: any) => u.username === user.username ? { ...u, role: roles[u.role] || 'member' } : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const addToGroup = (group: string) => {
    const updated = JSON.parse(localStorage.getItem('harvest_users') || '[]').map((u: any) => u.username === user.username ? { ...u, group, assignedGroupIds: [...(u.assignedGroupIds || []), group] } : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-purple-50 text-neutral-900">
      {storyIdx !== null && <StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allProfileStories} />}

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-neutral-200 flex items-center gap-4 px-4 h-14">
        <button onClick={onBack} className="text-2xl hover:opacity-70 transition">‹</button>
        <h1 className="font-bold text-lg">{user.name}</h1>
        {user.verified && <span className="ml-auto text-sm badge-verified">✓ Verified</span>}
      </div>

      {/* Profile Header */}
      <div className="px-4 py-6 bg-white/50">
        <div className="flex gap-4 items-start">
          {/* Avatar */}
          <button
            onClick={() => hasStory && setStoryIdx(0)}
            className={`flex-shrink-0 w-24 h-24 rounded-full p-1 transition-all hover-lift ${hasStory ? 'bg-gradient-to-br from-amber-400 to-purple-600' : 'bg-neutral-200'}`}
            disabled={!hasStory}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-br from-neutral-300 to-neutral-400 flex items-center justify-center text-4xl font-bold text-white">
              {user.name.charAt(0)}
            </div>
          </button>

          {/* Stats */}
          <div className="flex-1 pt-2">
            <h2 className="text-xl font-bold mb-1">{user.name}</h2>
            <p className="text-sm text-neutral-600 mb-4">@{user.username}</p>

            <div className="flex gap-4 text-center">
              <div className="flex-1">
                <p className="text-lg font-bold text-gradient-warm">{allUserPosts.length}</p>
                <p className="text-xs text-neutral-600">Posts</p>
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold text-gradient-warm">{user.followers || 0}</p>
                <p className="text-xs text-neutral-600">Followers</p>
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold text-gradient-warm">{userStories.length}</p>
                <p className="text-xs text-neutral-600">Stories</p>
              </div>
            </div>
          </div>

          {/* Role Badge */}
          <div className="text-right">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap block ${
              user.role === 'admin'
                ? 'badge-admin'
                : user.role === 'leader'
                ? 'badge-leader'
                : 'badge-member'
            }`}>
              {user.role?.charAt(0).toUpperCase() + (user.role?.slice(1) || 'member')}
            </span>
          </div>
        </div>

        {/* Bio & Location */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xl">📍</span>
            <span className="font-medium">{canSee ? (user.location || 'Nyeri') : 'Hidden'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xl">👥</span>
            <span className="font-medium bg-gradient-to-r from-amber-400 to-purple-600 bg-clip-text text-transparent">{user.group || 'Harvest Central'}</span>
          </div>
        </div>

        {/* Follow Button */}
        <button
          onClick={toggle}
          className={`w-full mt-4 py-2.5 rounded-lg font-semibold transition-all ${
            viewerFollowsTarget
              ? 'btn-secondary'
              : 'btn-primary'
          }`}
        >
          {viewerFollowsTarget ? '✓ Following' : '+ Follow'}
        </button>
      </div>

      {/* Admin Controls */}
      {viewerIsAdmin && (
        <div className="mx-4 mt-4 p-4 spiritual-container">
          <p className="text-xs font-bold text-purple-700 mb-3">⚙️ ADMIN CONTROLS</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={toggleVerify}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                user.verified
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              }`}
            >
              {user.verified ? '✕ Unverify' : '✓ Verify'}
            </button>
            <button
              onClick={cycleRole}
              className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition-all"
            >
              Role: {user.role || 'member'}
            </button>
          </div>
          <p className="text-xs text-neutral-600 mt-3 mb-2 font-medium">Add to Group:</p>
          <div className="flex flex-wrap gap-2">
            {['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu'].map(g => (
              <button
                key={g}
                onClick={() => addToGroup(g)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white border-2 border-purple-200 text-purple-700 hover:bg-purple-50 transition-all"
              >
                + {g.split(' ')[1]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stories Preview */}
      {hasStory && (
        <div className="mt-6 px-4">
          <h3 className="font-bold text-neutral-900 mb-3">Stories</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {userStories.slice(0, 5).map((s: any, i: number) => (
              <button
                key={i}
                onClick={() => setStoryIdx(i)}
                className="flex-shrink-0 w-20 h-28 rounded-xl overflow-hidden border-2 border-neutral-200 hover:border-purple-400 transition-all hover-lift"
              >
                <img src={s.img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Posts Grid */}
      <div className="mt-6 px-4">
        <h3 className="font-bold text-neutral-900 mb-3">Posts</h3>
        {allUserPosts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">📸</div>
            <p className="text-neutral-600 font-medium">No posts yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1 bg-neutral-200 rounded-xl overflow-hidden">
            {allUserPosts.map((p: any, i: number) => (
              <button
                key={i}
                onClick={() => setPostIdx(i)}
                className="aspect-square overflow-hidden hover:opacity-80 transition-opacity group relative"
              >
                {p.video ? (
                  <>
                    <video src={p.video} className="w-full h-full object-cover" poster={p.img} />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-all flex items-center justify-center">
                      <span className="text-white text-2xl">▶</span>
                    </div>
                  </>
                ) : (
                  <img src={p.img} alt="" className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Post Modal */}
      {postIdx !== null && allUserPosts[postIdx] && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" onClick={() => setPostIdx(null)}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700">
            <p className="font-bold text-sm text-white">{user.username} • {postIdx + 1}/{allUserPosts.length}</p>
            <button onClick={() => setPostIdx(null)} className="text-white text-2xl hover:opacity-70">✕</button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPostIdx(i => i! > 0 ? i! - 1 : null)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition"
            >
              ‹
            </button>
            <div className="w-full max-w-[390px]">
              {allUserPosts[postIdx].video ? (
                <video src={allUserPosts[postIdx].video} controls playsInline className="w-full aspect-square object-cover bg-black rounded-xl" poster={allUserPosts[postIdx].img} />
              ) : (
                <img src={allUserPosts[postIdx].img} alt="" className="w-full aspect-square object-cover rounded-xl" />
              )}
              <p className="text-sm mt-3 px-2 text-white"><span className="font-semibold">{user.username}</span> {allUserPosts[postIdx].caption}</p>
            </div>
            <button
              onClick={() => setPostIdx(i => i! < allUserPosts.length - 1 ? i! + 1 : null)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition"
            >
              ›
            </button>
          </div>
          <p className="text-xs text-neutral-400 text-center py-2">Tap outside to close • {postIdx + 1}/{allUserPosts.length}</p>
        </div>
      )}
    </div>
  )
}
