import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { canCreateContent, type ContentType } from '../state/permissions'
import { startBackgroundUpload, xhrSend, apiJson } from '../lib/backgroundUploads'

type Props = { onDone: () => void }
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const labels: Record<ContentType, string> = { post: 'Photo post', story: 'Story (24h)', video: 'Reel / sermon video', music: 'Worship track', announcement: 'Announcement' }
const hints: Record<ContentType, string> = {
  post: 'A photo with a message for the family',
  story: 'A moment visible for 24 hours',
  video: 'Sermon clip, worship moment or testimony',
  music: 'Add a song to the church worship library',
  announcement: 'Official notice to the whole church',
}

// Runs as a background job: presign → upload (with progress) → confirm.
async function uploadMedia(file: File, type: 'post' | 'story' | 'reel' | 'track', meta: { caption?: string; title?: string; artist?: string }, onPct: (pct: number) => void) {
  const token = localStorage.getItem('harvest_token') || ''
  const presign = await apiJson(`${API}/api/media/presign`, token, { type, contentType: file.type, bytes: file.size, ext: (file.name.split('.').pop() || 'bin').toLowerCase() })
  const form = new FormData()
  Object.entries(presign.fields || {}).forEach(([key, value]) => form.append(key, String(value)))
  form.append('file', file)
  // Proxy fallback uploads hit our own API and need the bearer token
  // (direct-to-R2 presigned posts would reject extra auth headers).
  const isDirectR2 = /^https?:\/\//.test(presign.url)
  const up = await xhrSend(isDirectR2 ? presign.url : `${API}${presign.url}`, 'POST', form, isDirectR2 ? undefined : { Authorization: `Bearer ${token}` }, onPct)
  if (!up.ok) throw new Error('Upload failed — check your connection and file size')
  await apiJson(`${API}/api/media/confirm`, token, { key: presign.key, type, caption: meta.caption, title: meta.title, artist: meta.artist })
}

export default function PostCreate({ onDone }: Props) {
  const { role, isVerified, isAdmin } = useAuth()
  const user = useMemo(() => ({ role, verified: isVerified }), [role, isVerified])
  // Members see Story only. Admins get the full console: post, reel, track, announcement.
  const available: ContentType[] = isAdmin ? ['post', 'video', 'music', 'announcement'] : ['story']
  const [type, setType] = useState<ContentType>(available[0])
  const [caption, setCaption] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canCreate = canCreateContent(user, type)

  const accept = type === 'video' ? 'video/*' : type === 'music' ? 'audio/*' : 'image/*,video/*'
  const needsFile = type !== 'announcement'

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const submit = async () => {
    if (busy) return
    if (!canCreate) { setNotice('Your account cannot publish this type of content.'); return }
    if (needsFile && !file) { setNotice('Add the media first.'); return }
    if (type === 'music' && !title.trim()) { setNotice('Give the track a title.'); return }
    if (type === 'announcement' && !caption.trim()) { setNotice('Write the announcement text.'); return }
    setBusy(true); setNotice('')
    try {
      const token = localStorage.getItem('harvest_token') || ''
      if (!token) throw new Error('Sign in first')
      if (type === 'announcement') {
        const r = await fetch(`${API}/api/admin/publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: 'announcement', caption: caption.trim() }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not publish announcement')
        onDone()
      } else if (file) {
        const serverType = type === 'video' ? 'reel' : type === 'music' ? 'track' : type
        const label = labels[type]
        // Hand off to the background manager and close immediately —
        // progress shows in the floating pill while the user keeps browsing.
        void startBackgroundUpload({
          label,
          successMsg: `${label} shared with the family ✓`,
          run: onPct => uploadMedia(file, serverType as 'post' | 'story' | 'reel' | 'track', {
            caption: caption.trim(),
            title: type === 'music' ? title.trim() : undefined,
            artist: type === 'music' ? artist.trim() || 'Harvest Worship' : undefined,
          }, onPct),
        }).catch(() => {})
        onDone()
      } else {
        onDone()
      }
    } catch (e: any) {
      setNotice(e?.message || 'Unable to share this media')
      setBusy(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F] pb-8">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 h-16 bg-[#FFFBF0]/95 backdrop-blur border-b border-[#E8DEC9]">
        <button onClick={onDone} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Close">×</button>
        <div className="text-center"><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="font-extrabold text-base">{isAdmin ? 'Admin studio' : 'Share a moment'}</h1></div>
        <button disabled={busy} onClick={() => void submit()} className="px-4 py-2 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy ? 'Sharing…' : 'Share'}</button>
      </header>
      <section className="px-4 pt-5 max-w-xl mx-auto">
        {available.length > 1 && (
          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
            <p className="text-xs font-bold text-[#766E63] mb-3">WHAT ARE YOU SHARING?</p>
            <div className="grid grid-cols-2 gap-2">
              {available.map(item => (
                <button key={item} onClick={() => { setType(item); setFile(null); setPreviewUrl(null); setNotice('') }} className={`text-left p-3 rounded-2xl border ${type === item ? 'border-[#7C3AED] bg-[#F3E8FF]' : 'border-[#E8DEC9] bg-[#FFFBF0]'}`}>
                  <span className="block text-sm font-bold">{labels[item]}</span>
                  <span className="block text-[11px] text-[#766E63] mt-1">{hints[item]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {available.length === 1 && (
          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
            <p className="text-sm font-bold">{labels[type]}</p>
            <p className="text-[11px] text-[#766E63] mt-1">{hints[type]}</p>
          </div>
        )}

        {needsFile && (
          <div className="mt-3 rounded-3xl bg-white border border-[#E8DEC9] overflow-hidden shadow-sm">
            {previewUrl ? (
              <div className="relative bg-[#F5EEDF] aspect-[4/3] flex items-center justify-center">
                {file?.type.startsWith('video/') ? <video src={previewUrl} controls className="w-full h-full object-cover" /> : file?.type.startsWith('audio/') ? <div className="text-center p-6"><span className="text-5xl">🎵</span><p className="text-sm font-bold mt-2 truncate max-w-[220px]">{file.name}</p></div> : <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />}
                <button onClick={() => { setFile(null); setPreviewUrl(null) }} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90" aria-label="Remove media">×</button>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} className="w-full aspect-[4/3] flex flex-col items-center justify-center hover:bg-[#FFFBF0]">
                <span className="w-14 h-14 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-2xl">＋</span>
                <strong className="mt-3 text-sm">{type === 'music' ? 'Choose an audio file' : type === 'video' ? 'Choose a video' : 'Choose a photo or video'}</strong>
                <span className="text-xs text-[#766E63] mt-1">{type === 'video' ? 'Up to 100 MB' : type === 'music' ? 'Up to 20 MB' : 'Up to 10 MB'}</span>
              </button>
            )}
            <input ref={fileInput} type="file" accept={accept} onChange={onFile} className="hidden" />
          </div>
        )}

        <div className="mt-3 p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
          <label className="text-xs font-bold text-[#766E63]">{type === 'music' ? 'TRACK DETAILS' : type === 'announcement' ? 'ANNOUNCEMENT' : 'YOUR MESSAGE'}</label>
          {type === 'music' && (
            <div className="mt-2 space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
            </div>
          )}
          {type !== 'music' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={type === 'announcement' ? 6 : 4} placeholder={type === 'announcement' ? 'Write the official church announcement…' : type === 'story' ? 'What is happening in this moment?' : 'Share the message with your church family…'} className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />}
          {!isAdmin && <p className="text-[11px] text-[#766E63] mt-2">Members share stories — posts, reels and music are published by your church admins.</p>}
        </div>

        {notice && <div role="alert" className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
      </section>
    </main>
  )
}
