import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { canCreateContent, type ContentType } from '../state/permissions'
import { startBackgroundUpload, uploadTooLarge } from '../lib/backgroundUploads'
import { presign, uploadToMinio } from '../lib/api'
import ImageAdjuster, { captureVideoFrame } from './ImageAdjuster'
import VideoAdjuster from './VideoAdjuster'

import ErrorMessage from './ErrorMessage'
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
    ? ['post', 'story', 'video', 'sermon', 'music', 'announcement']
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
  const [videoAdjusting, setVideoAdjusting] = useState(false)
  const [videoCover, setVideoCover] = useState<Blob | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canCreate = canCreateContent(user, type)
  useEffect(() => { if (!musicOpen || type === 'music' || type === 'sermon') return; const q = musicQuery.trim(); if (!q) { setMusicResults([]); return }; const t = setTimeout(() => { fetch(`${API}/api/music?limit=20`).then(r => r.json()).then(d => { const all = Array.isArray(d?.tracks) ? d.tracks : []; setMusicResults(all.filter((x:any) => `${x.title} ${x.artist}`.toLowerCase().includes(q.toLowerCase()))) }).catch(() => setMusicResults([])) }, 250); return () => clearTimeout(t) }, [musicOpen, musicQuery, type])

  const accept = type === 'video' ? 'video/mp4,video/*' : type === 'music' ? 'audio/*' : type === 'sermon' ? '.mp3,audio/mpeg,.mp4,video/mp4' : 'image/*,video/*'
  const needsFile = type !== 'announcement'

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0]
    if (!f) return
    // Reject oversized files immediately — before a member waits on a
    // multi-hundred-MB upload that can only fail at presign time.
    const serverType = type === 'video' ? 'reel'
      : type === 'music' ? 'track'
      : type === 'sermon' ? (f.type.startsWith('video/') ? 'sermon_video' : 'sermon_audio')
      : type
    const tooBig = uploadTooLarge(serverType, f.size)
    if (tooBig) { setNotice(tooBig); event.target.value = ''; return }
    // Photos and videos use the same simple edit-first flow. Videos let the
    // user choose a cover frame without changing the original video.
    if (f.type.startsWith('image/')) {
      setFile(f)
      setPreviewUrl(URL.createObjectURL(f))
      setAdjusting(true)
    } else if (f.type.startsWith('video/')) {
      setFile(f)
      setPreviewUrl(URL.createObjectURL(f))
      setVideoCover(null)
      setVideoAdjusting(true)
    } else {
      setFile(f)
      setPreviewUrl(URL.createObjectURL(f))
    }
    event.target.value = ''
  }

  const applyVideoAdjust = (editedFile: File, cover: Blob | null) => {
    setFile(editedFile)
    setVideoCover(cover)
    setVideoAdjusting(false)
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
    if (caption.trim().length > 2000) { setNotice('Your message is too long. Keep it under 2,000 characters.'); return }
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
            const coverBlob = videoCover || await captureVideoFrame(previewUrl, 0.1)
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
      <>
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 h-16 bg-[#FFFBF0]/95 backdrop-blur border-b border-[#E8DEC9]">
        <button onClick={onDone} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Close">×</button>
        <div className="text-center"><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="font-extrabold text-base">{isAdmin ? 'Admin studio' : 'Share a moment'}</h1></div>
        <button disabled={busy || (needsFile && !file)} onClick={() => setShowPreview(true)} className="px-4 py-2 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">Preview</button>
      </header>
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Post preview">
          <div className="w-full max-w-md max-h-[90vh] overflow-auto rounded-3xl bg-[#FFFBF0] shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[#E8DEC9]">
              <strong className="text-sm">Final preview</strong>
              <button onClick={() => setShowPreview(false)} className="w-9 h-9 rounded-full bg-white" aria-label="Close preview">×</button>
            </div>
            <div className="p-4">
              {previewUrl && file?.type.startsWith('image/') && (
                <img src={previewUrl} alt="Post preview" className="w-full max-h-[55vh] object-contain rounded-2xl bg-black" />
              )}
              {previewUrl && file?.type.startsWith('video/') && (
                <video src={previewUrl} controls className="w-full max-h-[55vh] object-contain rounded-2xl bg-black" />
              )}
              {caption.trim() && <p className="mt-3 text-sm whitespace-pre-wrap">{caption.trim()}</p>}
              {musicTrack && <p className="mt-2 text-xs text-[#766E63]">🎵 {musicTrack.title} · {musicTrack.artist}</p>}
              {type === 'music' && (
                <p className="mt-3 text-sm font-bold">{title.trim() || 'Untitled track'}{artist.trim() ? ` · ${artist.trim()}` : ''}</p>
              )}
              {type === 'sermon' && (
                <>
                  <p className="mt-3 text-sm font-bold">{title.trim() || 'Untitled sermon'}</p>
                  {artist.trim() && <p className="text-xs text-[#766E63]">{artist.trim()}</p>}
                  {scripture.trim() && <p className="text-xs text-[#766E63]">{scripture.trim()}</p>}
                </>
              )}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setShowPreview(false)} className="flex-1 py-3 rounded-2xl border border-[#E8DEC9] font-bold text-sm">Keep editing</button>
                <button onClick={() => { setShowPreview(false); void submit() }} disabled={busy} className="flex-1 py-3 rounded-2xl bg-[#7C3AED] text-white font-bold text-sm disabled:opacity-50">
                  {busy ? 'Sharing…' : 'Share now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <section className="px-4 pt-5 max-w-xl mx-auto">
        {available.length > 1 && (
          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
            <p className="text-xs font-bold text-[#766E63] mb-3">WHAT ARE YOU SHARING?</p>
            <div className="grid grid-cols-2 gap-2">
              {available.map(item => (
                <button key={item} onClick={() => { setType(item); setFile(null); setPreviewUrl(null); setMusicTrack(null); setMusicQuery(''); setMusicOpen(false); setVideoCover(null); setNotice(''); setShowPreview(false) }} className={`text-left p-3 rounded-2xl border ${type === item ? 'border-[#7C3AED] bg-[#F3E8FF]' : 'border-[#E8DEC9] bg-[#FFFBF0]'}`}>
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
                {file?.type.startsWith('video/') ? <video src={previewUrl} controls className="w-full h-full object-contain bg-black" /> : file?.type.startsWith('audio/') ? <div className="text-center p-6"><span className="text-5xl">🎵</span><p className="text-sm font-bold mt-2 truncate max-w-[220px]">{file.name}</p></div> : <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />}
                {file?.type.startsWith('video/') && (
                  <button onClick={() => setVideoAdjusting(true)} className="absolute top-3 left-3 px-3 py-2 rounded-full bg-[#141210]/60 text-white text-xs font-bold" aria-label="Edit video">✎ Edit video</button>
                )}
                {file?.type.startsWith('image/') && (
                  <button onClick={() => setAdjusting(true)} className="absolute top-3 left-3 px-3 py-2 rounded-full bg-[#141210]/60 text-white text-xs font-bold" aria-label="Adjust image">✎ Adjust</button>
                )}
                <button onClick={() => { setFile(null); setPreviewUrl(null) }} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90" aria-label="Remove media">×</button>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} className="w-full aspect-[4/3] flex flex-col items-center justify-center hover:bg-[#FFFBF0]">
                <span className="w-14 h-14 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-2xl">＋</span>
                <strong className="mt-3 text-sm">{type === 'music' ? 'Choose an audio file' : type === 'video' ? 'Choose a video' : 'Choose a photo or video'}</strong>
                <span className="text-xs text-[#766E63] mt-1">{type === 'video' ? 'Up to 100 MB' : type === 'music' ? 'Up to 20 MB' : type === 'sermon' ? 'Audio up to 200 MB · video up to 1 GB' : 'Up to 10 MB'}</span>
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
              <p className="text-[11px] text-[#766E63]">Audio (MP3/M4A) or video (MP4) — up to 200 MB audio / 1 GB video, so full-length services fit. Members will be able to stream it and download the original file.</p>
            </div>
          )}
          {type !== 'music' && type !== 'sermon' && <textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={2000} rows={type === 'announcement' ? 6 : 4} placeholder={type === 'announcement' ? 'Write the official church announcement…' : type === 'story' ? 'What is happening in this moment?' : 'Share the message with your church family…'} className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />}
          {type === 'sermon' && <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Short description (optional) — what is this teaching about?" className="mt-2 w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />}
          {['post','video','story'].includes(type) && <div className="mt-4 pt-4 border-t border-[#E8DEC9]">
            <div className="flex items-center justify-between"><label className="text-xs font-bold text-[#766E63]">ADD MUSIC (OPTIONAL)</label><button onClick={() => setMusicOpen(v => !v)} className="text-xs font-bold text-[#7C3AED]">{musicOpen ? 'Close' : 'Choose'}</button></div>
            {musicTrack && <div className="mt-2 flex items-center gap-3 p-2 rounded-2xl bg-[#F3E8FF]"><div className="w-10 h-10 rounded-xl bg-[#EDE9FE] flex items-center justify-center">🎵</div><div className="flex-1 min-w-0"><p className="text-xs font-bold truncate">{musicTrack.title}</p><p className="text-[11px] text-[#766E63] truncate">{musicTrack.artist}</p></div><button onClick={() => setMusicTrack(null)} className="text-xs font-bold">×</button></div>}
            {musicOpen && <div className="mt-2"><input value={musicQuery} onChange={e => setMusicQuery(e.target.value)} placeholder="Search worship music..." className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm" /> <div className="mt-2 max-h-40 overflow-auto space-y-1">{musicResults.map((m:any) => <button key={m.id} onClick={() => { setMusicTrack(m); setMusicOpen(false) }} className="w-full text-left p-3 rounded-xl bg-[#FFFBF0] border border-[#E8DEC9]"><p className="text-xs font-bold">{m.title}</p><p className="text-[11px] text-[#766E63]">{m.artist}</p></button>)}</div></div>}
          </div>}
          {!isAdmin && !isVerified && <p className="text-[11px] text-[#766E63] mt-2">Members can share stories. Verification unlocks posts, videos, music and sermons.</p>}
          {!isAdmin && isVerified && <p className="text-[11px] text-[#766E63] mt-2">Verified members can share community content and sermons. Some media may enter admin review before appearing publicly.</p>}
        </div>

        {notice && <div className="mt-3"><ErrorMessage message={notice} /></div>}
      </section>

      </>
      {adjusting && file && file.type.startsWith('image/') && (
        <ImageAdjuster
          file={file}
          onCancel={() => setAdjusting(false)}
          onDone={applyAdjust}
        />
      )}
      {videoAdjusting && file && file.type.startsWith('video/') && (
        <VideoAdjuster
          file={file}
          onCancel={() => setVideoAdjusting(false)}
          onDone={applyVideoAdjust}
        />
      )}
    </main>
  )
}
