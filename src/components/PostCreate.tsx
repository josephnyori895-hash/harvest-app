import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { allowedDestinations, canCreateContent, canSubmitForApproval, type ContentType, type Destination } from '../state/permissions'

type Props = { onDone: () => void; onSubmit?: (type: string, data: any) => void }
const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const USE_API = import.meta.env.VITE_USE_API === 'true'
const labels: Record<ContentType, string> = { post: 'Community post', story: 'Community Moment', video: 'Community video', music: 'Worship music', announcement: 'Church announcement' }
const destinationLabels: Record<Destination, string> = { community: 'Harvest Community', group: 'My Groups', ministry: 'Ministry', worship: 'Worship', official: 'Official Church' }

async function uploadToServer(fileUrl: string, type: 'post'|'story'|'reel'|'track', caption: string) {
  const token = localStorage.getItem('harvest_token') || ''
  const blob = await (await fetch(fileUrl)).blob()
  const ext = blob.type.split('/')[1]?.split('+')[0] || 'bin'
  const presignResponse = await fetch(`${API}/api/media/presign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, contentType: blob.type, bytes: blob.size, ext }),
  })
  const presign = await presignResponse.json().catch(() => ({}))
  if (!presignResponse.ok) throw new Error(presign.error || 'Unable to prepare media upload')
  const form = new FormData()
  Object.entries(presign.fields || {}).forEach(([key, value]) => form.append(key, String(value)))
  form.append('file', blob)
  const uploadResponse = await fetch(presign.url, { method: 'POST', body: form })
  if (!uploadResponse.ok) throw new Error('Media upload failed')
  const confirmResponse = await fetch(`${API}/api/media/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: presign.key, type, caption }),
  })
  const result = await confirmResponse.json().catch(() => ({}))
  if (!confirmResponse.ok) throw new Error(result.error || 'Unable to submit media for review')
  return result
}

export default function PostCreate({ onDone, onSubmit }: Props) {
  const { role, isVerified, isAdmin, username } = useAuth()
  const user = useMemo(() => ({ role, verified: isVerified }), [role, isVerified])
  const [type, setType] = useState<ContentType>('post')
  const [destination, setDestination] = useState<Destination>('community')
  const [caption, setCaption] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [musicId, setMusicId] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const destinations = allowedDestinations(user, type)
  const canCreate = canCreateContent(user, type)
  const needsApproval = !isAdmin && canSubmitForApproval(user, type, destination)

  const changeType = (next: ContentType) => { setType(next); setDestination(allowedDestinations(user, next)[0] || 'community'); setNotice('') }

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (type === 'video' && !file.type.startsWith('video/')) { setNotice('Choose a video file for Community Video.'); return }
    if (type !== 'video' && !file.type.startsWith('image/')) { setNotice('Choose an image for this content.'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setFileUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const submit = async () => {
    if (busy) return
    if (!canCreate) { setNotice('Your account cannot publish this type of content.'); return }
    if (!destinations.includes(destination)) { setNotice('You do not have permission to publish to that destination.'); return }
    if ((type === 'video' || type === 'story') && !fileUrl) { setNotice('Add the media before sharing.'); return }
    if (!caption.trim() && !fileUrl && type !== 'announcement' && type !== 'music') { setNotice('Add a message or media first.'); return }
    setBusy(true); setNotice('')
    try {
      if (USE_API && fileUrl && ['post','story','video'].includes(type)) {
        const result = await uploadToServer(fileUrl, type === 'video' ? 'reel' : type, caption.trim())
        setNotice(result.status === 'approved' ? 'Published to the Harvest community.' : 'Submitted for Harvest review.')
      } else if (onSubmit) {
        const data = { user: username || 'harvest-family', caption: caption.trim(), img: type === 'video' ? undefined : fileUrl, video: type === 'video' ? fileUrl : undefined, musicId: musicId || undefined, destination, status: needsApproval ? 'pending' : 'published', submittedAt: new Date().toISOString() }
        onSubmit(type === 'video' ? 'reel' : type, data)
        setNotice(needsApproval ? 'Submitted for Harvest review.' : 'Shared with the Harvest family.')
      }
      window.setTimeout(onDone, 500)
    } catch (e: any) {
      setNotice(e?.message || 'Unable to share this media')
    } finally { setBusy(false) }
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F] pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 h-16 bg-[#FFFBF0]/95 backdrop-blur border-b border-[#E8DEC9]">
        <button onClick={onDone} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Close">×</button>
        <div className="text-center"><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="font-extrabold text-base">Share with your church family</h1></div>
        <button disabled={busy} onClick={() => void submit()} className="px-4 py-2 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy ? 'Sharing…' : 'Share'}</button>
      </header>
      <section className="px-4 pt-5 max-w-xl mx-auto">
        <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm"><p className="text-xs font-bold text-[#766E63] mb-3">WHAT ARE YOU SHARING?</p><div className="grid grid-cols-2 gap-2">{(['post','story','video',...(isVerified?['music']:[]),...(isAdmin?['announcement']:[])] as ContentType[]).map(item => <button key={item} onClick={() => changeType(item)} className={`text-left p-3 rounded-2xl border ${type===item?'border-[#7C3AED] bg-[#F3E8FF]':'border-[#E8DEC9] bg-[#FFFBF0]'}`}><span className="block text-sm font-bold">{labels[item]}</span><span className="block text-[11px] text-[#766E63] mt-1">{item==='post'?'Encouragement, testimony or update':item==='story'?'A short community moment':item==='video'?'A Harvest community video':item==='music'?'Submit worship music':'Official church communication'}</span></button>)}</div></div>
        <div className="mt-3 p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm"><p className="text-xs font-bold text-[#766E63] mb-3">SHARE WITH</p><div className="flex gap-2 flex-wrap">{destinations.map(item => <button key={item} onClick={() => setDestination(item)} className={`px-3 py-2 rounded-full text-xs font-bold border ${destination===item?'bg-[#7C3AED] border-[#7C3AED] text-white':'bg-[#FFFBF0] border-[#E8DEC9] text-[#5B21B6]'}`}>{destinationLabels[item]}</button>)}</div><p className="text-[11px] text-[#766E63] mt-3">{isAdmin?'Admin: you can publish official church content.':isVerified?'Verified member: trusted community creator. Official announcements remain admin-only.':'Member: you can share with the community and groups you belong to.'}</p></div>
        {type !== 'announcement' && type !== 'music' && <div className="mt-3 rounded-3xl bg-white border border-[#E8DEC9] overflow-hidden shadow-sm">{fileUrl?<div className="relative bg-[#F5EEDF] aspect-[4/3] flex items-center justify-center">{type==='video'?<video src={fileUrl} controls className="w-full h-full object-cover"/>:<img src={fileUrl} alt="Preview" className="w-full h-full object-cover"/>}<button onClick={()=>{setFileUrl(null);setFileName('')}} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90" aria-label="Remove media">×</button></div>:<button onClick={()=>fileInput.current?.click()} className="w-full aspect-[4/3] flex flex-col items-center justify-center hover:bg-[#FFFBF0]"><span className="w-14 h-14 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-2xl">＋</span><strong className="mt-3 text-sm">Add {type==='video'?'a video':'a photo'}</strong><span className="text-xs text-[#766E63] mt-1">Make your Harvest family moment visual</span></button>}<input ref={fileInput} type="file" accept={type==='video'?'video/*':'image/*'} onChange={onFile} className="hidden"/></div>}
        <div className="mt-3 p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm"><label className="text-xs font-bold text-[#766E63]">YOUR MESSAGE</label><textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={5} placeholder={type==='announcement'?'Write the official church announcement…':'Share an encouragement, testimony, prayer or update…'} className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]"/>{type==='music'&&<div className="mt-3"><label className="text-xs font-bold text-[#766E63]">WORSHIP TRACK</label><select value={musicId} onChange={e=>setMusicId(e.target.value)} className="mt-2 w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm"><option value="">Select a track from the Harvest library</option>{(()=>{try{return JSON.parse(localStorage.getItem('harvest_musics')||'[]')}catch{return []}})().map((m:any)=><option key={m.id} value={m.id}>{m.title} — {m.artist}</option>)}</select></div>}{fileName&&<p className="text-[11px] text-[#766E63] mt-2">Attached: {fileName}</p>}</div>
        <div className="mt-4 p-4 rounded-3xl bg-[#F3E8FF] border border-[#DDD6FE]"><p className="font-bold text-sm text-[#5B21B6]">Harvest publishing promise</p><p className="text-xs text-[#5B21B6]/80 mt-1">Community media is stored securely and, when required, waits for Harvest admin review. Official church communication is reserved for admins.</p></div>
        {notice&&<div role="status" className="mt-3 p-3 rounded-2xl bg-white border border-[#E8DEC9] text-sm font-semibold">{notice}</div>}
      </section>
    </main>
  )
}
