// Browser-only persistence helpers for the legacy/offline demo adapter.
// These helpers are intentionally separate from auth.tsx so Fast Refresh can treat
// the auth module as a component/hook module without mixing in non-component exports.

const LS_FOLLOWS_MAP = 'harvest_follows_map'
const LS_FOLLOWING_LEGACY = 'harvest_following'
const LS_USERNAME = 'harvest_username'
const LS_LIKES = 'harvest_likes_table'

export function getFollowsMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_FOLLOWS_MAP)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore malformed local state */ }

  try {
    const legacy = localStorage.getItem(LS_FOLLOWING_LEGACY)
    const usersRaw = localStorage.getItem('harvest_users')
    const users = usersRaw ? JSON.parse(usersRaw) : []
    const uname = localStorage.getItem(LS_USERNAME) || users.find((u: any) => u?.me)?.username
    if (legacy && uname) {
      const arr: string[] = JSON.parse(legacy)
      return { [uname]: arr }
    }
  } catch { /* ignore malformed legacy state */ }

  return {}
}

export function setFollowsMap(map: Record<string, string[]>) {
  localStorage.setItem(LS_FOLLOWS_MAP, JSON.stringify(map))
}

export function isFollowing(viewer: string, target: string): boolean {
  if (!viewer || !target) return false
  return (getFollowsMap()[viewer] ?? []).includes(target)
}

export function isMutual(viewer: string, target: string): boolean {
  if (!viewer || !target) return false
  if (viewer === target) return true
  const map = getFollowsMap()
  return (map[viewer] ?? []).includes(target) && (map[target] ?? []).includes(viewer)
}

export function toggleFollowMutual(viewer: string, target: string): Record<string, string[]> {
  const map = getFollowsMap()
  const arr = map[viewer] ?? []
  const next = arr.includes(target) ? arr.filter(x => x !== target) : [...arr, target]
  const updated = { ...map, [viewer]: next }
  setFollowsMap(updated)
  localStorage.setItem(LS_FOLLOWING_LEGACY, JSON.stringify(next))
  return updated
}

export function getLikesTable(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_LIKES)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function setLikesTable(table: Record<string, boolean>) {
  localStorage.setItem(LS_LIKES, JSON.stringify(table))
}

export function toggleLikeKey(key: string): Record<string, boolean> {
  const table = getLikesTable()
  const next = { ...table, [key]: !table[key] }
  if (!next[key]) delete next[key]
  setLikesTable(next)
  return next
}
