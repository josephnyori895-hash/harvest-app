// Capability grants: per-user powers beyond the base role, granted by the
// system admin to verified leaders (pastors, ministry heads).
// Powers: post_media, create_groups, manage_groups, manage_communities, delete_media
import { httpError } from './http.js'
import { query } from './db.js'

export const ALL_CAPS = ['post_media', 'create_groups', 'manage_groups', 'manage_communities', 'delete_media']

export function parseGrants(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw.split(',').map(s => s.trim()).filter(s => ALL_CAPS.includes(s))
}

export function hasCap(fresh, cap) {
  if (!fresh) return false
  if (fresh.role === 'admin') return true // system admin: all powers, always
  return parseGrants(fresh.grants).includes(cap)
}

// `fresh` must come from a fresh DB read that includes the grants column.
export function requireCap(fresh, cap, label) {
  if (!hasCap(fresh, cap)) {
    throw httpError(403, label || `not permitted — needs "${cap}" (granted by the admin)`)
  }
  return true
}

export async function getFreshUser(env, user) {
  if (!user?.id) return null
  const { rows } = await query(env, 'SELECT id, username, role, verified, active, grants FROM users WHERE id = ?', [user.id])
  return rows[0] || null
}
