import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { canCreateContent, type ContentType } from '../state/permissions'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { presign, uploadToMinio } from '../lib/api'
import ImageAdjuster, { captureVideoFrame } from './ImageAdjuster'

type Props = { onDone: () => void }
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const labels: Record<ContentType, string> = { post: 'Photo post', story: 'Story (24h)', video: 'Reel / clip video', music: 'Worship track', sermon: 'Sermon (MP3/MP4)', announcement: 'Announcement' }
const hints: Record<ContentType, string> = {
  post: 'A photo with a message for the family',
  story: 'A moment visible for 24 hours',
  video: 'Worship moment or testimony',
  music: 'Add a song to the church worship library',
  sermon: 'Full teaching — members stream or download it',
  announcement: 'Official notice to the whole church',
}

export default function PostCreate({ onDone }: Props) {
  const { role, isVerified, isAdmin } = useAuth()
  const user = useMemo(() => ({ role, verified: isVerified }), [role, isVerified])
  // One composer, with options derived from the user's privileges.
  // Member: story. Verified: story + community media/sermon/music. Admin: everything.
  const available: ContentType[] = isAdmin
    ? ['post', 'video', 'sermon', 'music', 'announcement']
    : isVerified
      ? ['post', 'story', 'video', 'sermon', 'music']
      : ['story']
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
  useEffect(() => { if (!musicOpen || type === 'music' || type === 'sermon') return; const q = musicQuery.trim(); if (!q) { setMusicResults([]); return }; const t = setTimeout(() => { fetch(`${API}/api/music?limit=20`).then(r => r.json()).then(d => { const all = Array.isArray(d?.tracks) ? d.tracks : []; setMusicResults(all.filter((x:any) => `${x.title} ${x.artist}`.toLowerCase().includes(q.toLowerCase()))) }).catch(() => setMusicResults([])) }, 250); return () => clearTimeout(t) }, [musicOpen, musicQuery, type])

  const accept = type === 'video' ? 'video/mp4,video/*' : type === 'music' ? 'audio/*' : type === 'sermon' ? '.mp3,audio/mpeg,.mp4,video/mp4' : 'image/*,video/*'
  const needsFile = type !== 'announcement'

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0]
    if (!f) return
    // Images open the crop/zoom/rotate editor first; videos pass through
    // (cover-frame picking happens on the preview below).
    if (f.type.startsWith('image/')) {
      setFile(f)
      setPreviewUrl(URL.createObjectURL(f))
      setAdjusting(true)
    } else {
      setFile(f)
      setPreviewUrl(URL.createObjectURL(f))
    }
    event.target.value = ''
  }

  const applyAdjust = (blob: Blob, preview: string) => {
    const adjusted = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    setFile(adjusted)
    setPreviewUrl(preview)
    setAdjusting(false)
  }

  const submit = async () => {
    if (busy) return
    if (!canCreate) { setNotice('Your account cannot publish this type of content.'); return }
    if (needsFile && !file) { setNotice('Add the media first.'); return }
    if (type === 'music' && !title.trim()) { setNotice('Give the track a title.'); return }
    if (type === 'sermon' && !title.trim()) { setNotice('Give the sermon a title.'); return }
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
        // Capture a small JPEG cover for videos before handing the upload to the
        // background manager. Without a poster, Android/WebView can show the
        // browser's empty video frame until playback starts.
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
            // The video remains publishable if a device cannot capture a frame.
          }
        }
        // Sermons: audio vs video is decided by the picked file itself.
        const serverType = type === 'video' ? 'reel'
          : type === 'music' ? 'track'
          : type === 'sermon' ? (file.type.startsWith('video/') ? 'sermon_video' : 'sermon_audio')
          : type
        const label = labels[type]
        // Hand off to the background manager and close immediately —
        // progress shows in the floating pill while the user keeps browsing.
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
            music_track_id: ['post','video','story'].includes(type) ? musicTrack?.id : undefined,
            description: type === 'sermon' ? caption.trim() : undefined,
            cover_key: coverKey,
          },
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
                <button key={item} onClick={() => { setType(item); setFile(null); setPreviewUrl(null); setMusicTrack(null); setNotice('') }} className={`text-left p-3 rounded-2xl border ${type === item ? 'border-[#7C3AED] bg-[#F3E8FF]' : 'border-[#E8DEC9] bg-[#FFFBF0]'}`}>
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
                {file?.type.startsWith('image/') && (
                  <button onClick={() => setAdjusting(true)} className="absolute top-3 left-3 px-3 py-2 rounded-full bg-black/60 text-white text-xs font-bold" aria-label="Adjust image">✎ Adjust</button>
                )}
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
          <label className="text-xs font-bold text-[#766E63]">{type === 'music' ? 'TRACK DETAILS' : type === 'sermon' ? 'SERMON DETAILS' : type === 'announcement' ? 'ANNOUNCEMENT' : 'YOUR MESSAGE'}</label>
          {type === 'music' && (
            <div className="mt-2 space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
            </div>
          )}
          {type === 'sermon' && (
            <div className="mt-2 space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Sermon title (e.g. The Power of Persistence)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Speaker / preacher (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              <input value={scripture} onChange={e => setScripture(e.target.value)} placeholder="Scripture reference (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              <p className="text-[11px] text-[#766E63]">Audio (MP3/M4A) or video (MP4) — up to 80 MB audio / 500 MB video. Members will be able to stream it and download the original file.</p>
            </div>
          )}
          {type !== 'music' && type !== 'sermon' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={type === 'announcement' ? 6 : 4} placeholder={type === 'announcement' ? 'Write the official church announcement…' : type === 'story' ? 'What is happening in this moment?' : 'Share the message with your church family…'} className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />}
          {type === 'sermon' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Short description (optional) — what is this teaching about?" className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />}
          {['post','video','story'].includes(type) && <div className="mt-4 pt-4 border-t border-[#E8DEC9]">
            <div className="flex items-center justify-between"><label className="text-xs font-bold text-[#766E63]">ADD MUSIC (OPTIONAL)</label><button onClick={() => setMusicOpen(v => !v)} className="text-xs font-bold text-[#7C3AED]">{musicOpen ? 'Close' : 'Choose'}</button></div>
            {musicTrack && <div className="mt-2 flex items-center gap-3 p-2 rounded-2xl bg-[#F3E8FF]"><div className="w-10 h-10 rounded-xl bg-[#EDE9FE] flex items-center justify-center">🎵</div><div className="flex-1 min-w-0"><p className="text-xs font-bold truncate">{musicTrack.title}</p><p className="text-[11px] text-[#766E63] truncate">{musicTrack.artist}</p></div><button onClick={() => setMusicTrack(null)} className="text-xs font-bold">×</button></div>}
            {musicOpen && <div className="mt-2"><input value={musicQuery} onChange={e => setMusicQuery(e.target.value)} placeholder="Search worship music..." className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm" /> <div className="mt-2 max-h-40 overflow-auto space-y-1">{musicResults.map((m:any) => <button key={m.id} onClick={() => { setMusicTrack(m); setMusicOpen(false) }} className="w-full text-left p-3 rounded-xl bg-[#FFFBF0] border border-[#E8DEC9]"><p className="text-xs font-bold">{m.title}</p><p className="text-[11px] text-[#766E63]">{m.artist}</p></button>)}</div></div>}
          </div>}
          {!isAdmin && !isVerified && <p className="text-[11px] text-[#766E63] mt-2">Members can share stories. Verification unlocks posts, videos, music and sermons.</p>}
          {!isAdmin && isVerified && <p className="text-[11px] text-[#766E63] mt-2">Verified members can share community content and sermons. Some media may enter admin review before appearing publicly.</p>}
        </div>

        {notice && <div role="alert" className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{notice}</div>}
      </section>

      {adjusting && file && file.type.startsWith('image/') && (
        <ImageAdjuster
          file={file}
          onCancel={() => setAdjusting(false)}
          onDone={applyAdjust}
        />
      )}
    </main>
  )
}
