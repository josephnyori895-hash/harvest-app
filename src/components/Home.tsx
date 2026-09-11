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

export default function Home({ setTab, users, onDeleteStory, refreshKey, onSwitchAccount }: { setTab: (t: string) => void; users: any[]; onDeleteStory?: (id: string) => void; refreshKey?: number; onSwitchAccount?: ()=>void }) {
  const [storyIdx, setStoryIdx] = useState<number | null>(null)
  const [editingPost, setEditingPost] = useState<any | null>(null)
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
    if(refreshKey>0){ setRefreshing(true); setApprovedStoriesTick(x=>x+1); setLikesTick(x=>x+1); containerRef.current?.scrollTo({top:0, behavior:'smooth'}); setTimeout(()=> setRefreshing(false), 700) }
  }, [refreshKey])
  const approvedPosts: any[] = (() => { try { return JSON.parse(localStorage.getItem('harvest_approved_posts') || '[]') } catch { return [] } })()
  const allStories = useMemo(() => [...storiesBase, ...approvedStories.map((s:any) => ({ ...s, name: typeof s.name === 'string' ? s.name : 'Harvest' }))], [approvedStories])
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
    <div ref={containerRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="bg-black text-white h-[calc(100vh-49px)] overflow-auto">
      {refreshing&&<div className="py-2 text-center text-xs text-zinc-400">Refreshing…</div>}
      {storyIdx!==null&&<StoryViewer idx={storyIdx} setIdx={setStoryIdx} allStories={allStories} users={users||[]} />}
      {editingPost&&<PostEditor post={editingPost} onDone={()=>setEditingPost(null)} />}
      <div className="flex items-center justify-between px-4 h-[60px] border-b border-zinc-800 sticky top-0 bg-black z-10"><button onClick={()=>onSwitchAccount&&onSwitchAccount()} className="flex items-center gap-1"><h1 className="text-[24px] font-normal" style={{fontFamily:'cursive'}}>Harvest</h1><span className="text-xs">⌄</span></button><div className="flex gap-4 items-center"><button onClick={()=>setTab('activity')} aria-label="activity">♡</button><button onClick={()=>setTab('chat')} aria-label="chat">➤</button>{isAdmin&&<button onClick={clearCache} className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full">🗑️</button>}</div></div>
      <div className="flex gap-3 px-3 py-3 overflow-x-auto scrollbar-none border-b border-zinc-800">{allStories.map((s:any,i:number)=>{const isOwn=!s.me&&(s.name===currentUser||String(s.id).startsWith(currentUser+'_'));return <div key={s.name+i} className="flex flex-col items-center min-w-[66px] relative"><button onClick={()=>s.me?setTab('post'):setStoryIdx(i)} className="flex flex-col items-center"><div className={`w-[66px] h-[66px] rounded-full p-[2px] ${s.me?'bg-zinc-700':'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600'}`}><div className="w-full h-full rounded-full bg-black border-[2px] border-black flex items-center justify-center overflow-hidden text-xs font-bold">{s.me?'＋':s.name.slice(0,2)}</div></div><p className="text-[11px] mt-1 text-white truncate w-[66px] text-center">{s.name}</p></button>{onDeleteStory&&(()=>{const hasRealId=approvedStories.some((x:any)=>x.id===s.id);return hasRealId||s.me})()&&<button onClick={e=>{e.stopPropagation();if(s.me){const approved=JSON.parse(localStorage.getItem('harvest_approved_stories')||'[]');const filtered=approved.filter((x:any)=>x.id!==s.id);localStorage.setItem('harvest_approved_stories',JSON.stringify(filtered));window.dispatchEvent(new Event('harvest:approved'));alert('Story deleted ✓')}else if(confirm(`Delete story ${s.name}?`))onDeleteStory(s.id)}} className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center text-[10px] text-white">✕</button>}</div>})}</div>
      {allPosts.map((p:any,i:number)=>{const key=`post_${p.user}_${p.img?.slice(-8)??i}_${i}`;const liked=!!likesTable[key];const displayLikes=p.likes+(liked?1:0);return <div key={p.user+i} className="border-b border-zinc-800"><div className="flex items-center justify-between px-3 py-3"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[10px] font-bold border border-black">{p.user[0].toUpperCase()}</div></div><div><div className="flex items-center gap-1"><span className="text-[13px] font-semibold">{p.user}</span>{isVerified(p.user,p.verified)&&<span className="w-3 h-3 rounded-full bg-[#0095f6] flex items-center justify-center text-[8px] text-white">✓</span>}<span className="text-zinc-500 text-[13px]">• {p.time}</span></div><p className="text-[12px] text-white -mt-0.5">{p.loc}</p></div></div><div className="relative"><button onClick={e=>{e.stopPropagation();setMenuPost(menuPost===key?null:key)}} className="text-white text-lg px-1">⋯</button>{menuPost===key&&isAdmin&&<div className="absolute right-0 top-6 bg-zinc-900 border border-zinc-700 rounded-xl p-2 z-20 min-w-[140px] shadow-xl"><button onClick={e=>{e.stopPropagation();setEditingPost(p);setMenuPost(null)}} className="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-800">✏️ Edit</button><button onClick={e=>{e.stopPropagation();if(confirm('Delete this post permanently?')){localStorage.setItem('harvest_pending',JSON.stringify((JSON.parse(localStorage.getItem('harvest_pending')||'[]')).filter(x=>x.id!==parseInt(key.split('_').pop()||'0'))));alert('Post deleted')}setMenuPost(null)}} className="block w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800">🗑️ Delete</button><button onClick={e=>{e.stopPropagation();alert('Manage post visibility')}} className="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-800">📋 Manage</button></div>}</div></div>{p.video?<video src={p.video} controls playsInline className="w-full aspect-square object-cover bg-zinc-900" poster={p.img}/>:<img src={p.img} alt="" className="w-full aspect-square object-cover bg-zinc-900"/>}<div className="px-3 pt-3 pb-2"><div className="flex justify-between"><div className="flex gap-4"><button onClick={()=>toggleLike(key)} aria-label="like"><svg width="24" height="24" viewBox="0 0 24 24" fill={liked?'#ed4956':'none'} stroke={liked?'#ed4956':'white'} strokeWidth="1.7"><path d="M12 21s-6-4-6-10a6 6 0 0 1 11 .5A6 6 0 0 1 18 11c0 6-10 10-6 10z"/></svg></button><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7"><path d="M19 21l-7-3-7 3V5a2 2 0 0 1 2 2h10v16z"/></svg></div><p className="text-[14px] font-semibold mt-3">{displayLikes.toLocaleString()} likes</p><p className="text-[14px] leading-[18px] mt-1"><span className="font-semibold">{p.user}</span> {p.caption}</p>{p.music&&<div className="flex gap-2 items-center mt-2 p-2 bg-zinc-900 rounded-lg border border-zinc-800"><img src={p.music.cover} alt="" className="w-8 h-8 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">🎵 {p.music.title}</p><p className="text-[11px] text-zinc-400 truncate">{p.music.artist}</p></div><a href={p.music.url} target="_blank" className="text-xs bg-white text-black px-2 py-1 rounded-full">▶ Preview</a></div>}</div></div>})}
    </div>
  )
}
