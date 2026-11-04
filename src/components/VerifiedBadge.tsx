import { useId } from 'react'

// The verified seal. One component everywhere — profile headers, comments,
// chat rows, member lists — so the mark is always identical and always crisp
// from 12px inline text up to a 28px profile header.
//
// Design rules:
//   * brand purple gradient, never flat blue/green — verification is a church
//     trust mark, not a generic social-network check;
//   * a hairline inner ring keeps the seal readable on both light and dark
//     surfaces;
//   * the tick is a stroked path, not a filled blob, so it stays sharp at 12px.
export function VerifiedBadge({
  size = 16,
  className = '',
  label = 'Verified account',
}: {
  size?: number
  className?: string
  label?: string
}) {
  // useId keeps gradient ids unique: two badges in one DOM would otherwise
  // share (and can break) the same paint server on some WebViews.
  const rawId = useId()
  const gradientId = `verified-seal-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`inline-block shrink-0 align-[-0.16em] ${className}`}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={gradientId} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="0.45" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
      {/* Scalloped seal */}
      <path
        fill={`url(#${gradientId})`}
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
      />
      {/* Inner ring + top highlight */}
      <circle cx="12" cy="12" r="8.35" fill="none" stroke="#FFFFFF" strokeOpacity="0.34" strokeWidth="0.9" />
      <path d="M7.4 7.1a7.8 7.8 0 0 1 9.2 0" fill="none" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="0.9" strokeLinecap="round" />
      {/* Tick */}
      <path
        d="m7.5 12.15 2.85 2.9 6.2-6.2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default VerifiedBadge
