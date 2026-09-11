import React, { createContext, useContext, useState, useCallback } from 'react'

export type Role = 'member' | 'leader' | 'admin' | 'guest'

// Authentication authority is moving to the backend. The offline adapter can retain
// a local member session for development, but it must never manufacture an admin role.
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
  const [username, setUsernameState] = useState<string>(() => localStorage.getItem(LS_USERNAME) ?? '')
  const [role, setRoleState] = useState<Role>(() => {
    const storedRole = localStorage.getItem(LS_ROLE) as Role | null
    const storedUsername = localStorage.getItem(LS_USERNAME) ?? ''
    return storedRole && storedRole !== 'guest' ? storedRole : storedUsername ? 'member' : 'guest'
  })
  const [pin, setPinState] = useState<string>(() => localStorage.getItem(LS_PIN) ?? '')

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
    } else {
      localStorage.removeItem(LS_USERNAME)
    }
  }, [])

  const login = useCallback((p: string) => {
    const trimmed = p.trim()
    if (import.meta.env.VITE_USE_API === 'true' && trimmed) {
      console.warn('[auth] VITE_USE_API=true — use POST /api/auth/login for server authentication')
    }
    const nextRole: Role = trimmed ? 'member' : 'guest'
    setPinState(trimmed)
    setRole(nextRole)
    localStorage.setItem(LS_PIN, trimmed)
    localStorage.setItem(LS_ROLE, nextRole)
    if (username) localStorage.setItem(`harvest_token_${username}`, localStorage.getItem('harvest_token') || '')
    return false
  }, [setRole, username])

  const logout = useCallback(() => {
    setPinState('')
    setRole('guest')
    localStorage.removeItem(LS_PIN)
    localStorage.setItem(LS_ROLE, 'guest')
  }, [setRole])

  const isAdmin = role === 'admin'
  const isMember = role === 'member' || isAdmin

  return (
    <Ctx.Provider value={{ role, pin, username, isAdmin, isMember, login, logout, setUsername, setRole }}>
      {children}
    </Ctx.Provider>
  )
}

// Legacy offline follow/like persistence. These are temporary adapters and are not
// the authorization boundary for production data.
const LS_FOLLOWS_MAP = 'harvest_follows_map'
const LS_FOLLOWING_LEGACY = 'harvest_following'

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

const LS_LIKES = 'harvest_likes_table'
export function getLikesTable(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_LIKES)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
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
