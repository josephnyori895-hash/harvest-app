import { useState } from 'react'
import { useAuth } from '../state/auth'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export default function UserListModal({ type, userId, users, onBack }: { type: string; userId: string; users: any[]; onBack: () => void }) {
  const { isAdmin, username: viewerName } = useAuth()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const filteredUsers = users.filter(u => u.username !== userId)

  const call = async (fn: string, method: string, body?: any) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const r = await fetch(`${API}${fn}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Update failed')
      window.dispatchEvent(new Event('harvest:verified'))
    } catch (e: any) {
      setMsg(e?.message || 'Update failed')
    } finally { setBusy(false) }
  }

  const handleToggleVerify = (u: any) => {
    if (!isAdmin) return
    void call(`/api/admin/verify/${encodeURIComponent(u.username)}`, 'POST', { verified: !u.verified })
  }

  const handleToggleAdmin = (u: any) => {
    if (!isAdmin) return
    if (u.username === viewerName) return
    void call(`/api/admin/users/${encodeURIComponent(u.username)}`, 'PATCH', { role: u.role === 'admin' ? 'member' : 'admin' })
  }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] flex flex-col">
      <div className="flex items-center gap-3 h-16 border-b border-[#E8DEC9] px-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
        <div><p className="text-[10px] uppercase tracking-widest text-[#766E63]">Harvest Family</p><h1 className="font-bold text-sm capitalize">{type}</h1></div>
        <span className="ml-auto text-xs bg-[#F3E8FF] text-[#5B21B6] px-2 py-1 rounded-full font-bold">{filteredUsers.length}</span>
      </div>

      {msg && <div role="alert" className="mx-4 mt-2 p-2 rounded-lg bg-rose-100 border border-rose-200 text-xs text-rose-700">{msg}</div>}

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {filteredUsers.map((u: any) => (
          <div key={u.username} className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E8DEC9]">
            <div className="flex gap-3 items-center min-w-0">
              <div className="w-10 h-10 rounded-full bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-sm font-bold">{String(u.username)?.[0]?.toUpperCase() || 'H'}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.name || u.username} {u.verified && <span className="text-[#0F766E]" aria-label="Verified">✓</span>}</p>
                <p className="text-[11px] text-[#766E63]">@{u.username} · {u.role === 'admin' ? 'Admin' : u.verified ? 'Verified member' : 'Member'}</p>
              </div>
            </div>
            {isAdmin && u.username !== viewerName && (
              <div className="flex gap-2 shrink-0">
                <button disabled={busy} onClick={() => handleToggleVerify(u)} className="px-2.5 py-1.5 rounded-full bg-[#E6FFFA] text-[#0F766E] text-[10px] font-bold disabled:opacity-50">{u.verified ? 'Unverify' : 'Verify'}</button>
                <button disabled={busy} onClick={() => handleToggleAdmin(u)} className="px-2.5 py-1.5 rounded-full bg-[#F3E8FF] text-[#5B21B6] text-[10px] font-bold disabled:opacity-50">{u.role === 'admin' ? 'Member' : 'Admin'}</button>
              </div>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && <p className="text-sm text-[#766E63] text-center py-8">No {type} yet</p>}
      </div>
    </div>
  )
}
