// src/components/FeedMediaPreview.tsx — reel/video preview used by feed cards.
// IG geometry: media keeps its natural ratio, clamped between 4:5 (tallest)
// and 1.91:1 (widest). Inside the clamp it fits exactly; outside, the overflow
// is center-cropped (object-cover). Never stretched, never letterboxed.

import { useEffect, useState } from 'react'
import VideoThumb from './VideoThumb'

const MIN_RATIO = 4 / 5
const MAX_RATIO = 1.91
const clamp = (r: number) => String(Math.min(Math.max(r, MIN_RATIO), MAX_RATIO))

export default function FeedMediaPreview({ src, poster, alt = '' }: { src: string; poster?: string; alt?: string }) {
  const [playing, setPlaying] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)
  const [videoRatio, setVideoRatio] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setPosterReady(false); setPosterFailed(false); setRatio(null)
    if (!poster) return () => { cancelled = true }
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => { if (!cancelled) { setRatio(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null); setPosterReady(true) } }
    img.onerror = () => { if (!cancelled) setPosterFailed(true) }
    img.src = poster
    return () => { cancelled = true; img.onload = null; img.onerror = null }
  }, [poster])

  // No poster available: measure the video itself instead.
  const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (v.videoWidth && v.videoHeight) setVideoRatio(v.videoWidth / v.videoHeight)
  }

  const usePoster = Boolean(poster && posterReady && !posterFailed)
  const effective = ratio ?? videoRatio
  const frame = effective ? { aspectRatio: clamp(effective) } : undefined

  const mediaWrapper = 'relative w-full overflow-hidden bg-[#F4E8D0] cursor-pointer'

  if (playing) {
    return frame ? (
      <div className="relative w-full overflow-hidden bg-black" style={frame}>
        <video src={src} controls autoPlay playsInline className="w-full h-full object-cover" aria-label="Video" />
      </div>
    ) : (
      <video src={src} controls autoPlay playsInline onLoadedMetadata={onMeta} className="w-full h-auto bg-black" aria-label="Video" />
    )
  }

  return (
    <div
      className={mediaWrapper}
      style={frame}
      onClick={() => setPlaying(true)}
      role="button"
      aria-label="Play video"
    >
      {usePoster
        ? <img src={poster!} alt={alt} decoding="async" fetchPriority="high" className={frame ? 'w-full h-full object-cover' : 'w-full h-auto block'} />
        : <div className="aspect-[4/5] max-h-[80vh] w-full">
            {src
              ? <VideoThumb src={src} playable className="w-full h-full block" />
              : <div className="w-full h-full flex items-center justify-center text-4xl" aria-label="Video preview unavailable">🎥</div>}
          </div>}
      <span className="absolute inset-0 pointer-events-none flex items-center justify-center"><span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-2xl text-white">▶</span></span>
    </div>
  )
}
