// Consistent, bounded video preview for community feed cards.
// One stage machine owns loading, preview, playback and failure — the poster,
// the captured-frame fallback and the player share one measured frame, and a
// single retry path resets whichever leg failed. Media is never stretched.
import { useEffect, useRef, useState } from 'react'
import VideoThumb from './VideoThumb'
import { Icon } from '../ui'

// Feed photos keep the 4:5 portrait floor (FeedCard clamps them there, and the
// composer's cover crop is the ImageAdjuster contract). Video must not: a 9:16
// phone recording was clamped to 0.8, so a vertical clip lost its top and
// bottom in the feed. Video therefore keeps its natural portrait shape down to
// 9:16, and only taller-than-phone media is bounded so a post cannot collapse
// into a sliver.
const MIN_VIDEO_RATIO = 9 / 16 // 0.5625
const MAX_RATIO = 1.91
const clampRatio = (ratio: number) => Math.min(Math.max(ratio, MIN_VIDEO_RATIO), MAX_RATIO)
// A 9:16 frame at full post width is taller than 70vh on most phones, and the
// height clamp then crops exactly what the ratio fix just restored. Portrait
// video gets a taller stage; landscape keeps the shorter cap. Where a viewport
// is shorter than the natural frame (width / 0.5625), cover still trims a few
// percent rather than letterboxing — the edge-to-edge contract wins over bars.
const stageMaxHeight = (ratio: number | null) => (ratio && ratio < 1 ? '88vh' : '70vh')
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

export default function FeedMediaPreview({ src, poster, alt = '', autoPlay = false }: { src: string; poster?: string; alt?: string; autoPlay?: boolean }) {
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
  // Constrain the stage to the media's natural ratio, clamped to the same 4:5
  // window as photos so a post is one shape from top to bottom.
  const boundedRatio = ratio ? clampRatio(ratio) : null
  // Full-bleed and cropped: the stage spans the column and the video fills it.
  // No letterbox band, so there is no strip of any colour framing the post.
  const frameStyle = boundedRatio
    ? { aspectRatio: String(boundedRatio), width: '100%', maxHeight: stageMaxHeight(boundedRatio) }
    : { width: '100%', maxHeight: stageMaxHeight(null) }
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
  // IG-style scroll-driven autoplay: entering the viewport (ratio ≥ 0.6) flips
  // autoPlay on → playing=true → muted-safe play; leaving flips it off → poster.
  useEffect(() => {
    if (autoPlay) { setVideoFailed(false); setPlaying(true) } else { setPlaying(false) }
  }, [autoPlay])

  if (playing) {
    return (
      <div className="relative w-full overflow-hidden bg-surface-sunken" style={frameStyle}>
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
          className="block h-full w-full object-cover"
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
      className="relative w-full overflow-hidden bg-surface-sunken cursor-pointer"
      style={frameStyle}
      onClick={() => { setVideoFailed(false); setPlaying(true) }}
      role="button"
      tabIndex={0}
      aria-label="Play video"
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setVideoFailed(false); setPlaying(true) } }}
    >
      {validPoster
        ? <img src={poster} alt={alt} decoding="async" loading="lazy" className="block h-full w-full object-cover" />
        : <div className="aspect-[4/5] w-full">
            {/* No poster: capture a real frame on a canvas. A bare <video> here
                painted black (Chromium) or the native play glyph (WebView). */}
            {src
              ? <VideoThumb src={src} className="h-full w-full" />
              : <div className="flex h-full w-full items-center justify-center text-white/60" aria-label="Video preview unavailable"><Icon name="reels" size={34} /></div>}
          </div>}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg"><Icon name="play" size={26} className="fill-current" /></span>
      </span>
    </div>
  )
}
