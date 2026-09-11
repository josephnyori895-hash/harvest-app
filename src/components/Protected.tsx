import React, { useEffect, useState } from 'react'
import { useAuth, type Role } from '../state/auth'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const USE_API = import.meta.env.PROD ? import.meta.env.VITE_USE_API !== 'false' : import.meta.env.VITE_USE_API === 'true'

export function RequireRole({ role, children, fallback }: { role: Role; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { role: cur, login, username, setRole, setUsername, setVerified } = useAuth()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(USE_API)
  const needAdmin = role === 'admin'
  const localOk = needAdmin ? cur === 'admin' : cur !== 'guest'

  useEffect(() => {
    if (!USE_API) { setChecking(false); return }
    const token = localStorage.getItem('harvest_token') || ''
    if (!token) { setChecking(false); return }
    let cancelled = false
    fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => { if (!r.ok) throw new Error('session expired'); return r.json() })
      .then(data => {
        if (cancelled) return
        if (!data.user) throw new Error('session expired')
        setUsername(data.user.username); setRole(data.role as Role); setVerified(Boolean(data.user.verified))
      })
      .catch(() => { if (!cancelled) { localStorage.removeItem('harvest_token'); setRole('guest'); setVerified(false); setErr('Session expired — sign in again') } })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [setRole, setUsername, setVerified])

  const ok = USE_API ? (!checking && (needAdmin ? cur === 'admin' : cur !== 'guest')) : localOk
  if (ok) return <>{children}</>
  if (checking) return <div className="min-h-[50vh] flex items-center justify-center text-sm text-[#766E63]">Checking your access…</div>

  const tryLogin = async () => {
    const trimmed = pin.trim()
    if (!trimmed) { setErr('Enter PIN'); return }
    if (USE_API) {
      const uname = username || localStorage.getItem('harvest_username') || ''
      if (!uname) { setErr('Enter your username before unlocking'); return }
      setErr('')
      try {
        const response = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: trimmed, username: uname }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.token) throw new Error(data.error || 'Login failed')
        localStorage.setItem('harvest_token', data.token); localStorage.setItem(`harvest_token_${data.username}`, data.token)
        setUsername(data.username); setRole(data.role as Role); setVerified(Boolean(data.verified)); setPin('')
        if (needAdmin && data.role !== 'admin') setErr('Administrator access is required')
      } catch (e: any) { setErr(e?.message || 'Unable to sign in') }
      return
    }
    const isAdminLogin = login(trimmed)
    if (needAdmin && !isAdminLogin) { setErr('PIN invalid — admin access denied'); return }
    setErr(''); setPin('')
  }

  if (fallback) return <>{fallback}</>
  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center text-xl mb-3">🔒</div>
      <h2 className="font-bold text-lg">{needAdmin ? 'Admin access required' : 'Member access required'}</h2>
      <p className="text-sm text-[#766E63] mt-1 max-w-[300px]">{needAdmin ? 'Sign in with an administrator account to continue.' : 'Enter your account PIN to continue.'}</p>
      <div className="w-full max-w-[300px] mt-4 flex gap-2"><input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" className="flex-1 bg-white border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" onKeyDown={e => e.key === 'Enter' && void tryLogin()} /><button onClick={() => void tryLogin()} className="px-5 py-3 rounded-2xl bg-[#7C3AED] text-white text-sm font-semibold">Unlock</button></div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      {!USE_API && <p className="text-[11px] text-[#766E63] mt-3">Offline demo mode</p>}
    </div>
  )
}
