import { useEffect, useRef, useState } from 'react'

// Instagram-style video tile: paints the video's first frame onto a <canvas>.
//
// Why not a plain <video>? Android WebView renders its huge native play-glyph
// poster for video elements without a poster attribute, and iOS Safari shows a
// blank box — even with #t= fragments. So the <video> here stays INVISIBLE
// (1px, opacity 0) and only feeds frames to the canvas that the user sees.
// The native glyph physically cannot appear.
//
// Play state phase: the parent owns playback (FeedMediaPreview swaps in the
// real player). This tile is a pure VISUAL fallback: it draws one frame,
// reports its own failure upward, and exposes a retry bump so slow frames can
// simply be re-attempted.
const HLS_HINT = 'This stream format may not be supported on this device'

export default function VideoThumb({ src, className = '', onRetryBump, retryKey = 0, onResult }: {
  src: string
  className?: string
  /** Bumped by the parent to re-run the frame-capture attempt (Retry). */
  retryKey?: number
  /** Programmatic retry bump tap — the parent owns the retry counter. */
  onRetryBump?: () => void
  /** Optional callback reporting ready/failed so the feed card can react. */
  onResult?: (state: 'ok' | 'fail') => void
}) {
  const vidRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)
  const drawn = useRef(false)
  const isHls = /(\.m3u8)(\?|&|#|$)/i.test(src)

  useEffect(() => {
    drawn.current = false
    setFailed(false)
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
        onResult?.('ok')
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
    const onError = () => { setFailed(true); onResult?.('fail') }
    v.addEventListener('loadeddata', onLoadedData)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('error', onError)
    // Safety: if no frame lands within 6s (slow network), fall back gracefully.
    const t = window.setTimeout(() => { if (!drawn.current) { setFailed(true); onResult?.('fail') } }, 6000)
    return () => {
      v.removeEventListener('loadeddata', onLoadedData)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('error', onError)
      window.clearTimeout(t)
    }
  }, [src, retryKey, onResult])

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className={`w-full h-full object-cover ${failed ? 'hidden' : ''}`} />
      {failed && (
        <div className="absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-900 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-2xl" aria-hidden>🎥</span>
          <p className="text-[11px] text-stone-300">{isHls ? HLS_HINT : 'Preview could not load'}</p>
          {onRetryBump && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onRetryBump() }} className="min-h-11 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white" aria-label="Retry video preview">Retry</button>
          )}
        </div>
      )}
      <video
        key={retryKey}
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
