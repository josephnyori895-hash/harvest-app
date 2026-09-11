import { useState } from 'react'
import { useAuth } from '../state/auth'

export default function UserListModal({ type, userId, users, onBack }: { type: string; userId: string; users: any[]; onBack: () => void }) {
  const { isAdmin } = useAuth()
  const [, setRefresh] = useState(0)
  const filteredUsers = users.filter(u => u.username !== userId)

  const handleToggleVerify = (username: string) => {
    if (!isAdmin) return
    const updated = users.map((u: any) => u.username === username ? { ...u, verified: !u.verified } : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    setRefresh(x => x + 1)
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const handleToggleAdmin = (username: string) => {
    if (!isAdmin) return
    const target = users.find((u: any) => u.username === username)
    if (!target || target.username === localStorage.getItem('harvest_username')) return
    const nextRole = target.role === 'admin' ? 'member' : 'admin'
    const updated = users.map((u: any) => u.username === username ? { ...u, role: nextRole } : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    setRefresh(x => x + 1)
    window.dispatchEvent(new Event('harvest:verified'))
  }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] flex flex-col">
      <div className="flex items-center gap-3 h-16 border-b border-[#E8DEC9] px-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
        <div><p className="text-[10px] uppercase tracking-widest text-[#766E63]">Harvest Family</p><h1 className="font-bold text-sm capitalize">{type}</h1></div>
        <span className="ml-auto text-xs bg-[#F3E8FF] text-[#5B21B6] px-2 py-1 rounded-full font-bold">{filteredUsers.length}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {filteredUsers.map((u: any) => (
          <div key={u.username} className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#E8DEC9]">
            <div className="flex gap-3 items-center min-w-0">
              <div className="w-10 h-10 rounded-full bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-sm font-bold">{u.username?.[0]?.toUpperCase() || 'H'}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{u.username} {u.verified && <span className="text-[#0F766E]" aria-label="Verified">✓</span>}</p>
                <p className="text-[11px] text-[#766E63]">{u.role === 'admin' ? 'Admin' : u.verified ? 'Verified member' : 'Member'} · {u.location || 'Nyeri'}</p>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => handleToggleVerify(u.username)} className="px-2.5 py-1.5 rounded-full bg-[#E6FFFA] text-[#0F766E] text-[10px] font-bold">{u.verified ? 'Unverify' : 'Verify'}</button>
                <button onClick={() => handleToggleAdmin(u.username)} className="px-2.5 py-1.5 rounded-full bg-[#F3E8FF] text-[#5B21B6] text-[10px] font-bold">{u.role === 'admin' ? 'Member' : 'Admin'}</button>
              </div>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && <p className="text-sm text-[#766E63] text-center py-8">No {type} yet</p>}
      </div>
    </div>
  )
}
