// src/components/FeedMediaPreview.tsx — reel/video preview used by feed cards.
// Natural aspect: the member's own media decides the height — no forced crop,
// no letterbox bars (IG-style). Tap to swap in controls + autoplay.

import { useEffect, useState } from 'react'
import VideoThumb from './VideoThumb'

export default function FeedMediaPreview({ src, poster, alt = '' }: { src: string; poster?: string; alt?: string }) {
  const [playing, setPlaying] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPosterReady(false); setPosterFailed(false)
    if (!poster) return () => { cancelled = true }
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => { if (!cancelled) setPosterReady(true) }
    img.onerror = () => { if (!cancelled) setPosterFailed(true) }
    img.src = poster
    return () => { cancelled = true; img.onload = null; img.onerror = null }
  }, [poster])

  if (playing) {
    return <video src={src} controls autoPlay playsInline className="w-full h-auto bg-black" aria-label="Video" />
  }

  const usePoster = Boolean(poster && posterReady && !posterFailed)
  return (
    <div
      className="relative w-full overflow-hidden bg-[#F4E8D0] cursor-pointer"
      onClick={() => setPlaying(true)}
      role="button"
      aria-label="Play video"
    >
      {usePoster
        ? <img src={poster!} alt={alt} decoding="async" fetchPriority="high" className="w-full h-auto block" />
        : <div className="aspect-[4/3]">
            {src
              ? <VideoThumb src={src} playable className="w-full h-full block" />
              : <div className="w-full h-full flex items-center justify-center text-4xl" aria-label="Video preview unavailable">🎥</div>}
          </div>}
      <span className="absolute inset-0 pointer-events-none flex items-center justify-center"><span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-2xl text-white">▶</span></span>
    </div>
  )
}
