import { useEffect, useState } from 'react'

type Props = {
  src?: string | null
  alt?: string
  className?: string
  fallbackIcon?: string
}

export default function MediaThumbnail({ src, alt = '', className = '', fallbackIcon = '🖼️' }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(!src)

  return (
    <div className="relative overflow-hidden bg-[#F4E8D0]">
      {!loaded && !failed && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/10 via-white/20 to-white/5" aria-hidden />}
      {failed ? (
        <div className={`flex items-center justify-center ${className}`} role="img" aria-label="Media preview unavailable">
          <div className="text-center"><div className="text-3xl" aria-hidden>{fallbackIcon}</div><p className="mt-1 text-[10px] font-semibold text-black/45">Preview unavailable</p></div>
        </div>
      ) : (
        <img src={src!} alt={alt} loading="lazy" className={className} onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }} />
      )}
    </div>
  )
}