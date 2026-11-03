import { useState, type ReactNode } from 'react'
import { Icon } from '../ui'

type Props = {
  src?: string | null
  alt?: string
  className?: string
  /** Shown when the image is missing or fails to load — an icon, not an emoji. */
  fallbackIcon?: ReactNode
}

export default function MediaThumbnail({ src, alt = '', className = '', fallbackIcon = <Icon name="camera" size={28} /> }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(!src)

  return (
    <div className="relative overflow-hidden bg-surface-sunken">
      {!loaded && !failed && <div className="absolute inset-0 animate-pulse bg-surface-sunken" aria-hidden />}
      {failed ? (
        <div className={`flex items-center justify-center ${className}`} role="img" aria-label="Media preview unavailable">
          <div className="text-center text-ink-subtle"><div aria-hidden>{fallbackIcon}</div><p className="mt-1 text-2xs font-semibold">Preview unavailable</p></div>
        </div>
      ) : (
        <img src={src!} alt={alt} loading="lazy" className={className} onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }} />
      )}
    </div>
  )
}