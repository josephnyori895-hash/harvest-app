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
