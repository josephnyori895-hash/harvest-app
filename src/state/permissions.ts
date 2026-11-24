import type { Role } from './auth'

export type ContentType = 'post' | 'story' | 'video' | 'music' | 'sermon' | 'announcement'

export type HarvestUser = {
  role: Role
  verified?: boolean
}

/**
 * Upload policy (enforced identically by the server):
 * - stories: EVERY signed-in member — they expire after 24 hours.
 * - posts, reels/videos, music, sermons: verified members + admin.
 * - announcements: admin only.
 * Unverified members are pointed to stories (or admin verification).
 */
function userType(user: HarvestUser): 'member' | 'verified' | 'admin' | 'guest' {
  if (user.role === 'admin') return 'admin'
  if (user.role === 'member' && user.verified) return 'verified'
  if (user.role === 'member') return 'member'
  return 'guest'
}

export function canCreateContent(user: HarvestUser, type: ContentType): boolean {
  const kind = userType(user)
  if (kind === 'admin') return true
  if (type === 'story') return kind === 'member' || kind === 'verified'
  if (type === 'announcement') return false
  return kind === 'verified'
}
