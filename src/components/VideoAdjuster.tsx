import { useEffect, useMemo, useState } from 'react'
import { captureVideoFrame } from './ImageAdjuster'

type Props = {
  file: File
  onCancel: () => void
  onDone: (file: File, cover: Blob | null) => void
}

export default function VideoAdjuster({ file, onCancel, onDone }: Props) {
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [cover, setCover] = useState<Blob | null>(null)
  const [coverUrl, setCoverUrl] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  useEffect(() => {
    return () => { if (coverUrl) URL.revokeObjectURL(coverUrl) }
  }, [coverUrl])

  const capture = async (t: number) => {
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
  }

  const label = useMemo(() => {
    const n = Math.max(0, Math.round(time))
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
  }, [time])

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col text-white">
      <header className="h-16 shrink-0 px-4 flex items-center justify-between border-b border-white/10">
        <button type="button" onClick={onCancel} className="min-w-11 min-h-11 text-sm font-bold">Cancel</button>
        <div className="text-center"><p className="text-[10px] uppercase tracking-[.16em] text-white/50">Harvest Family</p><p className="text-sm font-extrabold">Edit video</p></div>
        <button type="button" onClick={() => onDone(file, cover)} className="min-w-11 min-h-11 text-sm font-extrabold">Done</button>
      </header>
      <main className="flex-1 min-h-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-xl aspect-[9/16] max-h-full rounded-3xl overflow-hidden bg-neutral-950">
          <video src={url} controls playsInline preload="metadata" className="w-full h-full object-contain" onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} />
          {coverUrl && <div className="absolute left-3 bottom-3 rounded-xl overflow-hidden border border-white/30 w-20 aspect-[9/16] pointer-events-none"><img src={coverUrl} alt="" className="w-full h-full object-cover" /></div>}
        </div>
      </main>
      <section className="shrink-0 border-t border-white/10 bg-[#141210] px-4 pt-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
        <div className="flex items-center justify-between mb-2"><p className="text-xs font-bold">Cover frame</p><span className="text-[11px] text-white/50">{label}</span></div>
        <input type="range" min={0} max={Math.max(duration, 0.01)} step={0.05} value={time} onChange={e => { const t = Number(e.target.value); setTime(t) }} onPointerUp={() => void capture(time)} onKeyUp={() => void capture(time)} className="w-full accent-white" aria-label="Choose video cover frame" />
        <div className="flex items-center justify-between mt-3 gap-2">
          <button type="button" onClick={() => void capture(0.1)} className="px-3 py-2 rounded-xl bg-white/10 text-xs font-bold">First frame</button>
          <button type="button" onClick={() => void capture(Math.max(duration / 2, 0.1))} className="px-3 py-2 rounded-xl bg-white/10 text-xs font-bold">Middle</button>
          <button type="button" onClick={() => void capture(Math.max(duration - 0.1, 0.1))} className="px-3 py-2 rounded-xl bg-white/10 text-xs font-bold">Last frame</button>
        </div>
        <p className="text-[10px] text-white/40 text-center mt-3">Swipe the slider to choose the cover · video stays unchanged</p>
      </section>
    </div>
  )
}
