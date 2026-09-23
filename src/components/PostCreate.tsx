import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { canCreateContent, type ContentType } from '../state/permissions'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { presign, uploadToMinio } from '../lib/api'
import ImageAdjuster, { captureVideoFrame } from './ImageAdjuster'

type Props = { onDone: () => void }
type Step = 'type' | 'media' | 'edit' | 'details'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const labels: Record<ContentType, string> = {
  post: 'Photo post',
  story: 'Story',
  video: 'Reel / video',
  music: 'Worship track',
  sermon: 'Sermon',
  announcement: 'Announcement',
}

const hints: Record<ContentType, string> = {
  post: 'Share a photo with the family',
  story: 'A moment that lives for 24 hours',
  video: 'Share a worship moment or testimony',
  music: 'Add music to the worship library',
  sermon: 'Share a teaching in MP3 or MP4',
  announcement: 'Publish an official church notice',
}

const stepLabels: Record<Step, string> = {
  type: 'Choose',
  media: 'Media',
  edit: 'Edit',
  details: 'Details',
}

function Icon({ name }: { name: 'photo' | 'video' | 'music' | 'sermon' | 'story' | 'notice' | 'back' | 'close' | 'check' | 'plus' }) {
  const paths: Record<string, React.ReactNode> = {
    photo: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 6"/></>,
    video: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 5 4-5 4z"/></>,
    music: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
    sermon: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h8M8 15h5"/></>,
    story: <><circle cx="12" cy="12" r="8.5"/><path d="M8 4.5A8.5 8.5 0 0 0 4.5 8M12 8v5l3 2"/></>,
    notice: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    back: <><path d="m15 5-7 7 7 7"/></>,
    close: <><path d="m7 7 10 10M17 7 7 17"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Header({ step, onBack, onClose, action, disabled }: { step: Step; onBack?: () => void; onClose: () => void; action?: string; disabled?: boolean }) {
  return (
    <header className="shrink-0 h-16 px-4 flex items-center justify-between border-b border-[#E8DEC9] bg-[#FFFBF0]">
      <div className="w-20">
        {onBack ? <button onClick={onBack} className="inline-flex items-center gap-1.5 min-h-11 px-2 -ml-2 rounded-xl text-[#4A433A] active:bg-[#F5EEDF]" aria-label="Back"><Icon name="back"/><span className="text-sm font-semibold">Back</span></button> : <button onClick={onClose} className="w-11 h-11 -ml-1 rounded-xl flex items-center justify-center text-[#4A433A] active:bg-[#F5EEDF]" aria-label="Close"><Icon name="close"/></button>}
      </div>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-[#8A8175]">Harvest Family</p>
        <p className="text-[15px] font-extrabold text-[#29251F]">{stepLabels[step]}</p>
      </div>
      <div className="w-20 flex justify-end">{action && <button disabled={disabled} className="min-h-11 px-3 rounded-xl bg-[#7C3AED] text-white text-sm font-extrabold disabled:opacity-40">{action}</button>}</div>
    </header>
  )
}

function Progress({ step }: { step: Step }) {
  const steps: Step[] = ['type', 'media', 'edit', 'details']
  const current = steps.indexOf(step)
  return (
    <div className="px-4 pt-3">
      <div className="flex gap-1.5" aria-label={`Step ${current + 1} of ${steps.length}`}>
        {steps.map((s, i) => <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= current ? 'bg-[#7C3AED]' : 'bg-[#E8DEC9]'}`} />)}
      </div>
    </div>
  )
}

export default function PostCreate({ onDone }: Props) {
  const { role, isVerified, isAdmin } = useAuth()
  const user = useMemo(() => ({ role, verified: isVerified }), [role, isVerified])
  const available: ContentType[] = isAdmin
    ? ['post', 'story', 'video', 'sermon', 'music', 'announcement']
    : isVerified
      ? ['post', 'story', 'video', 'sermon', 'music']
      : ['story']

  const [step, setStep] = useState<Step>('type')
  const [type, setType] = useState<ContentType>(available[0])
  const [caption, setCaption] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [scripture, setScripture] = useState('')
  const [musicTrack, setMusicTrack] = useState<any | null>(null)
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicQuery, setMusicQuery] = useState('')
  const [musicOpen, setMusicOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const canCreate = canCreateContent(user, type)
  const needsFile = type !== 'announcement'
  const accept = type === 'video' ? 'video/mp4,video/*'
    : type === 'music' ? 'audio/*'
      : type === 'sermon' ? '.mp3,audio/mpeg,.m4a,.mp4,video/mp4'
        : 'image/*,video/*'

  useEffect(() => {
    if (!musicOpen || type === 'music' || type === 'sermon') return
    const q = musicQuery.trim()
    if (!q) { setMusicResults([]); return }
    const timer = setTimeout(() => {
      fetch(`${API}/api/music?limit=20`)
        .then(r => r.json())
        .then(d => {
          const all = Array.isArray(d?.tracks) ? d.tracks : []
          setMusicResults(all.filter((x: any) => `${x.title} ${x.artist}`.toLowerCase().includes(q.toLowerCase())))
        })
        .catch(() => setMusicResults([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [musicOpen, musicQuery, type])

  const resetMedia = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setMusicTrack(null)
    setMusicOpen(false)
    setMusicQuery('')
    setMusicResults([])
  }

  const chooseType = (next: ContentType) => {
    if (next === type) return
    resetMedia()
    setCaption('')
    setTitle('')
    setArtist('')
    setScripture('')
    setNotice('')
    setType(next)
  }

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    if (!picked) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(picked)
    setFile(picked)
    setPreviewUrl(url)
    setNotice('')
    event.target.value = ''
    setStep('preview' as Step)
    if (picked.type.startsWith('image/')) setAdjusting(true)
  }

  const applyAdjust = (blob: Blob, preview: string) => {
    const adjusted = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(adjusted)
    setPreviewUrl(preview)
    setAdjusting(false)
    setStep('edit')
  }

  const validateAndDetails = () => {
    if (!canCreate) { setNotice('Your account cannot publish this content type.'); return }
    if (needsFile && !file) { setNotice('Choose your media first.'); setStep('media'); return }
    setNotice('')
    setStep('details')
  }

  const submit = async () => {
    if (busy) return
    if (!canCreate) { setNotice('Your account cannot publish this type of content.'); return }
    if (needsFile && !file) { setNotice('Choose your media first.'); setStep('media'); return }
    if (type === 'music' && !title.trim()) { setNotice('Give the track a title.'); return }
    if (type === 'sermon' && !title.trim()) { setNotice('Give the sermon a title.'); return }
    if (type === 'announcement' && !caption.trim()) { setNotice('Write the announcement text.'); return }

    setBusy(true)
    setNotice('')
    try {
      const token = localStorage.getItem('harvest_token') || ''
      if (!token) throw new Error('Sign in first')

      if (type === 'announcement') {
        const r = await fetch(`${API}/api/admin/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: 'announcement', caption: caption.trim() }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not publish announcement')
        onDone()
        return
      }

      if (!file) return
      let coverKey: string | undefined
      if (type === 'video' && previewUrl) {
        try {
          const coverBlob = await captureVideoFrame(previewUrl, 0.1)
          if (coverBlob) {
            const coverFile = new File([coverBlob], 'cover.jpg', { type: 'image/jpeg' })
            const pre = await presign({ type: 'post', contentType: 'image/jpeg', bytes: coverFile.size, ext: 'jpg' })
            await uploadToMinio(pre.url, pre.fields, coverFile)
            coverKey = pre.key
          }
        } catch {
          // Publishing remains possible if a device cannot create a poster.
        }
      }

      const serverType = type === 'video' ? 'reel'
        : type === 'music' ? 'track'
          : type === 'sermon' ? (file.type.startsWith('video/') ? 'sermon_video' : 'sermon_audio')
            : type

      const label = labels[type]
      setBusy(false)
      void startBackgroundUpload({
        label,
        successMsg: `${label} shared with the family ✓`,
        task: {
          kind: serverType as any,
          file,
          caption: caption.trim(),
          title: (type === 'music' || type === 'sermon') ? title.trim() : undefined,
          artist: type === 'music' ? artist.trim() || 'Harvest Worship' : (type === 'sermon' ? artist.trim() || undefined : undefined),
          speaker: type === 'sermon' ? artist.trim() || undefined : undefined,
          scripture: type === 'sermon' ? scripture.trim() || undefined : undefined,
          music_track_id: ['post', 'video', 'story'].includes(type) ? musicTrack?.id : undefined,
          description: type === 'sermon' ? caption.trim() : undefined,
          cover_key: coverKey,
        },
      }).catch(() => {})
      onDone()
    } catch (e: any) {
      setNotice(e?.message || 'Unable to share this media')
      setBusy(false)
    }
  }

  if (adjusting && file && file.type.startsWith('image/')) {
    return <ImageAdjuster file={file} onCancel={() => { setAdjusting(false); setStep('media') }} onDone={applyAdjust} />
  }

  return (
    <main className="min-h-[100dvh] bg-[#FFFBF0] text-[#29251F] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <Header step={step} onClose={onDone} onBack={step === 'type' ? undefined : () => {
        setNotice('')
        if (step === 'media') setStep('type')
        else if (step === 'edit') setStep('media')
        else setStep('edit')
      }} />
      <Progress step={step} />

      <div key={step} className="flex-1 min-h-0 overflow-auto animate-[hfSlideIn_220ms_ease-out]">
        {step === 'type' && (
          <section className="px-4 pt-7 pb-28 max-w-xl mx-auto w-full">
            <div className="mb-7">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A8175]">Create something</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-[#29251F]">What would you like to share?</h1>
              <p className="mt-2 text-sm leading-6 text-[#766E63]">Choose the kind of content first. You can change your mind before adding media.</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {available.map(item => {
                const icon = item === 'post' ? 'photo' : item === 'video' ? 'video' : item === 'music' ? 'music' : item === 'sermon' ? 'sermon' : item === 'story' ? 'story' : 'notice'
                return (
                  <button key={item} onClick={() => { setType(item); setNotice(''); setStep('media') }} className="group w-full min-h-[78px] p-4 rounded-3xl border border-[#E8DEC9] bg-white text-left flex items-center gap-4 shadow-[0_4px_18px_rgba(77,58,28,0.05)] active:scale-[0.99] transition-transform">
                    <span className="w-12 h-12 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center shrink-0 group-active:scale-95 transition-transform"><Icon name={icon as any}/></span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[15px] font-extrabold">{labels[item]}</strong>
                      <span className="block mt-1 text-xs text-[#766E63]">{hints[item]}</span>
                    </span>
                    <span className="text-[#A49A8E] text-xl">›</span>
                  </button>
                )
              })}
            </div>
            {!isAdmin && !isVerified && <p className="mt-6 p-4 rounded-2xl bg-[#F5EEDF] text-xs leading-5 text-[#766E63]">Members can share stories. Verification unlocks posts, videos, music and sermons.</p>}
            {!isAdmin && isVerified && <p className="mt-6 p-4 rounded-2xl bg-[#F5EEDF] text-xs leading-5 text-[#766E63]">Verified members can share community content and sermons. Some media may enter admin review.</p>}
          </section>
        )}

        {step === 'media' && (
          <section className="px-4 pt-6 pb-28 max-w-xl mx-auto w-full">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A8175]">{labels[type]}</p>
              <h1 className="mt-1 text-2xl font-black">Choose your media</h1>
            </div>
            {needsFile ? (
              <>
                <button onClick={() => fileInput.current?.click()} className="w-full aspect-[4/3] rounded-[28px] border-2 border-dashed border-[#D8CDBB] bg-white flex flex-col items-center justify-center active:scale-[0.995] transition-transform">
                  <span className="w-16 h-16 rounded-3xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center"><Icon name="plus"/></span>
                  <strong className="mt-4 text-base font-extrabold">{type === 'music' ? 'Choose audio' : type === 'video' ? 'Choose video' : 'Choose photo or video'}</strong>
                  <span className="mt-1 text-xs text-[#766E63]">{type === 'video' ? 'MP4 and video files up to 100 MB' : type === 'music' ? 'Audio up to 20 MB' : type === 'sermon' ? 'MP3/M4A up to 80 MB or MP4 up to 500 MB' : 'Choose from your camera or gallery'}</span>
                </button>
                <input ref={fileInput} type="file" accept={accept} onChange={onFile} className="hidden" />
              </>
            ) : (
              <div className="p-5 rounded-3xl bg-white border border-[#E8DEC9]">
                <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#8A8175]">Announcement</label>
                <textarea autoFocus value={caption} onChange={e => setCaption(e.target.value)} rows={8} placeholder="Write the official church announcement…" className="mt-3 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-4 text-sm outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#F3E8FF]" />
              </div>
            )}
            {notice && <div role="alert" className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
            {type === 'announcement' && <button onClick={() => void submit()} disabled={busy} className="mt-4 w-full min-h-12 rounded-2xl bg-[#7C3AED] text-white font-extrabold disabled:opacity-50">{busy ? 'Publishing…' : 'Publish announcement'}</button>}
          </section>
        )}

        {step === 'edit' && (
          <section className="px-4 pt-6 pb-28 max-w-xl mx-auto w-full">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A8175]">Preview</p>
              <h1 className="mt-1 text-2xl font-black">Make it look right</h1>
              <p className="mt-1 text-sm text-[#766E63]">Check the media before you add your message.</p>
            </div>
            <div className="rounded-[28px] overflow-hidden bg-[#2B2722] border border-[#E8DEC9] shadow-[0_10px_30px_rgba(77,58,28,0.12)]">
              {file?.type.startsWith('video/') ? (
                <video src={previewUrl || undefined} controls playsInline preload="metadata" className="w-full max-h-[62vh] object-contain bg-[#2B2722]" />
              ) : file?.type.startsWith('audio/') ? (
                <div className="aspect-square flex flex-col items-center justify-center text-white px-8">
                  <div className="w-20 h-20 rounded-3xl bg-[#7C3AED] flex items-center justify-center"><Icon name="music"/></div>
                  <p className="mt-4 text-base font-bold text-center truncate max-w-full">{file.name}</p>
                  <audio src={previewUrl || undefined} controls className="mt-5 w-full" />
                </div>
              ) : (
                <img src={previewUrl || undefined} alt="Selected media" className="w-full max-h-[62vh] object-contain bg-[#2B2722]" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {file?.type.startsWith('image/') && <button onClick={() => setAdjusting(true)} className="min-h-12 rounded-2xl border border-[#D8CDBB] bg-white font-bold text-sm">✎ Adjust photo</button>}
              <button onClick={() => { setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setStep('media') }} className="min-h-12 rounded-2xl border border-[#D8CDBB] bg-white font-bold text-sm text-[#5B5248]">Replace media</button>
            </div>
            <button onClick={validateAndDetails} className="mt-3 w-full min-h-12 rounded-2xl bg-[#7C3AED] text-white font-extrabold active:scale-[0.99] transition-transform">Continue to details</button>
            {notice && <div role="alert" className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
          </section>
        )}

        {step === 'details' && (
          <section className="px-4 pt-6 pb-28 max-w-xl mx-auto w-full">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A8175]">{labels[type]}</p>
              <h1 className="mt-1 text-2xl font-black">Add the details</h1>
            </div>
            <div className="rounded-3xl bg-white border border-[#E8DEC9] overflow-hidden">
              {previewUrl && <div className="h-28 bg-[#F5EEDF] flex items-center gap-4 p-3">
                {file?.type.startsWith('video/') ? <video src={previewUrl} muted playsInline className="h-full w-28 object-cover rounded-2xl" /> : file?.type.startsWith('audio/') ? <div className="h-full w-28 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center"><Icon name="music"/></div> : <img src={previewUrl} alt="" className="h-full w-28 object-cover rounded-2xl" />}
                <div className="min-w-0"><p className="font-extrabold text-sm">{labels[type]}</p><p className="text-xs text-[#766E63] mt-1 truncate">{file?.name}</p></div>
              </div>}
              <div className="p-4 space-y-3">
                {type === 'music' && <>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]" />
                  <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]" />
                </>}
                {type === 'sermon' && <>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Sermon title" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]" />
                  <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Speaker / preacher (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]" />
                  <input value={scripture} onChange={e => setScripture(e.target.value)} placeholder="Scripture reference (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]" />
                </>}
                {type !== 'music' && type !== 'sermon' && type !== 'announcement' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} placeholder={type === 'story' ? 'What is happening in this moment?' : 'Share the message with your church family…'} className="w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-4 text-sm outline-none focus:border-[#7C3AED]" />}
                {type === 'sermon' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Short description (optional)" className="w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-4 text-sm outline-none focus:border-[#7C3AED]" />}

                {['post', 'video', 'story'].includes(type) && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between py-2">
                      <div><p className="text-sm font-extrabold">Worship music</p><p className="text-[11px] text-[#766E63]">Optional soundtrack</p></div>
                      <button onClick={() => setMusicOpen(v => !v)} className="min-h-10 px-3 rounded-xl border border-[#D8CDBB] text-xs font-bold text-[#7C3AED]">{musicOpen ? 'Close' : musicTrack ? 'Change' : 'Choose'}</button>
                    </div>
                    {musicTrack && <div className="flex items-center gap-3 p-3 rounded-2xl bg-[#F3E8FF]"><div className="w-10 h-10 rounded-xl bg-white text-[#7C3AED] flex items-center justify-center"><Icon name="music"/></div><div className="min-w-0 flex-1"><p className="text-xs font-extrabold truncate">{musicTrack.title}</p><p className="text-[11px] text-[#766E63] truncate">{musicTrack.artist}</p></div><button onClick={() => setMusicTrack(null)} className="w-9 h-9 rounded-xl text-[#5B5248] active:bg-white" aria-label="Remove music"><Icon name="close"/></button></div>}
                    {musicOpen && <div className="mt-2 rounded-2xl border border-[#E8DEC9] bg-[#FFFBF0] p-3">
                      <input autoFocus value={musicQuery} onChange={e => setMusicQuery(e.target.value)} placeholder="Search worship music" className="w-full bg-white border border-[#E8DEC9] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#7C3AED]" />
                      <div className="mt-2 max-h-48 overflow-auto space-y-1">{musicResults.map((m: any) => <button key={m.id} onClick={() => { setMusicTrack(m); setMusicOpen(false); setMusicQuery('') }} className="w-full text-left p-3 rounded-xl active:bg-[#F3E8FF]"><p className="text-xs font-extrabold">{m.title}</p><p className="text-[11px] text-[#766E63]">{m.artist}</p></button>)}</div>
                    </div>}
                  </div>
                )}

                {type === 'sermon' && <p className="text-[11px] leading-5 text-[#766E63] p-3 rounded-2xl bg-[#F5EEDF]">Audio (MP3/M4A) or video (MP4). Members can stream and download the original teaching.</p>}
                {!isAdmin && !isVerified && <p className="text-[11px] leading-5 text-[#766E63] p-3 rounded-2xl bg-[#F5EEDF]">Members can share stories. Verification unlocks posts, videos, music and sermons.</p>}
              </div>
            </div>

            {notice && <div role="alert" className="mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
            <button onClick={() => void submit()} disabled={busy} className="mt-4 w-full min-h-13 rounded-2xl bg-[#7C3AED] text-white font-extrabold text-base shadow-sm active:scale-[0.99] transition-transform disabled:opacity-50">{busy ? 'Preparing…' : type === 'announcement' ? 'Publish announcement' : 'Share with the family'}</button>
            <p className="text-center text-[11px] text-[#8A8175] mt-3">You can go back and change the media before sharing.</p>
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-[#E8DEC9] bg-[#FFFBF0] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto flex items-center justify-between text-[11px] text-[#8A8175]">
          <span>{labels[type]}</span>
          <span>{stepLabels[step]} · {['type','media','edit','details'].indexOf(step) + 1} of 4</span>
        </div>
      </div>
    </main>
  )
}
