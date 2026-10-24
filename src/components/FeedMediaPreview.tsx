// Consistent, bounded video preview for community feed cards.
// The poster and playback share one measured frame; media is never stretched.
import { useEffect, useRef, useState } from 'react'
import VideoThumb from './VideoThumb'

const MIN_RATIO = 4 / 5
const MAX_RATIO = 1.91
const clampRatio = (ratio: number) => Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO)

export default function FeedMediaPreview({ src, poster, alt = '' }: { src: string; poster?: string; alt?: string }) {
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

  const onMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (video.videoWidth > 0 && video.videoHeight > 0) setRatio(video.videoWidth / video.videoHeight)
  }
  const frameStyle = ratio ? { aspectRatio: String(clampRatio(ratio)) } : undefined
  const validPoster = Boolean(poster && !posterFailed)

  useEffect(() => {
    if (!playing) return
    const video = videoRef.current
    if (!video) return
    const result = video.play()
    if (result && typeof result.catch === 'function') result.catch(() => setVideoFailed(true))
  }, [playing, src])

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
        {videoFailed && <div className="absolute inset-x-0 bottom-0 bg-black/75 p-2 text-center text-xs text-white">Video could not be played. Check your connection and try again.</div>}
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
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPlaying(true) } }}
    >
      {validPoster
        ? <img src={poster} alt={alt} decoding="async" loading="lazy" className="block h-full max-h-[70vh] w-full object-contain mx-auto" />
        : <div className="aspect-[4/5] max-h-[70vh] w-full">
            {src
              ? <VideoThumb src={src} playable className="block h-full w-full object-contain" />
              : <div className="flex h-full w-full items-center justify-center text-4xl" aria-label="Video preview unavailable">🎥</div>}
          </div>}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow-lg">▶</span>
      </span>
    </div>
  )
}
