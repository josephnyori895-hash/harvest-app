import React, { useState } from 'react'
import { useAuth, type Role } from '../state/auth'

export function RequireRole({ role, children, fallback }: { role: Role; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { role: cur, login, isAdmin } = useAuth()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  const needAdmin = role === 'admin'
  const ok = needAdmin ? isAdmin : cur !== 'guest'

  if (ok) return <>{children}</>

  const tryLogin = () => {
    const isAdminLogin = login(pin)
    if (needAdmin && !isAdminLogin) {
      setErr('PIN invalid — admin PIN is 7777 (demo) or 0000')
      return
    }
    if (!isAdminLogin && pin.trim() === '') {
      setErr('Enter PIN')
      return
    }
    setErr('')
  }

  if (fallback) return <>{fallback}</>

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 flex items-center justify-center text-xl mb-3">🔒</div>
      <h2 className="font-bold text-lg">{needAdmin ? 'Admin PIN required' : 'PIN required'}</h2>
      <p className="text-sm text-zinc-400 mt-1 max-w-[280px]">
        {needAdmin ? 'This area is for Harvest admins. Enter admin PIN to continue. Demo PIN: 7777' : 'Enter your PIN to continue'}
      </p>
      <div className="w-full max-w-[280px] mt-4 flex gap-2">
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder={needAdmin ? 'Admin PIN (7777)' : 'PIN'}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-600"
          onKeyDown={e => e.key === 'Enter' && tryLogin()}
        />
        <button onClick={tryLogin} className="px-5 py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-semibold">Unlock</button>
      </div>
      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      <p className="text-[11px] text-zinc-600 mt-3">Member PIN: any 4 digits • Admin: 7777 / 0000</p>
    </div>
  )
}
