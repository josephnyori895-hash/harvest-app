// IG-style relative timestamps for user-facing date displays.
export function timeAgo(iso?: string): string {
  if (!iso) return 'Just now'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const dt = new Date(iso)
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
