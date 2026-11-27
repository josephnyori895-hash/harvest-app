import { useCallback, useEffect, useRef, useState } from 'react'
import { captureVideoFrame } from './ImageAdjuster'
import { useModalFocus } from '../lib/useModalFocus'
import { useAndroidBack } from '../lib/useAndroidBack'

type Props = {
  file: File
  onCancel: () => void
  onDone: (file: File, cover: Blob | null) => void
}

// VideoAdjuster — the reel's cover step, laid out like Instagram's: the clip
// plays edge-to-edge above a filmstrip of frames. Tap a frame to make it the
// cover; the video itself is never re-encoded.

const STRIP_FRAMES = 8

/** Grab evenly spaced frames from one <video> element (one seek at a time —
 *  eight separate elements in the Android WebView would take forever). */
async function filmstrip(url: string, count: number): Promise<{ t: number; url: string }[]> {
  const v = document.createElement('video')
  v.muted = true
  v.crossOrigin = 'anonymous'
  v.preload = 'auto'
  v.src = url
  const loaded = new Promise<number>(resolve => {
    v.onloadedmetadata = () => resolve(v.duration || 0)
    v.onerror = () => resolve(0)
    setTimeout(() => resolve(0), 6000)
  })
  const duration = await loaded
  if (!duration || !Number.isFinite(duration)) return []
  const out: { t: number; url: string }[] = []
  const canvas = document.createElement('canvas')
  for (let i = 0; i < count; i += 1) {
    const t = Math.min(Math.max(((i + 0.5) / count) * duration, 0), Math.max(duration - 0.1, 0))
    const frame = await new Promise<Blob | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 2500)
      v.onseeked = () => {
        try {
          const k = Math.min(1, 180 / Math.max(v.videoWidth || 1, v.videoHeight || 1))
          canvas.width = Math.max(1, Math.round((v.videoWidth || 90) * k))
          canvas.height = Math.max(1, Math.round((v.videoHeight || 160) * k))
          canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
          canvas.toBlob(b => { clearTimeout(timer); resolve(b) }, 'image/jpeg', 0.7)
        } catch { clearTimeout(timer); resolve(null) }
      }
      try { v.currentTime = t } catch { clearTimeout(timer); resolve(null) }
    })
    if (frame) out.push({ t, url: URL.createObjectURL(frame) })
  }
  return out
}

export default function VideoAdjuster({ file, onCancel, onDone }: Props) {
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [cover, setCover] = useState<Blob | null>(null)
  const [coverUrl, setCoverUrl] = useState('')
  const [frames, setFrames] = useState<{ t: number; url: string }[]>([])
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const framesRef = useRef<{ t: number; url: string }[]>([])
  // Mounted only while the editor is open, so it is always "open" here: focus
  // goes to Cancel, Tab stays inside the editor, Escape cancels.
  useModalFocus(true, panelRef, onCancel)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  useEffect(() => () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl)
  }, [coverUrl])

  // Thumbnails own their URLs: release them when the strip is replaced or the
  // editor closes.
  useEffect(() => {
    framesRef.current = frames
  }, [frames])
  useEffect(() => () => { for (const f of framesRef.current) URL.revokeObjectURL(f.url) }, [])

  const capture = useCallback(async (t: number) => {
    if (!url || busy) return
    setBusy(true)
    setTime(t)
    try {
      const blob = await captureVideoFrame(url, t)
      if (blob) {
        if (coverUrl) URL.revokeObjectURL(coverUrl)
        setCover(blob)
        setCoverUrl(URL.createObjectURL(blob))
      }
    } finally { setBusy(false) }
  }, [url, busy, coverUrl])

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void filmstrip(url, STRIP_FRAMES).then(list => { if (!cancelled && list.length) setFrames(list) })
    return () => { cancelled = true }
  }, [url])

  useAndroidBack(true, onCancel)

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  const selectedFrame = frames.reduce((best, f) => (Math.abs(f.t - time) < Math.abs(best - time) ? f.t : best), -1)

  return (
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit video" className="fixed inset-0 z-[80] flex flex-col bg-black text-white outline-none" style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}>
      {/* Instagram's create header: X left, title centred, Next in blue. */}
      <header className="flex h-14 shrink-0 items-center justify-between px-2">
        <button type="button" onClick={onCancel} className="grid h-11 w-11 place-items-center rounded-full" aria-label="Cancel">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <p className="text-sm font-extrabold tracking-tight">New reel</p>
        <button type="button" onClick={() => onDone(file, cover)} className="min-h-11 px-3 text-sm font-extrabold text-sky-400">Next</button>
      </header>

      {/* the clip, edge to edge — like the reel you are about to publish */}
      <main className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          src={url}
          playsInline
          muted
          loop
          preload="metadata"
          poster={coverUrl || undefined}
          className="h-full w-full object-contain"
          onLoadedMetadata={e => { const d = e.currentTarget.duration || 0; setDuration(d); void capture(Math.min(0.1, Math.max(d - 0.1, 0))) }}
          onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={togglePlay}
        />
        {!playing && (
          <button type="button" onClick={togglePlay} aria-label="Play clip" className="absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/45 backdrop-blur-sm">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.4 5.6 18.6 12 8.4 18.4V5.6Z" /></svg>
            </span>
          </button>
        )}
        {/* the chosen cover, so the member sees exactly what the feed will show */}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
          {coverUrl ? <img src={coverUrl} alt="" className="h-10 w-7 rounded object-cover" /> : <span className="h-10 w-7 rounded bg-white/10" />}
          <span className="pr-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/80">Cover</span>
        </div>
      </main>

      {/* filmstrip — tap any frame to make it the cover */}
      <section className="shrink-0 bg-black px-3 pb-[max(0.75rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/45">Choose cover</p>
          <span className="text-[10px] font-bold tabular-nums text-white/45">{Math.floor(time / 60)}:{String(Math.round(time % 60)).padStart(2, '0')}</span>
        </div>
        <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="listbox" aria-label="Cover frames">
          {frames.length === 0 && (
            <div className="flex h-24 w-full items-center justify-center rounded-lg bg-white/5 text-[10px] font-bold text-white/40">
              Loading frames…
            </div>
          )}
          {frames.map(f => {
            const selected = Math.abs(f.t - selectedFrame) < 0.001
            return (
              <button
                key={f.t}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`Use frame at ${Math.round(f.t)} seconds`}
                onClick={() => void capture(f.t)}
                className={`relative h-24 w-16 shrink-0 overflow-hidden rounded-md ring-2 transition ${selected ? 'ring-sky-400' : 'ring-transparent'}`}
              >
                <img src={f.url} alt="" className="h-full w-full object-cover" />
              </button>
            )
          })}
        </div>
        <input
          type="range" min={0} max={Math.max(duration, 0.01)} step={0.05} value={time}
          onChange={e => setTime(Number(e.target.value))}
          onPointerUp={() => void capture(time)}
          onKeyUp={() => void capture(time)}
          className="mt-3 w-full accent-sky-400"
          aria-label="Choose video cover frame"
        />
        <p className="mt-1 text-center text-[10px] text-white/35">{busy ? 'Setting cover…' : 'Drag the playhead or tap a frame · video plays as-is'}</p>
      </section>
    </div>
  )
}
