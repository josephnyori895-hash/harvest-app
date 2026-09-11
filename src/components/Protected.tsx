import React, { useState } from 'react'
import { useAuth, type Role } from '../state/auth'
import { login as apiLogin, useApi } from '../lib/api'

export function RequireRole({ role, children, fallback }: { role: Role; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { role: cur, login, isAdmin, username, setRole } = useAuth()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const needAdmin = role === 'admin'
  const ok = needAdmin ? isAdmin : cur !== 'guest'

  if (ok) return <>{children}</>

  const tryLogin = async () => {
    const trimmed = pin.trim()
    if (!trimmed) {
      setErr('Enter PIN')
      return
    }

    if (useApi()) {
      if (!username) {
        setErr('Complete your account setup before unlocking this area')
        return
      }
      setBusy(true)
      setErr('')
      try {
        const data = await apiLogin(username, trimmed)
        localStorage.setItem('harvest_token', data.token)
        localStorage.setItem('harvest_username', data.username)
        localStorage.setItem('harvest_role', data.role)
        setRole(data.role)
        window.dispatchEvent(new Event('harvest:auth'))
      } catch (error) {
        setErr(error instanceof Error ? error.message : 'Authentication failed')
      } finally {
        setBusy(false)
      }
      return
    }

    const isAdminLogin = login(trimmed)
    if (needAdmin && !isAdminLogin) {
      setErr('Admin authentication failed')
      return
    }
    setErr('')
  }

  if (fallback) return <>{fallback}</>

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 flex items-center justify-center text-xl mb-3">🔒</div>
      <h2 className="font-bold text-lg">{needAdmin ? 'Admin authentication required' : 'Authentication required'}</h2>
      <p className="text-sm text-zinc-400 mt-1 max-w-[280px]">
        {needAdmin ? 'Sign in with an account that has the admin role.' : 'Enter your account PIN to continue.'}
      </p>
      <div className="w-full max-w-[280px] mt-4 flex gap-2">
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder="PIN"
          autoComplete="current-password"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-600"
          onKeyDown={e => e.key === 'Enter' && !busy && tryLogin()}
          disabled={busy}
        />
        <button onClick={tryLogin} disabled={busy} className="px-5 py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-semibold disabled:opacity-50">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      <p className="text-[11px] text-zinc-600 mt-3">Your role is verified by the server when API mode is enabled.</p>
    </div>
  )
}
