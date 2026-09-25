import type { HTMLAttributes } from 'react'

export type UnreadBadgeProps = {
  count: number
  className?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'aria-label'>

/** Compact unread count used consistently across chat, group, and department surfaces. */
export default function UnreadBadge({ count, className = '', ...props }: UnreadBadgeProps) {
  const value = Math.max(0, Number(count) || 0)
  if (value <= 0) return null

  const display = value > 99 ? '99+' : String(value)
  const label = value > 99 ? '99 or more unread messages' : `${value} unread ${value === 1 ? 'message' : 'messages'}`

  return (
    <span
      {...props}
      role="status"
      aria-label={label}
      className={`inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-extrabold items-center justify-center border-2 border-stone-950 shadow-sm ${className}`}
    >
      {display}
    </span>
  )
}