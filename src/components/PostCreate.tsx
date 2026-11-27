// One composer for every kind of content a member can publish.
//
// The canvas is the preview: type is a compact segmented control, the media
// fills the stage edge-to-edge, and the caption sits directly under it with the
// music picker and per-type options. There is no separate "preview" modal —
// what you see is what posts.
//
// Behaviour that must not regress: privilege-gated types, size rejection before
// the upload starts, image/video adjustment before hand-off, a captured poster
// for reels, story duration, and the background upload manager owning the
// transfer so the member can leave the screen.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'
import { canCreateContent, type ContentType } from '../state/permissions'
import { startBackgroundUpload, uploadTooLarge, sermonKindOf } from '../lib/backgroundUploads'
import { showToast } from './Toast'
import { presign, uploadToMinio } from '../lib/api'
import ImageAdjuster, { captureVideoFrame } from './ImageAdjuster'
import VideoAdjuster from './VideoAdjuster'
import TrackArt from './TrackArt'

import ErrorMessage from './ErrorMessage'
import { Button, Dialog, Icon, Spinner, type IconName } from '../ui'
type Props = { onDone: () => void; initialType?: ContentType }
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const labels: Record<ContentType, string> = { post: 'Photo post', story: 'Story (24h)', video: 'Reel / clip video', music: 'Worship track', sermon: 'Sermon (MP3/MP4)', announcement: 'Announcement' }
const shortLabels: Record<ContentType, string> = { post: 'Photo', story: 'Story', video: 'Reel', music: 'Music', sermon: 'Sermon', announcement: 'Notice' }
const typeIcons: Record<ContentType, IconName> = { post: 'camera', story: 'sparkle', video: 'reels', music: 'music', sermon: 'mic', announcement: 'bell' }
const hints: Record<ContentType, string> = {
  post: 'A photo with a message for the family',
  story: 'A moment visible for 24 hours',
  video: 'Worship moment or testimony',
  music: 'Add a song to the church worship library',
  sermon: 'Full teaching — members stream or download it',
  announcement: 'Official notice to the whole church',
}
const captions: Record<ContentType, string> = {
  post: 'Write a message for your church family…',
  story: 'What is happening in this moment?',
  video: 'Say something about this reel…',
  music: 'Artist notes (optional)',
  sermon: 'Short description — what is this teaching about?',
  announcement: 'Write the official church announcement…',
}
const STORY_DURATIONS = [3, 5, 8, 12]

/** Portrait canvas for stories and reels; photo posts show their natural
 *  ratio (clamped to the feed's rendering band) so nothing is letterboxed. */
const stageRatio = (type: ContentType) => (type === 'story' || type === 'video' ? '9 / 16' : '4 / 5')
// Feed parity band — FeedImagePreview clamps to exactly these limits.
const clampStageRatio = (r: number) => Math.min(Math.max(r, 0.8), 1.91)

export default function PostCreate({ onDone, initialType }: Props) {
  const { role, isVerified, isAdmin, username: myUsername } = useAuth()
  const user = useMemo(() => ({ role, verified: isVerified }), [role, isVerified])
  // One composer, with options derived from the user's privileges.
  // Member: story. Verified: story + community media/music. Sermons additionally
  // require the manage_sermons capability grant — advertising the option to
  // plain verified members only set them up for the server's 403.
  const [canManageSermons, setCanManageSermons] = useState(isAdmin)
  useEffect(() => {
    if (!isVerified && !isAdmin) return
    const token = localStorage.getItem('harvest_token') || ''
    fetch(`${API}/api/me`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setCanManageSermons(isAdmin || (Array.isArray(d?.grants) && d.grants.includes('manage_sermons'))))
      .catch(() => {})
  }, [isAdmin, isVerified])
  const available: ContentType[] = isAdmin
    ? ['post', 'story', 'video', 'sermon', 'music', 'announcement']
    : isVerified
      ? canManageSermons
        ? ['post', 'story', 'video', 'sermon', 'music']
        : ['post', 'story', 'video', 'music']
      : ['story']
  const [type, setType] = useState<ContentType>(initialType && available.includes(initialType) ? initialType : available[0])
  const [caption, setCaption] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [scripture, setScripture] = useState('')
  const [duration, setDuration] = useState(5)
  const [musicTrack, setMusicTrack] = useState<any | null>(null)
  // Instagram's post extras: the members named on the post and an optional
  // location line. Both are offered only on photo posts — stories and reels
  // have their own media-first surfaces.
  const [tagged, setTagged] = useState<{ username: string; name?: string }[]>([])
  const [tagOpen, setTagOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [people, setPeople] = useState<any[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [location, setLocation] = useState('')
  const [locationOpen, setLocationOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [musicQuery, setMusicQuery] = useState('')
  const [musicOpen, setMusicOpen] = useState(false)
  const [musicLoading, setMusicLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // Album posts: extra photos beyond the first. Photos only — a reel, story or
  // track is still one item.
  const [extras, setExtras] = useState<{ file: File; url: string }[]>([])
  // Which album photo is open in the editor — Instagram lets every frame of a
  // carousel be cropped and filtered on its own, not just the first.
  const [editingExtra, setEditingExtra] = useState<number | null>(null)
  // Natural ratio of the previewed image, so the canvas matches the exact
  // geometry the feed will render — no black/white letterbox around a photo.
  const [imgRatio, setImgRatio] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [videoAdjusting, setVideoAdjusting] = useState(false)
  const [videoCover, setVideoCover] = useState<Blob | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const moreInput = useRef<HTMLInputElement>(null)
  const canCreate = canCreateContent(user, type)
  // Instagram's create sequence: pick & edit the media first, and the share
  // screen (caption + music) arrives only after. Photo/story/reel only —
  // music, sermons and announcements keep their single form.
  const isMediaKind = ['post', 'story', 'video'].includes(type)
  const [share, setShare] = useState(false)

  // Release temporary local previews when media is replaced or the composer closes.
  useEffect(() => {
    if (!previewUrl?.startsWith('blob:')) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  // Album thumbnails own their object URLs; release them when the selection
  // changes or the composer closes.
  useEffect(() => () => { for (const x of extras) URL.revokeObjectURL(x.url) }, [extras])

  // Members are pulled once per composer session, when the tag sheet opens.
  useEffect(() => {
    if (!tagOpen || people.length) return
    const token = localStorage.getItem('harvest_token') || ''
    setPeopleLoading(true)
    fetch(`${API}/api/users`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setPeople(Array.isArray(d?.users) ? d.users : []))
      .catch(() => setPeople([]))
      .finally(() => setPeopleLoading(false))
  }, [tagOpen, people.length])

  const toggleTag = (person: any) => {
    const username = String(person?.username || '').toLowerCase()
    if (!username) return
    setTagged(current => current.some(t => t.username === username)
      ? current.filter(t => t.username !== username)
      : current.length >= 20 ? current : [...current, { username, name: person.name }])
  }

  useEffect(() => {
    if (!musicOpen) return
    // Opening the sheet pulls the church's online library, so the member sees
    // the catalogue straight away instead of an empty box demanding a search.
    // Typing then filters that same list locally.
    const needle = musicQuery.trim().toLowerCase()
    setMusicLoading(true)
    const t = setTimeout(() => {
      fetch(`${API}/api/music?limit=100`)
        .then(r => r.json())
        .then(d => {
          const all = Array.isArray(d?.tracks) ? d.tracks : []
          setMusicResults(needle ? all.filter((x: any) => `${x.title} ${x.artist}`.toLowerCase().includes(needle)) : all)
        })
        .catch(() => setMusicResults([]))
        .finally(() => setMusicLoading(false))
    }, needle ? 250 : 0)
    return () => clearTimeout(t)
  }, [musicOpen, musicQuery])

  const accept = type === 'video' ? 'video/mp4,video/*' : type === 'music' ? 'audio/*' : type === 'sermon' ? '.mp3,.m4a,.aac,.ogg,.wav,.mp4,.webm,.mov,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,video/mp4,video/webm,video/quicktime,video/x-m4v' : 'image/*,video/*'
  const needsFile = type !== 'announcement'
  const audioOnlyStage = type === 'music' || type === 'sermon'

  const serverTypeOf = (f: File | Blob) => type === 'video' ? 'reel'
    : type === 'music' ? 'track'
    // Kind comes from the file itself, not the reported MIME: an .m4a labelled
    // video/mp4 by the picker is still sermon audio, and sending it as video
    // gets it refused at confirm after the whole transfer.
    : type === 'sermon' ? (sermonKindOf(f) === 'video' ? 'sermon_video' : 'sermon_audio')
    : type

  const takeFile = (f: File) => {
    // Reject oversized files immediately — before a member waits on a
    // multi-hundred-MB upload that can only fail at presign time.
    const tooBig = uploadTooLarge(serverTypeOf(f), f.size)
    if (tooBig) { setNotice(tooBig); return }
    setNotice('')
    setImgRatio(null)
    // Photos and videos use the same edit-first flow. Videos let the user pick
    // a cover frame without changing the original video.
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
  }

  // A multi-photo selection becomes one album post: the first photo takes the
  // usual edit step, the rest join it. Videos never mix with photos.
  const onFiles = (list: FileList | null) => {
    const picked = Array.from(list || [])
    if (!picked.length) return
    if (type === 'post' && picked.length > 1) {
      const images = picked.filter(f => f.type.startsWith('image/')).slice(0, 10)
      if (!images.length) { setNotice('Choose photos for a post, or one video.'); return }
      const tooBig = images.map(f => uploadTooLarge('post', f.size)).find(Boolean)
      if (tooBig) { setNotice(tooBig); return }
      setNotice('')
      for (const x of extras) URL.revokeObjectURL(x.url)
      setExtras(images.slice(1).map(f => ({ file: f, url: URL.createObjectURL(f) })))
      takeFile(images[0])
      return
    }
    takeFile(picked[0])
  }

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(event.target.files)
    event.target.value = ''
  }

  const addMorePhotos = (list: FileList | null) => {
    const images = Array.from(list || []).filter(f => f.type.startsWith('image/'))
    if (!images.length) return
    const room = 10 - (file ? 1 : 0) - extras.length
    const next = images.slice(0, Math.max(0, room))
    if (!next.length) { setNotice('A post can hold up to 10 photos.'); return }
    const tooBig = next.map(f => uploadTooLarge('post', f.size)).find(Boolean)
    if (tooBig) { setNotice(tooBig); return }
    setExtras(prev => [...prev, ...next.map(f => ({ file: f, url: URL.createObjectURL(f) }))])
  }

  const removeExtra = (index: number) => {
    setExtras(prev => {
      const gone = prev[index]
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter((_, i) => i !== index)
    })
  }

  // Replace one album photo with its edited version. The edited JPEG is a new
  // file, so the object URL swap also refreshes the thumbnail.
  const replaceExtra = (index: number, blob: Blob, preview: string) => {
    const edited = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    setExtras(prev => prev.map((x, i) => {
      if (i !== index) return x
      URL.revokeObjectURL(x.url)
      return { file: edited, url: preview }
    }))
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const f = event.dataTransfer?.files?.[0]
    if (f) takeFile(f)
  }

  const applyVideoAdjust = (editedFile: File, cover: Blob | null) => {
    setFile(editedFile)
    setVideoCover(cover)
    setVideoAdjusting(false)
    // Editing done → advance to Instagram's share step (caption + music).
    setShare(true)
  }

  const applyAdjust = (blob: Blob, preview: string) => {
    const adjusted = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    setFile(adjusted)
    setPreviewUrl(preview)
    setAdjusting(false)
    setShare(true)
  }

  const resetFor = (next: ContentType) => {
    setType(next); setFile(null); setPreviewUrl(null); setMusicTrack(null)
    for (const x of extras) URL.revokeObjectURL(x.url)
    setExtras([])
    setMusicQuery(''); setMusicOpen(false); setVideoCover(null); setNotice(''); setImgRatio(null); setShare(false)
    setTagged([]); setTagOpen(false); setTagQuery(''); setLocation(''); setLocationOpen(false)
    setEditingExtra(null)
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
        const label = labels[type]
        // Hand off to the background manager and close immediately —
        // progress shows in the floating pill while the user keeps browsing.
        void startBackgroundUpload({
          label,
          successMsg: type === 'story' ? 'Story shared — visible for 24 hours' : `${label} shared with the family`,
          task: {
            kind: serverTypeOf(file) as any,
            file,
            extra_files: type === 'post' && extras.length ? extras.map(x => x.file) : undefined,
            caption: caption.trim(),
            title: (type === 'music' || type === 'sermon') ? title.trim() : undefined,
            artist: type === 'music' ? artist.trim() || 'Harvest Worship' : (type === 'sermon' ? artist.trim() || undefined : undefined),
            speaker: type === 'sermon' ? artist.trim() || undefined : undefined,
            scripture: type === 'sermon' ? scripture.trim() || undefined : undefined,
            music_track_id: ['post', 'video', 'story'].includes(type) ? musicTrack?.id : undefined,
            location: type === 'post' ? location.trim() || undefined : undefined,
            tagged_users: type === 'post' && tagged.length ? tagged.map(t => t.username) : undefined,
            description: type === 'sermon' ? caption.trim() : undefined,
            cover_key: coverKey,
            duration_secs: type === 'story' ? duration : undefined,
          },
        }).catch(() => {
          // The manager reports terminal failure itself (toast + upload history),
          // and a task restored from IndexedDB after a restart has no promise to
          // settle at all — so nothing here may depend on that promise settling.
        })
        // RS-102: close at hand-off and say what is actually happening. Waiting on
        // the manager promise held the composer open across the whole retry ladder
        // (15s → 10m, up to five attempts) with no progress in view, and closing
        // silently implied the post was already live. The pill, upload history and
        // the sermons banner are where a failure surfaces.
        showToast('Uploading — we will tell you if it fails', 'info', 3000)
        onDone()
      } else {
        onDone()
      }
    } catch (e: any) {
      setNotice(e?.message || 'Unable to share this media')
      setBusy(false)
    }
  }

  const heading = type === 'story' ? 'New story' : type === 'video' ? 'New reel' : type === 'post' ? 'New post' : labels[type]

  return (
    <main className="flex min-h-full flex-col bg-surface text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-2 px-3">
          <button
            onClick={isMediaKind && share ? () => setShare(false) : onDone}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-surface-sunken"
            aria-label={isMediaKind && share ? 'Back to media' : 'Close composer'}
          >
            <Icon name={isMediaKind && share ? 'arrow-left' : 'close'} size={20} />
          </button>
          <p className="min-w-0 flex-1 truncate text-base font-extrabold text-ink">{heading}</p>
          {isMediaKind && !share && previewUrl ? (
            <button
              onClick={() => setShare(true)}
              aria-label="Continue to share"
              data-testid="create-next"
              className="flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-extrabold text-accent-strong transition hover:bg-surface-sunken"
            >
              Next <Icon name="arrow-right" size={16} />
            </button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submit()}
              loading={busy}
              disabled={busy || (needsFile && !file) || !canCreate}
              className="shrink-0 rounded-full px-5"
            >
              Share
            </Button>
          )}
        </div>
        {available.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-3 pb-3" role="tablist" aria-label="What are you sharing">
            {available.map(item => (
              <button
                key={item}
                role="tab"
                aria-selected={type === item}
                onClick={() => resetFor(item)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-2xs font-extrabold transition ${type === item ? 'border-ink bg-ink text-white' : 'border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
              >
                <Icon name={typeIcons[item]} size={14} /> {shortLabels[item]}
              </button>
            ))}
          </div>
        )}
      </header>

      <section className="flex-1 pb-6">
        {/* media stage — the canvas is the preview */}
        {needsFile && !(isMediaKind && share) && (
          audioOnlyStage ? (
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-raised p-3 text-left transition hover:bg-surface-sunken"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  {file ? <Icon name={file.type.startsWith('video/') ? 'reels' : 'music'} size={20} /> : <Icon name="plus" size={22} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-ink">{file ? file.name : type === 'music' ? 'Choose an audio file' : 'Choose an audio or video file'}</span>
                  <span className="mt-0.5 block text-2xs text-ink-muted">{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : type === 'music' ? 'Up to 50 MB' : 'Audio up to 2 GB · video up to 5 GB'}</span>
                </span>
                {file && <span className="shrink-0 text-2xs font-bold text-accent">Replace</span>}
              </button>
              {file && file.type.startsWith('video/') && previewUrl && (
                <video src={previewUrl} controls playsInline preload="metadata" className="mt-3 max-h-[38vh] w-full rounded-card bg-surface-sunken object-contain" />
              )}
              {file && !file.type.startsWith('video/') && previewUrl && (
                <audio controls preload="metadata" src={previewUrl} className="mt-3 w-full" />
              )}
              <input ref={fileInput} type="file" accept={accept} onChange={onFile} className="hidden" />
            </div>
          ) : (
            <div
              onDragOver={event => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`relative w-full overflow-hidden bg-surface-sunken ${dragging ? 'ring-2 ring-inset ring-accent' : ''}`}
              style={{ aspectRatio: (type === 'post' && imgRatio) ? String(clampStageRatio(imgRatio)) : stageRatio(type), maxHeight: '62vh' }}
            >
              {previewUrl ? (
                <>
                  {file?.type.startsWith('video/') ? (
                    <video src={previewUrl} controls playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <img
                      src={previewUrl}
                      alt="Selected media preview"
                      className="h-full w-full object-cover"
                      onLoad={e => {
                        const im = e.currentTarget
                        if (im.naturalWidth && im.naturalHeight) setImgRatio(im.naturalWidth / im.naturalHeight)
                      }}
                    />
                  )}
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
                    <button
                      onClick={() => { setFile(null); setPreviewUrl(null); setVideoCover(null) }}
                      className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-ink/60 text-white backdrop-blur-sm"
                      aria-label="Remove media"
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-ink/70 to-transparent p-3">
                    <button
                      onClick={() => (file?.type.startsWith('video/') ? setVideoAdjusting(true) : setAdjusting(true))}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-2xs font-extrabold text-white backdrop-blur-sm"
                    >
                      <Icon name="pencil" size={14} /> {file?.type.startsWith('video/') ? 'Edit cover' : 'Edit'}
                    </button>
                    <button
                      onClick={() => fileInput.current?.click()}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-2xs font-extrabold text-white backdrop-blur-sm"
                    >
                      <Icon name="retry" size={14} /> Replace
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => fileInput.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center transition hover:bg-surface-raised">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-card">
                    <Icon name="plus" size={26} />
                  </span>
                  <span className="mt-1 text-sm font-extrabold text-ink">{type === 'video' ? 'Add your reel' : type === 'story' ? 'Add to your story' : 'Add a photo or video'}</span>
                  <span className="text-2xs text-ink-muted">{type === 'video' ? 'Up to 100 MB' : 'Up to 30 MB · drop a file here'}</span>
                  <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3.5 py-2 text-2xs font-extrabold text-accent-strong">
                    <Icon name="camera" size={14} /> Choose from device
                  </span>
                  {type === 'post' && <span className="text-[10px] font-semibold text-ink-subtle">Pick several photos to share one album</span>}
                </button>
              )}
              {/* Gallery and camera are separate entries: a `capture` hint on the
                  only input would hide the gallery, but a second input lets the
                  member take a photo on the spot. */}
              <input ref={fileInput} type="file" accept={accept} multiple={type === 'post'} onChange={onFile} className="hidden" />
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
              <input ref={moreInput} type="file" accept="image/*" multiple onChange={e => { addMorePhotos(e.target.files); e.target.value = '' }} className="hidden" />
              {!previewUrl && type !== 'video' && (
                <button
                  type="button"
                  onClick={() => cameraInput.current?.click()}
                  className="absolute right-3 top-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink/60 px-3.5 text-2xs font-extrabold text-white backdrop-blur-sm"
                >
                  <Icon name="camera" size={14} /> Take photo
                </button>
              )}
            </div>
          )
        )}

        {isMediaKind && type === 'post' && extras.length > 0 && !share && (
          <div className="flex items-center gap-2 overflow-x-auto px-3 pt-2" data-testid="create-album">
            {extras.map((x, i) => (
              <div key={x.url} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => setEditingExtra(i)}
                  aria-label={`Edit photo ${i + 2}`}
                  data-testid={`album-edit-${i}`}
                  className="group absolute inset-0 block"
                >
                  <img src={x.url} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-ink/55 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-white">
                    <Icon name="pencil" size={9} /> Edit
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeExtra(i)}
                  aria-label={`Remove photo ${i + 2}`}
                  className="absolute right-0.5 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => moreInput.current?.click()}
              aria-label="Add more photos"
              className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-dashed border-line text-ink-muted"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}

        {!needsFile && (
          <div className="px-3 pt-3">
            <div className="flex items-start gap-2.5 rounded-card border border-line bg-surface-raised p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink-muted"><Icon name="bell" size={17} /></span>
              <p className="min-w-0 text-2xs leading-relaxed text-ink-muted">{hints[type]}</p>
            </div>
          </div>
        )}

        {/* Instagram sequence for photo/story/reel: media first, then a share
            screen — small thumbnail at the left, caption beside it, music row
            underneath. Music, sermons and announcements keep one form. */}
        {isMediaKind ? (share ? (
          <div className="px-3 pt-3" data-testid="create-share-step">
            <div className="flex min-w-0 items-start gap-3">
              {previewUrl && (
                <img src={previewUrl} alt="Publishing preview" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-lg border border-line object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder={captions[type]}
                  data-testid="share-caption"
                  aria-label="Caption"
                  className="w-full resize-none border-0 bg-transparent px-0 text-sm leading-6 text-ink placeholder:text-ink-subtle focus:outline-none"
                />
                <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                  <span className={`text-2xs ${caption.length > 1900 ? 'font-bold text-gold-strong' : 'text-ink-subtle'}`}>{caption.length}/2000</span>
                  <button
                    type="button"
                    onClick={() => setMusicOpen(true)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-2xs font-extrabold text-ink transition hover:bg-surface-sunken"
                  >
                    <Icon name="music" size={14} /> {musicTrack ? 'Change music' : 'Add music'}
                  </button>
                </div>
              </div>
            </div>

            {musicTrack && ['post', 'video', 'story'].includes(type) && (
              <div className="mt-3 flex items-center gap-2.5 rounded-card border border-line bg-surface-raised p-2">
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                  <TrackArt src={musicTrack.cover_url} title={musicTrack.title} className="h-full w-full" iconSize={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs font-extrabold text-ink">{musicTrack.title}</span>
                  <span className="block truncate text-2xs text-ink-muted">{musicTrack.artist}</span>
                </span>
                <button onClick={() => setMusicTrack(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken" aria-label="Remove music">
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}

            {/* Instagram's post extras sit between the caption and Share:
                people to tag and a location line. */}
            {type === 'post' && (
              <div className="mt-4 space-y-2" data-testid="create-post-extras">
                <button
                  type="button"
                  onClick={() => setTagOpen(true)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-card border border-line bg-surface-raised px-3 text-left text-sm font-bold text-ink transition hover:bg-surface-sunken"
                >
                  <Icon name="users" size={18} className="text-ink-muted" />
                  <span className="flex-1">{tagged.length ? 'Tagged people' : 'Tag people'}</span>
                  <span className="text-2xs font-extrabold text-accent-strong">{tagged.length ? `${tagged.length}` : 'Add'}</span>
                </button>
                {tagged.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" data-testid="create-tagged-list">
                    {tagged.map(person => (
                      <span key={person.username} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-2.5 pr-1 text-2xs font-extrabold text-accent-strong">
                        @{person.username}
                        <button
                          type="button"
                          onClick={() => toggleTag(person)}
                          aria-label={`Remove ${person.username}`}
                          className="grid h-6 w-6 place-items-center rounded-full hover:bg-surface-raised"
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setLocationDraft(location); setLocationOpen(true) }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-card border border-line bg-surface-raised px-3 text-left text-sm font-bold text-ink transition hover:bg-surface-sunken"
                >
                  <Icon name="map" size={18} className="text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate">{location || 'Add location'}</span>
                  <span className="text-2xs font-extrabold text-accent-strong">{location ? 'Edit' : 'Add'}</span>
                </button>
                <p className="px-1 text-[10px] leading-relaxed text-ink-subtle">Tagged members and anyone you @mention in the caption are notified when the post goes out.</p>
              </div>
            )}

            {type === 'story' && (
              <div className="mt-4">
                <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-ink-subtle">Story length</p>
                <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Story length in seconds">
                  {STORY_DURATIONS.map(s => (
                    <button
                      key={s}
                      role="radio"
                      aria-checked={duration === s}
                      onClick={() => setDuration(s)}
                      className={`min-h-10 flex-1 rounded-xl border text-2xs font-extrabold transition ${duration === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-2xs text-ink-muted">Photos hold for {duration} seconds, then the next story plays.</p>
              </div>
            )}

            {!isAdmin && !isVerified && <p className="mt-3 text-2xs text-ink-muted">Members can share stories. Verification unlocks posts, reels, music and sermons.</p>}
            {!isAdmin && isVerified && <p className="mt-3 text-2xs text-ink-muted">Verified members can share community content and sermons. Some media may enter admin review before appearing publicly.</p>}

            {notice && <div className="mt-3"><ErrorMessage message={notice} /></div>}
          </div>
        ) : null) : (
          <div className="px-3 pt-3">
            {(type === 'music' || type === 'sermon') ? (
              <div className="space-y-2">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'music' ? 'Track title' : 'Sermon title (e.g. The Power of Persistence)'} className="input-base" />
                <input value={artist} onChange={e => setArtist(e.target.value)} placeholder={type === 'music' ? 'Artist (optional)' : 'Speaker / preacher (optional)'} className="input-base" />
                {type === 'sermon' && <input value={scripture} onChange={e => setScripture(e.target.value)} placeholder="Scripture reference (optional)" className="input-base" />}
                <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder={captions[type]} className="input-base resize-none" />
              </div>
            ) : (
              <>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={captions[type]}
                  className="w-full resize-none border-0 bg-transparent px-0 text-sm leading-6 text-ink placeholder:text-ink-subtle focus:outline-none"
                />
                <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                  <span className={`text-2xs ${caption.length > 1900 ? 'font-bold text-gold-strong' : 'text-ink-subtle'}`}>{caption.length}/2000</span>
                </div>
              </>
            )}

            {notice && <div className="mt-3"><ErrorMessage message={notice} /></div>}
          </div>
        )}
      </section>

      <Dialog open={musicOpen} onClose={() => setMusicOpen(false)} title="Add music" description="Pick a song from the church worship library." size="sm">
        <input
          value={musicQuery}
          onChange={e => setMusicQuery(e.target.value)}
          placeholder="Search song or artist…"
          className="input-base"
          autoFocus
        />
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-ink-subtle">Church library</p>
          {!musicLoading && musicResults.length > 0 && <span className="text-2xs text-ink-muted">{musicResults.length} track{musicResults.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="mt-1 max-h-[45vh] space-y-1 overflow-auto">
          {musicLoading && <p className="flex items-center gap-2 px-1 py-3 text-2xs text-ink-muted"><Spinner size={13} /> Loading the church library…</p>}
          {!musicLoading && musicResults.length === 0 && (
            <p className="px-1 py-3 text-2xs text-ink-muted">
              {musicQuery.trim() ? 'No tracks match that search.' : 'The library is empty — upload a track in the Music tab first.'}
            </p>
          )}
          {musicResults.map((m: any) => {
            const selected = String(musicTrack?.id) === String(m.id)
            return (
              <button
                key={m.id}
                onClick={() => { setMusicTrack(m); setMusicOpen(false); setMusicQuery('') }}
                aria-pressed={selected}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition ${selected ? 'border-accent bg-accent-wash' : 'border-transparent hover:bg-surface-sunken'}`}
              >
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                  <TrackArt src={m.cover_url} title={m.title} className="h-full w-full" iconSize={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs font-extrabold text-ink">{m.title}</span>
                  <span className="block truncate text-2xs text-ink-muted">{m.artist}</span>
                </span>
                {selected && <Icon name="check" size={16} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      </Dialog>

      <Dialog open={tagOpen} onClose={() => setTagOpen(false)} title="Tag people" description="Search your church family and tap to tag them." size="sm">
        <input
          value={tagQuery}
          onChange={e => setTagQuery(e.target.value)}
          placeholder="Search by name or @username…"
          className="input-base"
          autoFocus
        />
        <div className="mt-3 max-h-[45vh] space-y-1 overflow-auto">
          {peopleLoading && <p className="flex items-center gap-2 px-1 py-3 text-2xs text-ink-muted"><Spinner size={13} /> Loading the family…</p>}
          {!peopleLoading && (() => {
            const needle = tagQuery.trim().toLowerCase()
            const list = people
              .filter(p => p?.username && String(p.username).toLowerCase() !== String(myUsername || '').toLowerCase())
              .filter(p => !needle || `${p.name || ''} ${p.username}`.toLowerCase().includes(needle))
              .slice(0, 40)
            if (!list.length) return <p className="px-1 py-3 text-2xs text-ink-muted">{needle ? 'No member matches that search.' : 'No members to tag yet.'}</p>
            return list.map(p => {
              const selected = tagged.some(t => t.username === String(p.username).toLowerCase())
              return (
                <button
                  key={String(p.id || p.username)}
                  type="button"
                  onClick={() => toggleTag(p)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition ${selected ? 'border-accent bg-accent-wash' : 'border-transparent hover:bg-surface-sunken'}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-2xs font-extrabold text-accent-strong">
                    {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" /> : String(p.username).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs font-extrabold text-ink">{p.name || p.username}</span>
                    <span className="block truncate text-2xs text-ink-muted">@{p.username}</span>
                  </span>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${selected ? 'bg-accent text-white' : 'border border-line text-ink-subtle'}`}>
                    {selected ? <Icon name="check" size={14} /> : <Icon name="plus" size={14} />}
                  </span>
                </button>
              )
            })
          })()}
        </div>
        <button type="button" onClick={() => setTagOpen(false)} className="mt-3 min-h-11 w-full rounded-full bg-accent text-sm font-extrabold text-white transition hover:bg-accent-strong">
          {tagged.length ? `Done · ${tagged.length} tagged` : 'Done'}
        </button>
      </Dialog>

      <Dialog open={locationOpen} onClose={() => setLocationOpen(false)} title="Add location" description="Where was this moment? Shown under your name on the post." size="sm">
        <input
          value={locationDraft}
          onChange={e => setLocationDraft(e.target.value)}
          maxLength={120}
          placeholder="e.g. Harvest Family Church, Nyeri"
          className="input-base"
          autoFocus
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            setLocation(locationDraft.trim())
            setLocationOpen(false)
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => { setLocation(''); setLocationDraft(''); setLocationOpen(false) }}
            className="min-h-11 flex-1 rounded-full border border-line bg-surface-raised text-sm font-extrabold text-ink transition hover:bg-surface-sunken"
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => { setLocation(locationDraft.trim()); setLocationOpen(false) }}
            className="min-h-11 flex-1 rounded-full bg-accent text-sm font-extrabold text-white transition hover:bg-accent-strong"
          >
            Save
          </button>
        </div>
      </Dialog>

      {adjusting && file && file.type.startsWith('image/') && (
        <ImageAdjuster
          file={file}
          onCancel={() => setAdjusting(false)}
          onDone={applyAdjust}
        />
      )}
      {editingExtra !== null && extras[editingExtra] && (
        <ImageAdjuster
          key={extras[editingExtra].url}
          file={extras[editingExtra].file}
          onCancel={() => setEditingExtra(null)}
          onDone={(blob, preview) => { replaceExtra(editingExtra, blob, preview); setEditingExtra(null) }}
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
