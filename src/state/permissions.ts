import type { Role } from './auth'

export type ContentType = 'post' | 'story' | 'video' | 'music' | 'announcement'
export type Destination = 'community' | 'group' | 'ministry' | 'worship' | 'official'

export type HarvestUser = {
  role: Role
  verified?: boolean
}

/**
 * Three real user types:
 * - member: normal Harvest member
 * - verified member: trusted member; never an admin
 * - admin: church/platform authority
 *
 * `verified` is intentionally separate from `role` so a verified account
 * cannot accidentally inherit admin privileges.
 */
export function userType(user: HarvestUser): 'member' | 'verified' | 'admin' | 'guest' {
  if (user.role === 'admin') return 'admin'
  if (user.role === 'member' && user.verified) return 'verified'
  if (user.role === 'member') return 'member'
  return 'guest'
}

export function canCreateContent(user: HarvestUser, type: ContentType): boolean {
  const kind = userType(user)
  if (kind === 'admin') return true
  if (kind === 'verified') return type !== 'announcement'
  if (kind === 'member') return type === 'post' || type === 'story' || type === 'video'
  return false
}

export function canPublishDirectly(user: HarvestUser, type: ContentType, destination: Destination): boolean {
  const kind = userType(user)
  if (kind === 'admin') return true
  if (kind === 'verified') return destination !== 'official' && type !== 'announcement'
  return false
}

export function canSubmitForApproval(user: HarvestUser, type: ContentType, destination: Destination): boolean {
  if (userType(user) === 'guest') return false
  if (userType(user) === 'admin') return true
  if (type === 'announcement' || destination === 'official') return false
  return canCreateContent(user, type)
}

export function allowedDestinations(user: HarvestUser, type: ContentType): Destination[] {
  const kind = userType(user)
  if (kind === 'admin') return ['community', 'group', 'ministry', 'worship', 'official']
  if (kind === 'verified') {
    if (type === 'music') return ['community', 'worship']
    return ['community', 'group', 'ministry']
  }
  if (kind === 'member') {
    if (type === 'music' || type === 'announcement') return []
    return ['community', 'group']
  }
  return []
}

export function canManageContent(user: HarvestUser): boolean {
  return userType(user) === 'admin'
}
