import { useState, useMemo, useEffect, useRef } from 'react'
import { getLikesTable, toggleLikeKey } from '../state/auth'
import StoryViewer from './Stories'
import PostEditor from './PostEditor'

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
  { user: 'allan', verified: true, loc: 'Nyeri • Main Sanctuary', time: '2h', likes: 1243, img: 'https://images.unsplash.com/photo-1507692049790-de582271b65a?w=800&h=1000&fit=crop&q=80', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', caption: 'Compelled by Love — Sunday was 🔥 Full sermon on YouTube. [VIDEO]', comments: 128 },
  { user: 'pst.simon', verified: false, loc: 'Chapel', time: '5h', likes: 892, img: 'https://images.unsplash.com/photo-1519491050282-af549c18a3f1?w=800&h=600&fit=crop&q=80', caption: 'Midweek prayers tonight 6PM — bring a friend. 🙏', comments: 42 },
  { user: 'youth_harvest', verified: true, loc: 'Youth Hall', time: '1d', likes: 2014, img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=800&fit=crop&q=80', video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', caption: 'Raised for purpose 💜 Youth gathered! [VIDEO]', comments: 67 },
]

function FeedIcon({ type, active = false }: { type: 'heart' | 'share' | 'save' | 'comment'; active?: boolean }) {
  const stroke = active ? '#d9465f' : 'currentColor'
  if (type === 'heart') return <svg width="23" height="23" viewBox="0 0 24 24" fill={active ? stroke : 'none'} stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 8.9c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10a4.7 4.7 0 0 1 8.8-2.3A4.7 4.7 0 0 1 20.8 8.9Z" /></svg>
  if (type === 'share') return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
  if (type === 'save') return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.8A1.8 1.8 0 0 1 7.8 2h8.4A1.8 1.8 0 0 1 18 3.8V22l-6-3.6L6 22Z" /></svg>
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.7 7.5 8.4 8.4 0 0 1-4.1-1L4 19l1.1-3.7a7.2 7.2 0 0 1-1.3-4.1A7.5 7.5 0 0 1 11.5 4 8.2 8.2 0 0 1 20 11.5Z" /></svg>
}

export default function Home({ setTab, users, onDeleteStory, refreshKey, onSwitchAccount }: { setTab: (t: string) => void; users: any[]; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: ()=>void }) {
  const [storyIdx, setStoryIdx] = useState<number | null>(null)
  const [editingPost, setEditingPost] = useState<any | null>(null)
  const [likesTick, setLikesTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startYRef = useRef<number|null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [approvedStoriesTick, setApprovedStoriesTick] = useState(0)
  const approvedStories: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('harvest_approved_stories') || '[]') } catch { return [] }
  })()
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
      const timer = setTimeout(() => {
        setRefreshing(true)
        setApprovedStoriesTick(x=>x+1)
        setLikesTick(x=>x+1)
      }, 0)
      containerRef.current?.scrollTo({top:0, behavior:'smooth'})
      const done = setTimeout(()=> setRefreshing(false), 700)
      return () => { clearTimeout(timer); clearTimeout(done) }
    }
  }, [refreshKey])
  const approvedPosts: any[] = (() => { try { return JSON.parse(localStorage.getItem('harvest_approved_posts') || '[]') } catch { return [] } })()
  const allStories = useMemo(() => [...storiesBase, ...approvedStories.map((s:any) => ({ ...s, name: typeof s.name === 'string' ? s.name : 'Harvest' }))], [approvedStories, approvedStoriesTick])
  const allPosts = useMemo(() => [...approvedPosts, ...postsBase], [approvedPosts])
  const verifiedMap = useMemo(() => { const m:Record<string,boolean>={}; users.forEach((u:any)=>{m[u.username]=!!u.verified}); return m }, [users])
  const isVerified=(username:string,fallback?:boolean)=> username in verifiedMap ? verifiedMap[username] : !!fallback
  const likesTable=getLikesTable()
  const toggleLike=(key:string)=>{toggleLikeKey(key);setLikesTick(x=>x+1)}
  const currentUser=(()=>{try{return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0]?.username||localStorage.getItem('harvest_username')||''}catch{return ''}})()
  const isAdmin=(()=>{try{return localStorage.getItem('harvest_role')==='admin'||currentUser==='allan'}catch{return false}})()
  const [menuPost,setMenuPost]=useState<string|null>(null)
  const clearCache=()=>{localStorage.removeItem('harvest_pending');localStorage.removeItem('harvest_approved_posts');localStorage.removeItem('harvest_approved_stories');localStorage.removeItem('harvest_scheduled');localStorage.removeItem('harvest_cache');window.dispatchEvent(new Event('harvest:cache-clear'));alert('Cache cleared ✓')}
  useEffect(()=>{const handler=()=>setMenuPost(null);if(menuPost){window.addEventListener('click',handler,{once:true})}return()=>{}},[menuPost])
  const onTouchStart=(e:any)=>{startYRef.current=e.touches[0].clientY}
  const onTouchMove=(e:any)=>{if(startYRef.current===null)return;const dy=e.touches[0].clientY-startYRef.current;if(dy>70&&containerRef.current&&containerRef.current.scrollTop===0&&!refreshing){} }
  const onTouchEnd=(e:any)=>{if(startYRef.current===null)return;const dy=e.changedTouches[0].clientY-startYRef.current;startYRef.current=null;if(dy>80&&containerRef.current&&containerRef.current.scrollTop<5){setRefreshing(true);setApprovedStoriesTick(x=>x+1);setLikesTick(x=>x+1);setTimeout(()=>setRefreshing(false),800)}}
  return (
    <div ref={containerRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="bg-[#faf7f1] text-neutral-900 h-[calc(100vh-49px)] overflow-auto">
      {refreshing&&<div className="sticky top-0 z-30 py-2 text-center text-xs font-medium text-purple-700 bg-white/90 backdrop-blur border-b border-amber-100">Refreshing your harvest…</div>}
      {storyIdx!==null&&<StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allStories} users={users||[]} />}
      {editingPost&&<PostEditor post={editingPost} onDone={()=>setEditingPost(null)} />}

      <div className="sticky top-0 z-20 border-b border-amber-100/80 bg-[#faf7f1]/95 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 h-[64px]">
          <button onClick={()=>onSwitchAccount&&onSwitchAccount()} className="flex items-center gap-2 group" aria-label="Switch account">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-orange-400 to-purple-600 text-white flex items-center justify-center font-extrabold text-sm shadow-sm">HF</span>
            <span className="text-[22px] font-extrabold tracking-tight bg-gradient-to-r from-purple-700 to-amber-600 bg-clip-text text-transparent">Harvest</span>
            <span className="text-purple-600 text-xs transition-transform group-hover:translate-y-0.5">⌄</span>
          </button>
          <div className="flex gap-2 items-center">
            <button onClick={()=>setTab('activity')} aria-label="Activity" className="w-10 h-10 rounded-full bg-white border border-amber-100 shadow-sm flex items-center justify-center text-purple-900 hover:bg-purple-50 transition-colors"><FeedIcon type="heart" /></button>
            <button onClick={()=>setTab('chat')} aria-label="Chat" className="w-10 h-10 rounded-full bg-white border border-amber-100 shadow-sm flex items-center justify-center text-purple-900 hover:bg-purple-50 transition-colors"><FeedIcon type="share" /></button>
            {isAdmin&&<button onClick={clearCache} aria-label="Clear cache" className="w-8 h-8 rounded-full bg-neutral-900 text-white text-xs flex items-center justify-center shadow-sm">⌫</button>}
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto pb-10">
        <section className="px-4 pt-4 pb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-600">Harvest Family</p>
              <h2 className="text-lg font-bold text-neutral-900 mt-0.5">Stories from our family</h2>
            </div>
            <span className="text-xs font-semibold text-neutral-500">Today</span>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-none pb-1">
            {allStories.map((s:any,i:number)=> <div key={s.name+i} className="flex flex-col items-center min-w-[68px] relative">
              <button onClick={()=>s.me?setTab('post'):setStoryIdx(i)} className="flex flex-col items-center group">
                <div className={`w-[68px] h-[68px] rounded-[22px] p-[2px] shadow-sm ${s.me?'bg-neutral-200':'bg-gradient-to-tr from-amber-400 via-orange-400 to-purple-600'}`}>
                  <div className="w-full h-full rounded-[20px] bg-white border-2 border-[#faf7f1] flex items-center justify-center overflow-hidden text-xs font-bold text-purple-900">
                    {s.me?<span className="text-xl text-purple-600">＋</span>:s.name.slice(0,2).toUpperCase()}
                  </div>
                </div>
                <p className="text-[11px] mt-1.5 text-neutral-700 font-medium truncate w-[70px] text-center">{s.name}</p>
              </button>
              {onDeleteStory&&(()=>{const hasRealId=approvedStories.some((x:any)=>x.id===s.id);return hasRealId||s.me})()&&<button onClick={e=>{e.stopPropagation();if(s.me){const approved=JSON.parse(localStorage.getItem('harvest_approved_stories')||'[]');const filtered=approved.filter((x:any)=>x.id!==s.id);localStorage.setItem('harvest_approved_stories',JSON.stringify(filtered));window.dispatchEvent(new Event('harvest:approved'));alert('Story deleted ✓')}else if(confirm(`Delete story ${s.name}?`))onDeleteStory(s.id)}} aria-label={`Delete ${s.name}`} className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center text-[10px] text-white shadow">✕</button>}
            </div>)}
          </div>
        </section>

        <div className="space-y-5 px-3 sm:px-0">
          {allPosts.map((p:any,i:number)=>{
            const key=`post_${p.user}_${p.img?.slice(-8)??i}_${i}`
            const liked=!!likesTable[key]
            const displayLikes=p.likes+(liked?1:0)
            return <article key={p.user+i} className="bg-white sm:rounded-3xl border-y sm:border border-amber-100/80 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-tr from-amber-400 to-purple-600 p-[2px] shadow-sm">
                    <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-xs font-extrabold text-purple-800 border-2 border-white">{p.user[0].toUpperCase()}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap"><span className="text-[13px] font-bold text-neutral-900">{p.user}</span>{isVerified(p.user,p.verified)&&<span className="w-4 h-4 rounded-full bg-purple-600 flex items-center justify-center text-[9px] text-white font-bold">✓</span>}<span className="text-neutral-400 text-xs">• {p.time}</span></div>
                    <p className="text-[11px] text-neutral-500 truncate">{p.loc}</p>
                  </div>
                </div>
                <div className="relative">
                  <button onClick={e=>{e.stopPropagation();setMenuPost(menuPost===key?null:key)}} aria-label="Post options" className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 text-lg">⋯</button>
                  {menuPost===key&&isAdmin&&<div className="absolute right-0 top-10 bg-white border border-neutral-200 rounded-2xl p-1.5 z-20 min-w-[150px] shadow-xl">
                    <button onClick={e=>{e.stopPropagation();setEditingPost(p);setMenuPost(null)}} className="block w-full text-left px-3 py-2.5 text-sm rounded-xl hover:bg-purple-50">✏️ Edit</button>
                    <button onClick={e=>{e.stopPropagation();if(confirm('Delete this post permanently?')){localStorage.setItem('harvest_pending',JSON.stringify((JSON.parse(localStorage.getItem('harvest_pending')||'[]')).filter(x=>x.id!==parseInt(key.split('_').pop()||'0'))));alert('Post deleted')}setMenuPost(null)}} className="block w-full text-left px-3 py-2.5 text-sm rounded-xl text-red-500 hover:bg-red-50">🗑️ Delete</button>
                    <button onClick={e=>{e.stopPropagation();alert('Manage post visibility')}} className="block w-full text-left px-3 py-2.5 text-sm rounded-xl hover:bg-purple-50">📋 Manage</button>
                  </div>}
                </div>
              </div>
              <div className="relative bg-neutral-100 overflow-hidden">
                {p.video?<video src={p.video} controls playsInline className="w-full aspect-square object-cover" poster={p.img}/>:<img src={p.img} alt="" className="w-full aspect-square object-cover"/>}
                {p.video&&<span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-[10px] font-bold text-white tracking-wide">VIDEO</span>}
              </div>
              <div className="px-4 pt-3.5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button onClick={()=>toggleLike(key)} aria-label={liked?'Unlike post':'Like post'} className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90 ${liked?'text-rose-600 bg-rose-50':'text-neutral-800 hover:bg-neutral-100'}`}><FeedIcon type="heart" active={liked}/></button>
                    <button onClick={()=>alert(`Comments: ${p.comments ?? 0}`)} aria-label="Comments" className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-800 hover:bg-neutral-100"><FeedIcon type="comment" /></button>
                    <button onClick={()=>setTab('chat')} aria-label="Share post" className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-800 hover:bg-neutral-100"><FeedIcon type="share" /></button>
                  </div>
                  <button aria-label="Save post" className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-800 hover:bg-neutral-100"><FeedIcon type="save" /></button>
                </div>
                <p className="text-[13px] font-bold text-neutral-900 mt-1">{displayLikes.toLocaleString()} likes</p>
                <p className="text-[13px] leading-5 mt-1.5 text-neutral-800"><span className="font-bold text-neutral-950">{p.user}</span> {p.caption}</p>
                {p.comments>0&&<button onClick={()=>alert(`Comments: ${p.comments}`)} className="text-xs text-neutral-400 font-medium mt-2">View all {p.comments} comments</button>}
                {p.music&&<div className="flex gap-2.5 items-center mt-3 p-2.5 bg-gradient-to-r from-purple-50 to-amber-50 rounded-2xl border border-purple-100">
                  <img src={p.music.cover} alt="" className="w-9 h-9 rounded-xl object-cover"/>
                  <div className="flex-1 min-w-0"><p className="text-xs font-bold text-neutral-800 truncate">♫ {p.music.title}</p><p className="text-[11px] text-neutral-500 truncate">{p.music.artist}</p></div>
                  <a href={p.music.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold bg-purple-700 text-white px-3 py-1.5 rounded-full shadow-sm">Preview</a>
                </div>}
              </div>
            </article>
          })}
        </div>
      </main>
    </div>
  )
}
