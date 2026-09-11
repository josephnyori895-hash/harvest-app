import React, { useEffect, useState } from 'react'
import { useAuth, type Role } from '../state/auth'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const USE_API = import.meta.env.VITE_USE_API === 'true'

export function RequireRole({ role, children, fallback }: { role: Role; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { role: cur, login, isAdmin, username, setRole, setUsername } = useAuth()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(USE_API)

  const needAdmin = role === 'admin'
  const localOk = needAdmin ? isAdmin : cur !== 'guest'

  useEffect(() => {
    if (!USE_API) { setChecking(false); return }
    const token = localStorage.getItem('harvest_token') || ''
    if (!token) { setChecking(false); return }
    let cancelled = false
    fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error('session expired')
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        if (!data.user) throw new Error('session expired')
        setUsername(data.user.username)
        setRole(data.role as Role)
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem('harvest_token')
        setRole('guest')
        setErr('Session expired — sign in again')
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [setRole, setUsername])

  const ok = USE_API ? (!checking && (needAdmin ? cur === 'admin' : cur !== 'guest')) : localOk
  if (ok) return <>{children}</>
  if (checking) {
    return <div className="min-h-[50vh] flex items-center justify-center text-sm text-neutral-500">Checking your access…</div>
  }

  const tryLogin = async () => {
    const trimmed = pin.trim()
    if (!trimmed) { setErr('Enter PIN'); return }

    if (USE_API) {
      const uname = username || localStorage.getItem('harvest_username') || ''
      if (!uname) { setErr('Enter your username before unlocking'); return }
      setErr('')
      try {
        const response = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: trimmed, username: uname }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.token) throw new Error(data.error || 'Login failed')
        localStorage.setItem('harvest_token', data.token)
        localStorage.setItem(`harvest_token_${data.username}`, data.token)
        setUsername(data.username)
        setRole(data.role as Role)
        setPin('')
        if (needAdmin && data.role !== 'admin') {
          setRole(data.role as Role)
          setErr('Administrator access is required')
        }
      } catch (e: any) {
        setErr(e?.message || 'Unable to sign in')
      }
      return
    }

    const isAdminLogin = login(trimmed)
    if (needAdmin && !isAdminLogin) {
      setErr('PIN invalid — admin access denied')
      return
    }
    setErr('')
    setPin('')
  }

  if (fallback) return <>{fallback}</>

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 flex items-center justify-center text-xl mb-3">🔒</div>
      <h2 className="font-bold text-lg">{needAdmin ? 'Admin access required' : 'Member access required'}</h2>
      <p className="text-sm text-zinc-400 mt-1 max-w-[300px]">
        {needAdmin ? 'Sign in with an administrator account to continue.' : 'Enter your account PIN to continue.'}
      </p>
      <div className="w-full max-w-[300px] mt-4 flex gap-2">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder="PIN"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-600"
          onKeyDown={e => e.key === 'Enter' && void tryLogin()}
        />
        <button onClick={() => void tryLogin()} className="px-5 py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-semibold">Unlock</button>
      </div>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      {!USE_API && <p className="text-[11px] text-zinc-600 mt-3">Offline demo mode</p>}
    </div>
  )
}
