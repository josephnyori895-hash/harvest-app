// Twitter-style verification: a scalloped blue seal with a white tick, drawn as
// SVG so it stays crisp at 12px in a comment or 24px on a profile header.
// One component everywhere — no more text "✓" standing in for a badge.
export function VerifiedBadge({
  size = 16,
  className = '',
  label = 'Verified account',
}: {
  size?: number
  className?: string
  label?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`inline-block shrink-0 align-[-0.145em] text-[#1D9BF0] ${className}`}
      fill="currentColor"
    >
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z" />
      <path
        fill="#fff"
        d="M10.6 15.7l-3-3a.75.75 0 111.06-1.06l1.94 1.94 4.74-4.74a.75.75 0 111.06 1.06l-5.27 5.27a.75.75 0 01-1.06 0z"
      />
    </svg>
  )
}

export default VerifiedBadge
