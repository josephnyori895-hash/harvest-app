import { useState } from 'react'
import { Icon } from '../ui'

// TrackArt — one artwork tile for every music surface (worship rows, shelves,
// continue-listening, the mini player, the now-playing bar, feed music discs,
// chat/music pickers).
//
// Most church tracks are uploaded without cover art, so an icon-in-a-grey-box
// used to be the de-facto thumbnail. That reads as "no content". Instead every
// track gets a real thumbnail: the uploaded cover when there is one, otherwise
// deterministic generated artwork derived from the title — the same track
// always gets the same colours, on every screen and every device.

function hashHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

export default function TrackArt({
  src,
  title,
  className = '',
  iconSize = 18,
  spin,
}: {
  src?: string | null
  title?: string | null
  /** Sizing + rounding utilities only (h-*, w-*, rounded-*). */
  className?: string
  iconSize?: number
  /** Feed discs rotate while their song plays. */
  spin?: { playing: boolean }
}) {
  const [failed, setFailed] = useState(false)
  const spinClass = spin ? 'music-disc-spin' : ''
  const spinStyle = spin ? { animationPlayState: spin.playing ? 'running' as const : 'paused' as const } : undefined

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`object-cover ${spinClass} ${className}`.trim()}
        style={spinStyle}
      />
    )
  }

  const hue = hashHue(title || 'Harvest Worship')
  return (
    <span
      aria-hidden="true"
      data-generated-artwork
      className={`relative grid place-items-center overflow-hidden ${spinClass} ${className}`.trim()}
      style={{
        ...spinStyle,
        background: `linear-gradient(135deg, hsl(${hue} 42% 34%), hsl(${(hue + 42) % 360} 52% 18%))`,
      }}
    >
      <span className="absolute -right-3 -top-4 h-10 w-10 rounded-full bg-white/10" />
      <span className="absolute -bottom-4 -left-3 h-12 w-12 rounded-full bg-white/10" />
      <Icon name="music" size={iconSize} className="relative text-white/80" />
    </span>
  )
}
