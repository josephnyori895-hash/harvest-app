import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type Role = 'member' | 'leader' | 'admin' | 'guest'

// Admin PINs: DEV-only fallback for offline demo. Prod must use backend JWT — never rely on this array when VITE_USE_API=true.
// See server/middleware/auth.js ADMIN_PIN_HASHES (bcrypt). This fallback is stripped in production builds when USE_API=true.
const ADMIN_PINS: string[] = (import.meta.env.DEV && import.meta.env.VITE_USE_API !== 'true') ? ['7777', '0000', '7C3AED'] : []
const LS_ROLE = 'harvest_role'
const LS_PIN = 'harvest_pin'
const LS_USERNAME = 'harvest_username'

interface AuthCtx {
  role: Role
  pin: string
  username: string
  isAdmin: boolean
  isMember: boolean
  login: (pin: string) => boolean
  logout: () => void
  setUsername: (u: string) => void
  setRole: (r: Role) => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be inside AuthProvider')
  return v
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const s = localStorage.getItem(LS_ROLE) as Role | null
    return s ?? 'guest'
  })
  const [pin, setPinState] = useState<string>(() => localStorage.getItem(LS_PIN) ?? '')
  const [username, setUsernameState] = useState<string>(() => localStorage.getItem(LS_USERNAME) ?? '')

  const setRole = useCallback((r: Role) => {
    setRoleState(r)
    localStorage.setItem(LS_ROLE, r)
  }, [])

  const setUsername = useCallback((u: string) => {
    const prev = localStorage.getItem(LS_USERNAME) || ''
    const curTok = localStorage.getItem('harvest_token') || ''
    if (prev && curTok) localStorage.setItem(`harvest_token_${prev}`, curTok)
    setUsernameState(u)
    if (u) {
      localStorage.setItem(LS_USERNAME, u)
      const nextTok = localStorage.getItem(`harvest_token_${u}`) || ''
      if (nextTok) localStorage.setItem('harvest_token', nextTok)
      else localStorage.removeItem('harvest_token')
    } else localStorage.removeItem(LS_USERNAME)
  }, [])

  const login = useCallback((p: string) => {
    const trimmed = p.trim()
    // offline fallback only: when USE_API=true, admin must come from JWT (server/src/middleware/auth.js), not local PIN
    const isAdminOffline = ADMIN_PINS.length > 0 && ADMIN_PINS.includes(trimmed)
    if (import.meta.env.VITE_USE_API === 'true' && trimmed) {
      console.warn('[auth] VITE_USE_API=true — PIN login is offline fallback only; prefer POST /api/auth/login for JWT')
    }
    const r: Role = isAdminOffline ? 'admin' : trimmed ? 'member' : 'guest'
    setPinState(trimmed)
    setRole(r)
    localStorage.setItem(LS_PIN, trimmed)
    localStorage.setItem(LS_ROLE, r)
    if (username) localStorage.setItem(`harvest_token_${username}`, localStorage.getItem('harvest_token')||'')
    return isAdminOffline
  }, [setRole])

  const logout = useCallback(() => {
    setPinState('')
    setRole('guest')
    localStorage.removeItem(LS_PIN)
    localStorage.setItem(LS_ROLE, 'guest')
  }, [setRole])

  // sync on mount: if username exists but role guest, promote to member
  useEffect(() => {
    if (username && role === 'guest') {
      setRole('member')
    }
  }, []) // eslint-disable-line

  const isAdmin = role === 'admin'
  const isMember = role === 'member' || isAdmin

  return (
    <Ctx.Provider value={{ role, pin, username, isAdmin, isMember, login, logout, setUsername, setRole }}>
      {children}
    </Ctx.Provider>
  )
}

// helpers for follow mutual logic — stored as map: { viewerUsername: [followedUsernames] }
const LS_FOLLOWS_MAP = 'harvest_follows_map'
const LS_FOLLOWING_LEGACY = 'harvest_following'

export function getFollowsMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_FOLLOWS_MAP)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  // migrate legacy single array if present + username
  try {
    const legacy = localStorage.getItem(LS_FOLLOWING_LEGACY)
    const uname = localStorage.getItem(LS_USERNAME) || localStorage.getItem('harvest_users') && JSON.parse(localStorage.getItem('harvest_users')!).find((u: any) => u.me)?.username
    if (legacy && uname) {
      const arr: string[] = JSON.parse(legacy)
      return { [uname]: arr }
    }
  } catch { /* ignore */ }
  return {}
}

export function setFollowsMap(map: Record<string, string[]>) {
  localStorage.setItem(LS_FOLLOWS_MAP, JSON.stringify(map))
}

export function isFollowing(viewer: string, target: string): boolean {
  if (!viewer || !target) return false
  const map = getFollowsMap()
  return (map[viewer] ?? []).includes(target)
}

export function isMutual(viewer: string, target: string): boolean {
  if (!viewer || !target) return false
  if (viewer === target) return true
  const map = getFollowsMap()
  const a = (map[viewer] ?? []).includes(target)
  const b = (map[target] ?? []).includes(viewer)
  return a && b
}

export function toggleFollowMutual(viewer: string, target: string): Record<string, string[]> {
  const map = getFollowsMap()
  const arr = map[viewer] ?? []
  const next = arr.includes(target) ? arr.filter(x => x !== target) : [...arr, target]
  const updated = { ...map, [viewer]: next }
  setFollowsMap(updated)
  // keep legacy key in sync for current viewer for backward compat
  localStorage.setItem(LS_FOLLOWING_LEGACY, JSON.stringify(next))
  return updated
}

// likes table: persist Set of postKeys
const LS_LIKES = 'harvest_likes_table'
export function getLikesTable(): Record<string, boolean> {
  try {
    const s = localStorage.getItem(LS_LIKES)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}
export function setLikesTable(t: Record<string, boolean>) {
  localStorage.setItem(LS_LIKES, JSON.stringify(t))
}
export function toggleLikeKey(key: string): Record<string, boolean> {
  const tbl = getLikesTable()
  const next = { ...tbl, [key]: !tbl[key] }
  if (!next[key]) delete next[key]
  setLikesTable(next)
  return next
}
