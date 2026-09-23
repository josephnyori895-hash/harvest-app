import { useEffect, useRef, useState } from 'react'

// Instagram-style video tile: paints the video's first frame onto a <canvas>.
//
// Why not a plain <video>? Android WebView renders its huge native play-glyph
// poster for video elements without a poster attribute, and iOS Safari shows a
// blank box — even with #t= fragments. So the <video> here stays INVISIBLE
// (1px, opacity 0) and only feeds frames to the canvas that the user sees.
// The native glyph physically cannot appear.
//
// With `playable`, tapping the tile swaps in a real <video controls autoplay>.
export default function VideoThumb({ src, playable = false, className = '' }: { src: string; playable?: boolean; className?: string }) {
  const vidRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const drawn = useRef(false)

  useEffect(() => {
    drawn.current = false
    setFailed(false)
    setPlaying(false)
    const v = vidRef.current
    const c = canvasRef.current
    if (!v || !c) return
    let done = false
    const draw = () => {
      if (done || !v.videoWidth) return
      try {
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d')
        if (!ctx) return
        // drawImage works cross-origin (the canvas just becomes "tainted",
        // which only blocks pixel READS we never do).
        ctx.drawImage(v, 0, 0)
        done = true
        drawn.current = true
      } catch { /* frame not ready yet — another event will fire */ }
    }
    const onLoadedData = () => {
      // Seek slightly in to guarantee a decodable, non-black frame.
      try {
        const target = Math.min(0.4, (v.duration || 1) * 0.1)
        if (Number.isFinite(target)) v.currentTime = target
        else draw()
      } catch { draw() }
    }
    const onSeeked = () => draw()
    const onError = () => setFailed(true)
    v.addEventListener('loadeddata', onLoadedData)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('error', onError)
    // Safety: if no frame lands within 6s (slow network), fall back gracefully.
    const t = window.setTimeout(() => { if (!drawn.current) setFailed(true) }, 6000)
    return () => {
      v.removeEventListener('loadeddata', onLoadedData)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('error', onError)
      window.clearTimeout(t)
    }
  }, [src])

  if (playing) {
    return <video src={src} controls autoPlay playsInline className={`w-full h-full object-cover bg-black ${className}`} />
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${playable ? 'cursor-pointer' : ''} ${className}`}
      onClick={playable ? (e) => { e.stopPropagation(); setPlaying(true) } : undefined}
      role={playable ? 'button' : undefined}
      aria-label={playable ? 'Play video' : undefined}
    >
      <canvas ref={canvasRef} className={`w-full h-full object-cover ${failed ? 'hidden' : ''}`} />
      {failed && <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-900 flex items-center justify-center text-2xl">🎥</div>}
      <video
        ref={vidRef}
        src={`${src}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="absolute w-px h-px opacity-0 pointer-events-none"
        aria-hidden
      />
    </div>
  )
}
