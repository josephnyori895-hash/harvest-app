import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

// Exactly three Harvest account types: normal member, verified member, admin.
// Verified is deliberately separate from the authorization role.
const ADMIN_PINS: string[] = (import.meta.env.DEV && import.meta.env.VITE_USE_API !== 'true') ? ['7777', '0000', '7C3AED'] : []
const LS_ROLE = 'harvest_role'
const LS_USERNAME = 'harvest_username'
const LS_VERIFIED = 'harvest_verified'

function clearLegacyTokenCache() {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (key?.startsWith('harvest_token_')) localStorage.removeItem(key)
  }
}

interface AuthCtx {
  role: Role; pin: string; username: string; verified: boolean
  isAdmin: boolean; isVerified: boolean; isMember: boolean
  login: (pin: string) => boolean; logout: () => void
  setUsername: (u: string) => void; setRole: (r: Role) => void; setVerified: (v: boolean) => void
}
export type Role = 'member' | 'admin' | 'guest'
const Ctx = createContext<AuthCtx | null>(null)
export function useAuth(): AuthCtx { const v = useContext(Ctx); if (!v) throw new Error('useAuth must be inside AuthProvider'); return v }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => { const s = localStorage.getItem(LS_ROLE) as string | null; return s === 'leader' ? 'member' : ((s as Role) ?? 'guest') })
  const [username, setUsernameState] = useState(() => localStorage.getItem(LS_USERNAME) ?? '')
  const [verified, setVerifiedState] = useState(() => ['true', '1'].includes(localStorage.getItem(LS_VERIFIED) || ''))
  // PINs are never persisted. The backend/JWT is the production authority.
  const [pin, setPinState] = useState('')

  const setRole = useCallback((r: Role) => { setRoleState(r); localStorage.setItem(LS_ROLE, r) }, [])
  const setVerified = useCallback((v: boolean) => { setVerifiedState(v); localStorage.setItem(LS_VERIFIED, String(v)) }, [])

  const setUsername = useCallback((u: string) => {
    clearLegacyTokenCache()
    setUsernameState(u)
    if (!u) { localStorage.removeItem(LS_USERNAME); return }
    localStorage.setItem(LS_USERNAME, u)
    try {
      const users = JSON.parse(localStorage.getItem('harvest_users') || '[]')
      const account = users.find((x: any) => x.username === u)
      if (account) setVerifiedState(Boolean(account.verified)), localStorage.setItem(LS_VERIFIED, String(Boolean(account.verified)))
    } catch { /* server /me remains authoritative in API mode */ }
  }, [])

  const login = useCallback((p: string) => {
    const trimmed = p.trim()
    const isAdminOffline = ADMIN_PINS.length > 0 && ADMIN_PINS.includes(trimmed)
    const r: Role = isAdminOffline ? 'admin' : trimmed ? 'member' : 'guest'
    setPinState(trimmed)
    setRole(r)
    return isAdminOffline
  }, [setRole])

  const logout = useCallback(() => {
    setPinState('')
    setVerified(false)
    setRole('guest')
    localStorage.removeItem('harvest_token')
    clearLegacyTokenCache()
    localStorage.removeItem(LS_USERNAME)
    localStorage.removeItem('harvest_msgs')
    localStorage.removeItem('harvest_pinned_chats')
    localStorage.setItem(LS_ROLE, 'guest')
  }, [setRole, setVerified])

  useEffect(() => {
    if (localStorage.getItem(LS_ROLE) === 'leader') { setRole('member'); setVerified(true) }
    if (username && role === 'guest') setRole('member')
    if (username) {
      try { const account = JSON.parse(localStorage.getItem('harvest_users') || '[]').find((x: any) => x.username === username); if (account) setVerified(Boolean(account.verified)) } catch {}
    }
  }, [role, username, setRole, setVerified])

  const isAdmin = role === 'admin'
  const isMember = role === 'member' || isAdmin
  const isVerified = isAdmin || verified
  return <Ctx.Provider value={{ role, pin, username, verified, isAdmin, isVerified, isMember, login, logout, setUsername, setRole, setVerified }}>{children}</Ctx.Provider>
}

const LS_FOLLOWS_MAP = 'harvest_follows_map'
const LS_FOLLOWING_LEGACY = 'harvest_following'
export function getFollowsMap(): Record<string, string[]> {
  try { const raw = localStorage.getItem(LS_FOLLOWS_MAP); if (raw) return JSON.parse(raw) } catch {}
  try { const legacy = localStorage.getItem(LS_FOLLOWING_LEGACY); const uname = localStorage.getItem(LS_USERNAME) || (localStorage.getItem('harvest_users') && JSON.parse(localStorage.getItem('harvest_users')!).find((u: any) => u.me)?.username); if (legacy && uname) return { [uname]: JSON.parse(legacy) } } catch {}
  return {}
}
export function setFollowsMap(map: Record<string, string[]>) { localStorage.setItem(LS_FOLLOWS_MAP, JSON.stringify(map)) }
export function isFollowing(viewer: string, target: string) { return !!viewer && !!target && (getFollowsMap()[viewer] ?? []).includes(target) }
export function isMutual(viewer: string, target: string) { if (!viewer || !target) return false; if (viewer === target) return true; const map = getFollowsMap(); return (map[viewer] ?? []).includes(target) && (map[target] ?? []).includes(viewer) }
export function toggleFollowMutual(viewer: string, target: string): Record<string, string[]> { const map = getFollowsMap(); const arr = map[viewer] ?? []; const next = arr.includes(target) ? arr.filter(x => x !== target) : [...arr, target]; const updated = { ...map, [viewer]: next }; setFollowsMap(updated); localStorage.setItem(LS_FOLLOWING_LEGACY, JSON.stringify(next)); return updated }

const LS_LIKES = 'harvest_likes_table'
export function getLikesTable(): Record<string, boolean> { try { const s = localStorage.getItem(LS_LIKES); return s ? JSON.parse(s) : {} } catch { return {} } }
export function setLikesTable(t: Record<string, boolean>) { localStorage.setItem(LS_LIKES, JSON.stringify(t)) }
export function toggleLikeKey(key: string): Record<string, boolean> { const tbl = getLikesTable(); const next = { ...tbl, [key]: !tbl[key] }; if (!next[key]) delete next[key]; setLikesTable(next); return next }
