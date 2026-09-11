import { useState, useMemo, useRef } from 'react'
const FILTERS=['Original','Clarendon','Juno','Aden','Lark','Moody','Valencia','Perpetua','Willow','Gingham']
const STICKERS=['🙏','🔥','❤️','🎵','🎤','📍','📷','✝️','🕊️','💜']
export default function PostCreate({onDone,onSubmit}:{onDone:()=>void;onSubmit?:(type:string,data:any)=>void}){
 const [caption,setCaption]=useState('')
 const [type,setType]=useState<'post'|'story'|'reel'>('post')
 const [fileUrl,setFileUrl]=useState<string|null>(null)
 const [fileName,setFileName]=useState<string|null>(null)
 const [filter,setFilter]=useState('Original')
 const [textOverlay,setTextOverlay]=useState('')
 const [stickers,setStickers]=useState<string[]>([])
 const [hashtags,setHashtags]=useState('')
 const [location,setLocation]=useState('')
 const [tagUsers,setTagUsers]=useState<string[]>([])
 const [showFilters,setShowFilters]=useState(false)
 const [showStickers,setShowStickers]=useState(false)
 const [showMusic,setShowMusic]=useState(false)
 const [musicQuery,setMusicQuery]=useState('')
 const [musicResults,setMusicResults]=useState<any[]>([])
 const [musicLoading,setMusicLoading]=useState(false)
 const [musicTrack,setMusicTrack]=useState<any|null>(null)
 const [previewId,setPreviewId]=useState<any>(null)
 const [textColor,setTextColor]=useState('#ffffff')
 const [textBold,setTextBold]=useState(false)
 const [scheduled,setScheduled]=useState(false)
 const previewRef=useRef<HTMLAudioElement|null>(null)
 const fileInputRef=useRef<HTMLInputElement>(null)
 const getUser=()=>{try{return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0]?.username||localStorage.getItem('harvest_username')||'allan'}catch{return 'allan'}}
 const users:any[]=(():any=>{try{return JSON.parse(localStorage.getItem('harvest_users')||'[]')}catch{return []}})()
 const isVerified=useMemo(()=>{const me=getUser();const u=users.find((x:any)=>x.username===me);return !!u?.verified},[users])
 const onFile=(e:any)=>{const f=e.target.files?.[0];if(!f)return;setFileName(f.name);const r=new FileReader();r.onload=()=>setFileUrl(r.result as string);r.readAsDataURL(f)}
 const addSticker=(s:string)=>{if(!stickers.includes(s))setStickers([...stickers,s])}
 const removeSticker=(s:string)=>setStickers(stickers.filter(x=>x!==s))
 const applyFilter=(imgUrl:string,f:string)=>{if(f==='Original')return;const c=document.createElement('canvas');const ctx=c.getContext('2d');if(!ctx)return;const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{const MAX=1080;let w=img.width,h=img.height;if(w>MAX||h>MAX){const s=Math.min(MAX/w,MAX/h);w=Math.round(w*s);h=Math.round(h*s)}c.width=w;c.height=h;ctx.filter=f==='Clarendon'?'saturate(1.2) contrast(1.1) brightness(1.05)':f==='Juno'?'saturate(1.4) contrast(1.15) brightness(1.1)':f==='Aden'?'saturate(1.3) contrast(1.0) brightness(0.95)':f==='Lark'?'saturate(0.9) contrast(1.0) brightness(1.1)':f==='Moody'?'saturate(0.8) contrast(1.3) brightness(0.85)':f==='Valencia'?'saturate(1.5) contrast(1.1) brightness(1.1)':f==='Perpetua'?'saturate(1.1) contrast(1.2) brightness(1.15)':f==='Willow'?'saturate(0.7) contrast(1.15) brightness(1.1)':f==='Gingham'?'saturate(1.3) contrast(1.2) brightness(1.1)':'';ctx.drawImage(img,0,0,w,h);setFileUrl(c.toDataURL('image/jpeg',0.85))};img.src=imgUrl}
 const searchMusic=async(term:string)=>{
  if(!term.trim()){setMusicResults([]);return}
  setMusicLoading(true)
  try{const r=await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=10`);const j=await r.json();const res=j.results.map((x:any)=>({id:x.trackId,title:x.trackName,artist:x.artistName,cover:x.artworkUrl100?.replace('100x100','200x200'),url:x.previewUrl,link:`https://music.apple.com/track/${x.trackId}`}));setMusicResults(res)}catch{setMusicResults([])}
  setMusicLoading(false)
 }
 const togglePreview=(m:any)=>{
  if(previewId===m.id){previewRef.current?.pause();setPreviewId(null);return}
  if(previewRef.current) previewRef.current.pause()
  const a=new Audio(m.url);a.play().catch(()=>{});(previewRef as any).current=a;setPreviewId(m.id);a.onended=()=>setPreviewId(null)
 }
 const chooseMusic=(m:any)=>{setMusicTrack(m);setShowMusic(false);setMusicQuery('');setMusicResults([])}
 const schedulePost=()=>{
  if(!isVerified){alert('Only verified accounts can schedule');return}
  setScheduled(true);alert('Post scheduled! Admin will publish at selected time');onDone()
 }
 const submit=()=>{
  if(!isVerified){alert('Only verified accounts can post — ask Allan (admin) to verify you');return}
  let img=fileUrl||`https://picsum.photos/400/400?random=${Date.now()%100}`
  if(filter && filter!=='Original') applyFilter(img,filter)
  if(type==='story'){
   const story={id:`${getUser()}_${Date.now()}`,name:getUser(),caption:caption||'Harvest testimony 🙏',img,textOverlay,stickers,music:musicTrack,filter,at:new Date().toISOString(),hashtag:hashtags}
   const approved=JSON.parse(localStorage.getItem('harvest_approved_stories')||'[]')
   localStorage.setItem('harvest_approved_stories',JSON.stringify([story,...approved]));window.dispatchEvent(new Event('harvest:approved'));alert('Story posted instantly ✓');onDone();return
  }
  const postData={user:getUser(),caption:caption||'Harvest testimony 🙏',img,video:type==='reel'?'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4':undefined,hashtags,location,tagUsers,filter,textOverlay,stickers,music:musicTrack,type:type==='reel'?'reel':'post'}
  if(scheduled){
   const queued=JSON.parse(localStorage.getItem('harvest_scheduled')||'[]')
   queued.push({...postData,scheduledAt:new Date(Date.now()+3600000).toISOString(),status:'scheduled'})
   localStorage.setItem('harvest_scheduled',JSON.stringify(queued));alert('Post scheduled for later ✓');onDone();return
  }
  if(onSubmit){onSubmit(type,postData);onDone();return}
  const pending=JSON.parse(localStorage.getItem('harvest_pending')||'[]')
  const item={id:Date.now(),type,...postData,at:new Date().toISOString(),status:'pending'}
  localStorage.setItem('harvest_pending',JSON.stringify([item,...pending]));alert(type==='reel'?'Reel submitted — admin will approve':'Feed post submitted — admin will approve');onDone()
 }
 return(
 <div className="bg-zinc-50 text-white min-h-[calc(100vh-49px)] flex flex-col">
  <div className="flex justify-between items-center px-4 h-[56px] border-b border-zinc-200 bg-white">
   <button onClick={onDone} className="text-xl text-zinc-700">‹</button>
   <p className="font-semibold text-sm text-zinc-900">{type==='story'?'Story':type==='reel'?'Create Reel':'New Post'}</p>
   <button onClick={submit} className="text-[#0095f6] font-semibold text-sm">{type==='story'?'Share':type==='reel'?'Share Reel':'Post'}</button>
  </div>
  <div className="flex gap-1 px-4 pt-2 bg-white border-b border-zinc-200">{(['post','story','reel'] as const).map(t=><button key={t} onClick={()=>{setType(t);setFilter('Original');setStickers([]);setTextOverlay('');setMusicTrack(null)}} className={`px-4 py-2 rounded-full text-xs font-semibold ${type===t?'bg-[#0095f6] text-white':'bg-zinc-100 text-zinc-700'}`}>{t==='post'?'Feed':t==='story'?'Story':'Reel'}</button>)}</div>
  <div className="mt-3 px-4 flex justify-center">{!fileUrl?(<label className="w-full max-w-[360px] aspect-[4/5] bg-white rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center cursor-pointer hover:border-[#0095f6] transition"><input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onFile} className="hidden"/><div className="w-16 h-16 rounded-full bg-[#0095f6] flex items-center justify-center text-3xl text-white">＋</div><p className="text-xs text-zinc-600 mt-2">{type==='reel'?'Add video for reel':type==='story'?'Add story photo':'Add photos (up to 10)'}</p></label>):(<div className="relative w-full max-w-[360px] aspect-[4/5] mx-auto rounded-xl overflow-hidden border border-zinc-200 shadow-lg bg-white"><img src={fileUrl} alt="" className="w-full h-full object-cover object-center"/>{filter!=='Original'&&<span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full max-w-[40%] truncate">🎨 {filter}</span>}{fileName&&<span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full max-w-[45%] truncate">📎 {fileName}</span>}{musicTrack&&<span className="absolute bottom-2 left-2 right-10 bg-black/70 text-white text-[10px] px-2 py-1 rounded-full truncate">🎵 {musicTrack.title} • {musicTrack.artist}</span>}<button onClick={()=>{setFileUrl(null);setFileName(null);setFilter('Original')}} className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center text-xs">✕</button></div>)}</div>
  {fileUrl&&<div className="mt-2 px-4 bg-white rounded-xl p-2 border border-zinc-200"><button onClick={()=>{setShowFilters(!showFilters);setShowStickers(false);setShowMusic(false)}} className="text-xs text-[#0095f6] mb-1 font-semibold">🎨 Filters: {filter}</button>{showFilters&&<div className="flex gap-2 overflow-x-auto pb-2 mt-1">{FILTERS.map(f=><button key={f} onClick={()=>{setFilter(f);applyFilter(fileUrl,f);setShowFilters(false)}} className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${filter===f?'bg-[#0095f6] text-white':'bg-zinc-100 text-zinc-700'}`}>{f}</button>)}</div>}</div>}
  {fileUrl&&<div className="mt-1 px-4 bg-white rounded-xl p-2 border border-zinc-200"><button onClick={()=>{setShowStickers(!showStickers);setShowFilters(false);setShowMusic(false)}} className="text-xs text-[#0095f6] mb-1 font-semibold">📷 Stickers: {stickers.length>0?stickers.join(' '):'none'}</button>{showStickers&&<div className="flex gap-2 overflow-x-auto pb-2 flex-wrap">{STICKERS.map(s=><button key={s} onClick={()=>stickers.includes(s)?removeSticker(s):addSticker(s)} className={`text-xl px-2 py-1 rounded-full ${stickers.includes(s)?'bg-[#0095f6] text-white':'bg-zinc-100 text-zinc-700'}`}>{s}</button>)}</div>}</div>}
  {fileUrl&&<div className="mt-1 px-4 bg-white rounded-xl p-2 border border-zinc-200"><button onClick={()=>{setShowMusic(!showMusic);setShowFilters(false);setShowStickers(false)}} className="text-xs text-[#0095f6] font-semibold">🎵 Music {musicTrack?`• ${musicTrack.title} ✓`:''}</button>
   {musicTrack&&<div className="flex gap-2 items-center mt-2 p-2 bg-zinc-50 rounded-lg"><img src={musicTrack.cover} alt="" className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{musicTrack.title}</p><p className="text-[11px] text-zinc-400 truncate">{musicTrack.artist}</p></div><button onClick={()=>togglePreview(musicTrack)} className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-xs">{previewId===musicTrack.id?'⏸':'▶'}</button><button onClick={()=>setMusicTrack(null)} className="text-xs text-red-400">✕</button></div>}
   {showMusic&&<div className="mt-2">
    <div className="flex gap-2"><input value={musicQuery} onChange={e=>{setMusicQuery(e.target.value);searchMusic(e.target.value)}} onKeyDown={e=>e.key==='Enter'&&searchMusic(musicQuery)} placeholder="Search songs 🎵 Hillsong, Maverick..." className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-3 py-2 text-xs outline-none"/><button onClick={()=>searchMusic(musicQuery)} className="px-3 py-2 rounded-full bg-[#0095f6] text-white text-xs font-semibold">Search</button></div>
    {musicLoading&&<p className="text-xs text-zinc-500 text-center py-2">Searching…</p>}
    {!musicLoading&&musicResults.length===0&&musicQuery&&<p className="text-xs text-zinc-500 text-center py-2">No results — try Hillsong/Maverick/Sinach</p>}
    {!musicLoading&&musicResults.length===0&&!musicQuery&&<div className="flex gap-2 flex-wrap mt-2">{['Hillsong','Maverick','Sinach','Elevation','Harvest'].map(t=><button key={t} onClick={()=>{setMusicQuery(t);searchMusic(t)}} className="px-3 py-1 rounded-full bg-zinc-100 text-xs">{t}</button>)}</div>}
    <div className="space-y-2 mt-2 max-h-48 overflow-auto">{musicResults.map((m:any)=><div key={m.id} className="flex gap-2 p-2 bg-zinc-50 rounded-lg items-center"><img src={m.cover} alt="" className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{m.title}</p><p className="text-[11px] text-zinc-400 truncate">{m.artist}</p></div><button onClick={()=>togglePreview(m)} className="w-7 h-7 rounded-full bg-zinc-200 flex items-center justify-center text-xs">{previewId===m.id?'⏸':'▶'}</button><button onClick={()=>chooseMusic(m)} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Use</button></div>)}</div>
   </div>}
  </div>}
  {fileUrl&&<div className="mt-1 px-4 bg-white rounded-xl border border-zinc-200 p-2"><p className="text-xs text-[#0095f6] mb-1 font-semibold">✏️ Rich text caption</p><input value={textOverlay} onChange={e=>setTextOverlay(e.target.value)} placeholder="Bold text..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"/><div className="flex gap-2 mt-1 items-center"><span className="text-xs text-zinc-400">Color:</span>{['#ffffff','#0095f6','#ed4956','#f77737','#40d657','#b546cf','#000000'].map(c=> <button key={c} onClick={()=>setTextColor(c)} className="w-6 h-6 rounded-full border-2 border-white shadow-sm" style={{backgroundColor:c}}/>)}<button onClick={()=>setTextBold(!textBold)} className={`ml-2 px-2 py-1 rounded-full text-xs font-bold ${textBold?'bg-[#0095f6] text-white':'bg-zinc-200 text-zinc-600'}`}>B:{textBold?'on':'off'}</button></div></div>}
  {type==='post'&&<><div className="mt-3 px-4"><input value={hashtags} onChange={e=>setHashtags(e.target.value)} placeholder="#harvest #church #nyeri..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none"/></div><div className="mt-2 px-4"><input value={location} onChange={e=>setLocation(e.target.value)} placeholder="📍 Add location..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none"/></div><div className="mt-2 px-4"><input value={tagUsers.join(', ')} onChange={e=>setTagUsers(e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Tag friends..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none"/></div></>}
  <div className="mt-2 px-4"><input value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Write a caption..." className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm outline-none"/></div>
  {!isVerified&&<p className="text-xs text-amber-400 mt-2 text-center">🔒 Verified only — ask Allan to verify</p>}{isVerified&&type==='story'&&<p className="text-xs text-green-400 mt-1 text-center">✓ Story posted instantly + music linked</p>}
  {isVerified&&type!=='story'&&<button onClick={schedulePost} className="mt-2 mx-4 px-4 py-2 rounded-full bg-[#7C3AED] text-white text-xs font-bold">{scheduled?'✓ Scheduled':'⏰ Schedule Post'}</button>}
 </div>
 )}
