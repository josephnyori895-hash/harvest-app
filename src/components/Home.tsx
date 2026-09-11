import { useState, useMemo, useEffect, useRef } from 'react'
import { getLikesTable, toggleLikeKey } from '../state/auth'
import StoryViewer from './Stories'
import { showToast } from './Toast'

const storiesBase = [
  { name: 'Your story', me: true },
  { name: 'Pst. David', id: 'pd' },
  { name: 'Grace', id: 'gr' },
  { name: 'Youth', id: 'yh' },
  { name: 'Worship', id: 'wp' },
  { name: 'Missions', id: 'ms' },
  { name: 'Events', id: 'ev' },
]

const postsBase = [
  { user: 'allan', verified: true, loc: 'Nyeri • Main Sanctuary', time: '2h', likes: 1243, img: 'https://images.unsplash.com/photo-1507692049790-de582271b65a?w=800&h=1000&fit=crop&q=80', video: null, caption: 'Morning praise session 🙏', comments: 42 },
  { user: 'pst.simon', verified: false, loc: 'Chapel', time: '5h', likes: 892, img: 'https://images.unsplash.com/photo-1519491050282-af549c18a3f1?w=800&h=600&fit=crop&q=80', caption: 'Midweek prayer meeting', comments: 18 },
  { user: 'youth_harvest', verified: true, loc: 'Youth Hall', time: '1d', likes: 2014, img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=800&fit=crop&q=80', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', caption: 'Youth conference recap 🎉', comments: 125 },
]

export default function Home({ setTab, users, onDeleteStory, refreshKey, onSwitchAccount }: { setTab: (t: string) => void; users: any[]; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: () => void }) {
  const [storyIdx, setStoryIdx] = useState<number | null>(null)
  const [likesTick, setLikesTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef<number|null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [approvedStoriesTick, setApprovedStoriesTick] = useState(0)
  const approvedStories: any[] = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('harvest_approved_stories') || '[]') } catch { return [] }
  }, [likesTick, approvedStoriesTick])
  
  useEffect(() => {
    const bump = () => setApprovedStoriesTick(x => x + 1)
    window.addEventListener('storage', bump)
    window.addEventListener('harvest:approved' as any, bump)
    window.addEventListener('harvest:verified' as any, bump)
    const iv = setInterval(bump, 800)
    return () => { window.removeEventListener('storage', bump); window.removeEventListener('harvest:approved' as any, bump); window.removeEventListener('harvest:verified' as any, bump); clearInterval(iv) }
  }, [])
  
  useEffect(()=>{
    if(refreshKey===undefined) return
    if(refreshKey>0){
      setRefreshing(true)
      setApprovedStoriesTick(x=>x+1)
      setLikesTick(x=>x+1)
      containerRef.current?.scrollTo({top:0, behavior:'smooth'})
      showToast('Feed refreshed ✓', 'success', 1500)
      setTimeout(()=> setRefreshing(false), 700)
    }
  }, [refreshKey])
  
  const approvedPosts: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('harvest_approved_posts') || '[]') } catch { return [] }
  })()

  const allStories = useMemo(() => [...storiesBase, ...approvedStories.map((s: any) => ({ name: s.name, id: s.id }))], [approvedStories])
  const allPosts = useMemo(() => [...approvedPosts, ...postsBase], [approvedPosts])

  const verifiedMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    users.forEach((u: any) => { m[u.username] = !!u.verified })
    return m
  }, [users])
  
  const likesTable = getLikesTable()
  const toggleLike = (key: string) => {
    toggleLikeKey(key)
    setLikesTick(x => x + 1)
    showToast('Liked ❤️', 'success', 1000)
  }

  const currentUser = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0]?.username || localStorage.getItem('harvest_username')||'' }catch{return ''}})();
  const isAdmin = (()=>{ try{ return localStorage.getItem('harvest_role')==='admin' || currentUser==='allan'}catch{return false}})();
  const [menuPost, setMenuPost] = useState<string|null>(null)
  const clearCache = () => {
    localStorage.removeItem('harvest_pending')
    localStorage.removeItem('harvest_approved_posts')
    localStorage.removeItem('harvest_approved_stories')
    localStorage.removeItem('harvest_scheduled')
    localStorage.removeItem('harvest_cache')
    window.dispatchEvent(new Event('harvest:cache-clear'))
    showToast('Cache cleared ✓', 'success')
  }
  
  useEffect(()=>{
    const handler = ()=>setMenuPost(null)
    if(menuPost){window.addEventListener('click',handler,{once:true})}
    return ()=>{}
  },[menuPost])

  const onTouchStart = (e:any) => { startYRef.current = e.touches[0].clientY }
  const onTouchMove = (e:any) => {
    if(startYRef.current===null) return
    const dy = e.touches[0].clientY - (startYRef.current||0)
    if(dy>70 && containerRef.current && containerRef.current.scrollTop===0 && !refreshing){
      // will trigger on touch end
    }
  }
  const onTouchEnd = (e:any) => {
    if(startYRef.current===null) return
    const dy = (e.changedTouches[0].clientY - startYRef.current)
    startYRef.current=null
    if(dy>80 && containerRef.current && containerRef.current.scrollTop<5){
      setRefreshing(true)
      setApprovedStoriesTick(x=>x+1)
      setLikesTick(x=>x+1)
      setTimeout(()=> setRefreshing(false), 800)
    }
  }
  
  return (
    <div ref={containerRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="bg-gradient-church text-white h-[calc(100vh-49px)] overflow-auto">
      {refreshing && <div className="py-3 text-center text-sm text-purple-300 font-semibold">✓ Refreshing…</div>}
      {storyIdx !== null && <StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allStories} />}
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[60px] border-b border-purple-700/20 sticky top-0 bg-gradient-church z-10 backdrop-blur-sm">
        <button onClick={()=>onSwitchAccount&&onSwitchAccount()} className="flex items-center gap-1">
          <h1 className="text-[24px] font-extrabold bg-gradient-to-r from-yellow-300 to-pink-400 bg-clip-text text-transparent" style={{ fontFamily: 'cursive' }}>Harvest</h1>
          <span className="text-xs text-purple-300">⌄</span>
        </button>
        <div className="flex gap-4 items-center">
          <button onClick={() => setTab('activity')} aria-label="activity" className="hover:text-purple-300 transition"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 21s-6-4-6-10a6 6 0 0 1 12 0c0 6-6 10-6 10z" /></svg></button>
          <button onClick={() => setTab('chat')} aria-label="chat" className="hover:text-purple-300 transition"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M22 2L11 13M22 2l-7 20-4-9-9 4" /></svg></button>
          {isAdmin&&<button onClick={clearCache} className="text-[10px] bg-purple-700/40 text-purple-200 px-2 py-1 rounded-full font-bold hover:bg-purple-600/60 transition" title="Clear cache">🗑️</button>}
        </div>
      </div>

      {/* Stories Strip */}
      <div className="flex gap-3 px-3 py-3 overflow-x-auto scrollbar-none border-b border-purple-700/20 bg-black/40">
        {allStories.map((s: any, i: number) => {
          const isOwn = !s.me && (s.name===currentUser || String(s.id).startsWith(currentUser+'_'))
          return (
            <div key={s.name + i} className="flex flex-col items-center min-w-[66px] relative">
              <button onClick={() => s.me ? setTab('post') : setStoryIdx(i)} className="flex flex-col items-center group">
                <div className={`w-[66px] h-[66px] rounded-full p-[2px] ${s.me ? 'bg-gradient-to-br from-purple-600 to-pink-600' : 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600'}`}>
                  <div className="w-full h-full rounded-full bg-black border-[2px] border-black flex items-center justify-center overflow-hidden text-xs font-bold group-hover:scale-105 transition">{s.me ? '＋' : s.name.slice(0, 2).toUpperCase()}</div>
                </div>
                <p className="text-[11px] mt-1 text-white truncate w-[66px] text-center font-medium">{s.name}</p>
              </button>
              {onDeleteStory && (()=>{ const hasRealId = approvedStories.some((x:any)=>x.id === s.id); return hasRealId || s.me })() && (
                <button onClick={(e)=>{ e.stopPropagation(); if(s.me){ const approved = JSON.parse(localStorage.getItem('harvest_approved_stories')||'[]'); const filtered = approved.filter((x:any)=>x.id !== s.id); localStorage.setItem('harvest_approved_stories',JSON.stringify(filtered)); window.dispatchEvent(new Event('harvest:approved')); } else { onDeleteStory(s.id) } }} className="text-[11px] text-red-400 hover:text-red-300 font-bold">✕</button>
              )}
            </div>
          )
        })}
      </div>

      {/* Feed Posts */}
      {allPosts.map((p: any, i: number) => {
        const key = `post_${p.user}_${p.img?.slice(-8) ?? i}_${i}`
        const liked = !!likesTable[key]
        const displayLikes = p.likes + (liked ? 1 : 0)
        return (
          <div key={p.user + i} className="border-b border-purple-700/10 hover:bg-black/30 transition">
            {/* Post Header */}
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]">
                  <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold">{p.user[0].toUpperCase()}</div>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-1">{p.user} {p.verified && <span className="text-xs bg-green-500/40 text-green-300 px-1.5 py-0.5 rounded-full">✓</span>}</p>
                  <p className="text-[11px] text-purple-300/70">{p.loc} • {p.time}</p>
                </div>
              </div>
              <div className="relative">
                <button onClick={(e)=>{e.stopPropagation();setMenuPost(menuPost===key?null:key)}} className="text-white text-lg px-1 hover:text-purple-300 transition">⋯</button>
                {menuPost===key && isAdmin && (
                  <div className="absolute right-0 top-6 bg-slate-900/95 border border-purple-700/40 rounded-xl p-2 z-20 min-w-[140px] shadow-2xl backdrop-blur-sm">
                    <button onClick={(e)=>{e.stopPropagation();showToast('Edit post feature coming soon!', 'info')}} className="block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-purple-700/30 transition">✏️ Edit</button>
                    <button onClick={(e)=>{e.stopPropagation();if(confirm('Delete this post permanently?')){localStorage.setItem('harvest_pending',JSON.stringify((JSON.parse(localStorage.getItem('harvest_pending')||'[]')).filter((x:any)=>x.id!==i)));window.dispatchEvent(new Event('harvest:approved'));showToast('Post deleted', 'success')}}} className="block w-full text-left px-3 py-2 text-sm text-red-400 rounded-lg hover:bg-red-900/20 transition">🗑️ Delete</button>
                    <button onClick={(e)=>{e.stopPropagation();showToast('Visibility updated', 'success')}} className="block w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-purple-700/30 transition">👁️ Visibility</button>
                  </div>
                )}
              </div>
            </div>
            
            {/* Post Media */}
            {p.video ? (
              <video src={p.video} controls playsInline className="w-full aspect-square object-cover bg-black" poster={p.img} />
            ) : (
              <img src={p.img} alt="" className="w-full aspect-square object-cover" />
            )}
            
            {/* Post Actions */}
            <div className="px-3 pt-3 pb-2">
              <div className="flex justify-between">
                <div className="flex gap-4">
                  <button onClick={() => toggleLike(key)} aria-label="like" className="hover:text-pink-400 transition">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className={liked ? 'text-pink-500' : 'text-white'}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  </button>
                  <button aria-label="comment" className="hover:text-purple-400 transition">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  </button>
                  <button aria-label="share" className="hover:text-cyan-400 transition">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M12 2v10M7 7l5-5 5 5" /></svg>
                  </button>
                </div>
                <button aria-label="save" className="hover:text-amber-400 transition">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /></svg>
                </button>
              </div>
              <p className="text-[14px] font-semibold mt-3 text-purple-200">{displayLikes.toLocaleString()} likes</p>
              <p className="text-[14px] leading-[18px] mt-1 text-gray-100"><span className="font-semibold text-white">{p.user}</span> {p.caption}</p>
              {p.comments > 0 && <p className="text-[12px] text-purple-300/70 mt-1 cursor-pointer hover:text-purple-300">View all {p.comments} comments</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
