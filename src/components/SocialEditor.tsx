import { useEffect, useState } from 'react'

import ErrorMessage from './ErrorMessage'
import { Icon } from '../ui'
const API=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')
const token=()=>localStorage.getItem('harvest_token')||''

export default function SocialEditor({ kind, id, caption: initialCaption, musicTrack, onDone }:{kind:'post'|'reel'|'story';id:string;caption:string;musicTrack?:any;onDone:(changed?:any)=>void}) {
  const [caption,setCaption]=useState(initialCaption||'')
  const [query,setQuery]=useState('')
  const [tracks,setTracks]=useState<any[]>([])
  const [selected,setSelected]=useState<any|null>(musicTrack||null)
  const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  useEffect(()=>{ if(!query.trim()){setTracks([]);return}; const t=setTimeout(()=>fetch(API+'/api/music?limit=50').then(r=>r.json()).then(d=>setTracks((d.tracks||[]).filter((x:any)=>(x.title+' '+x.artist).toLowerCase().includes(query.toLowerCase())))).catch(()=>setTracks([])),250); return()=>clearTimeout(t)},[query])
  const save=async()=>{if(busy)return;setBusy(true);try{const r=await fetch(API+'/api/'+kind+'s/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},body:JSON.stringify({caption,music_track_id:selected?.id||null})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not save changes');onDone(d)}catch(e:any){setError(e?.message||'Could not save changes')}finally{setBusy(false)}}
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/60 backdrop-blur-sm sm:items-center" onClick={()=>onDone()}>
    <div className="w-full rounded-t-[28px] bg-surface-raised p-5 sm:max-w-lg sm:rounded-[28px]" onClick={e=>e.stopPropagation()}>
      {error && <div className="mb-3"><ErrorMessage message={error} /></div>}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold capitalize">Edit {kind}</h2>
        <button onClick={()=>onDone()} className="grid h-10 w-10 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken" aria-label="Close editor"><Icon name="close" size={17} /></button>
      </div>
      <textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={5} aria-label="Caption" className="mt-4 w-full rounded-2xl border border-line bg-surface px-3 py-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent" placeholder="Write a caption..." />
      <div className="mt-4">
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Music</p>
        {selected&&<div className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft p-2">
          <Icon name="music" size={15} className="shrink-0 text-accent-strong" />
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-accent-strong">{selected.title} · {selected.artist}</span>
          <button onClick={()=>setSelected(null)} aria-label="Remove music" className="grid h-8 w-8 place-items-center rounded-full text-accent-strong"><Icon name="close" size={14} /></button>
        </div>}
        <input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search worship music" className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent" placeholder="Search worship music..." />
        {tracks.length>0&&<div className="mt-2 max-h-36 space-y-1 overflow-auto">{tracks.map(t=><button key={t.id} onClick={()=>{setSelected(t);setQuery('')}} className="w-full rounded-xl bg-surface p-2 text-left hover:bg-surface-sunken"><b className="text-xs">{t.title}</b><span className="block text-2xs text-ink-muted">{t.artist}</span></button>)}</div>}
      </div>
      <div className="mt-5 flex gap-2">
        <button onClick={()=>onDone()} className="min-h-11 flex-1 rounded-2xl border border-line bg-surface-sunken text-sm font-extrabold text-ink">Cancel</button>
        <button disabled={busy} onClick={()=>void save()} className="min-h-11 flex-1 rounded-2xl bg-accent text-sm font-extrabold text-white disabled:opacity-60">{busy?'Saving…':'Save changes'}</button>
      </div>
    </div>
  </div>
}
