// Consistent, bounded video preview for community feed cards.
// One stage machine owns loading, preview, playback and failure — the poster,
// the captured-frame fallback and the player share one measured frame, and a
// single retry path resets whichever leg failed. Media is never stretched.
import { useEffect, useRef, useState } from 'react'
import VideoThumb from './VideoThumb'

const MIN_RATIO = 0.5
const MAX_RATIO = 1.91
const clampRatio = (ratio: number) => Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO)
// iOS Safari (and a few Android WebViews) play HLS natively in <video>;
// Chromium cannot — surface that instead of a dead player (P1 don't-assume).
const HLS_T = 'application/vnd.apple.mpegurl'
const HLS_HINT = 'This stream format may not be supported on this device'
const isHls = (u: string) => /(\.m3u8)(\?|&|#|$)/i.test(u)
const nativeHls = () => {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('video')
  return probe.canPlayType(HLS_T) !== ''
}

export default function FeedMediaPreview({ src, poster, alt = '' }: { src: string; poster?: string; alt?: string }) {
  const hls = Boolean(src && isHls(src))
  const [playing, setPlaying] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)
  const [posterFailed, setPosterFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let active = true
    setRatio(null)
    setPosterFailed(false)
    setVideoFailed(false)
    setPlaying(false)
    if (!poster) return () => { active = false }
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (active && image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight)
    }
    image.onerror = () => { if (active) setPosterFailed(true) }
    image.src = poster
    return () => { active = false; image.onload = null; image.onerror = null }
  }, [poster, src])

  const onMetadata = (event: import('react').SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (video.videoWidth > 0 && video.videoHeight > 0) setRatio(video.videoWidth / video.videoHeight)
  }
  // Constrain the stage to the media's natural ratio. Portrait media should not
  // sit in a full-width empty stage on desktop; on small screens it fills width.
  const boundedRatio = ratio ? clampRatio(ratio) : null
  const frameStyle = boundedRatio
    ? { aspectRatio: String(boundedRatio), width: `min(100%, ${Math.round(boundedRatio * 70)}vh)` }
    : { width: '100%' }
  const validPoster = Boolean(poster && !posterFailed)
  // Browsers/WebViews can refuse a sound-on play() even after a tap. Retry
  // muted (controls stay visible so the member can raise the volume) instead
  // of declaring the video broken.
  const playWithMutedFallback = () => {
    const video = videoRef.current
    if (!video) return
    const result = video.play()
    if (!result || typeof result.catch !== 'function') return
    result.catch(() => {
      if (video.muted) { setVideoFailed(true); return }
      video.muted = true
      const retry = video.play()
      if (retry && typeof retry.catch === 'function') retry.catch(() => setVideoFailed(true))
    })
  }
  const retryPlayback = () => {
    setVideoFailed(false)
    videoRef.current?.load()
    playWithMutedFallback()
  }

  useEffect(() => { if (playing) playWithMutedFallback() }, [playing, src])

  if (playing) {
    return (
      <div className="relative mx-auto w-full max-h-[70vh] overflow-hidden bg-[#F4E8D0]" style={frameStyle}>
        <video
          ref={videoRef}
          src={src}
          poster={validPoster ? poster : undefined}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onLoadedMetadata={onMetadata}
          onError={() => setVideoFailed(true)}
          className="block h-full max-h-[70vh] w-full object-contain"
          aria-label="Video playback"
        />
        {videoFailed && (
          <div className="absolute inset-x-0 bottom-0 bg-black/75 p-2 text-center text-xs text-white">
            <p>{hls && !nativeHls() ? HLS_HINT : 'Video could not be played. Check your connection and try again.'}</p>
            <button type="button" onClick={retryPlayback} className="mt-1 min-h-11 rounded-xl border border-white/15 bg-white/10 px-4 font-semibold" aria-label="Retry video playback">Retry</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative mx-auto w-full max-h-[70vh] overflow-hidden bg-[#F4E8D0] cursor-pointer"
      style={frameStyle}
      onClick={() => { setVideoFailed(false); setPlaying(true) }}
      role="button"
      tabIndex={0}
      aria-label="Play video"
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setVideoFailed(false); setPlaying(true) } }}
    >
      {validPoster
        ? <img src={poster} alt={alt} decoding="async" loading="lazy" className="block h-full max-h-[70vh] w-full object-contain mx-auto" />
        : <div className="aspect-[4/5] max-h-[70vh] w-full">
            {/* No poster: capture a real frame on a canvas. A bare <video> here
                painted black (Chromium) or the native play glyph (WebView). */}
            {src
              ? <VideoThumb src={src} className="h-full w-full" />
              : <div className="flex h-full w-full items-center justify-center text-4xl" aria-label="Video preview unavailable">🎥</div>}
          </div>}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow-lg">▶</span>
      </span>
    </div>
  )
}
