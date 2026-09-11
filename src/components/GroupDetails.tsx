import { useState } from 'react'
import { useAuth } from '../state/auth'

export default function GroupDetails({ groupId, users, onBack, onSwitch }: { groupId: string; users: any[]; onBack: () => void; onSwitch: () => void }) {
  const { isAdmin } = useAuth()
  const groupUsers = users.filter((u: any) => (u.group || 'Harvest Nyeri') === groupId)
  const [addName, setAddName] = useState('')
  const handleAdd = () => {
    if (!addName.trim()) return
    const username = addName.trim().toLowerCase().replace(/\s+/g, '_')
    const exists = users.find((u: any) => u.username === username)
    if (exists) {
      const updated = users.map((u: any) => u.username === username ? { ...u, group: groupId, assignedGroupIds: [...(u.assignedGroupIds || []), groupId] } : u)
      localStorage.setItem('harvest_users', JSON.stringify(updated)); window.dispatchEvent(new Event('harvest:verified'))
    }
    setAddName('')
  }
  const handleRemove = (username: string) => { const updated = users.map((u: any) => u.username === username ? { ...u, group: 'Unassigned', assignedGroupIds: [] } : u); localStorage.setItem('harvest_users', JSON.stringify(updated)); window.dispatchEvent(new Event('harvest:verified')) }
  const handleToggleVerify = (username: string) => { const updated = users.map((u: any) => u.username === username ? { ...u, verified: !u.verified } : u); localStorage.setItem('harvest_users', JSON.stringify(updated)); window.dispatchEvent(new Event('harvest:verified')) }
  const handleToggleRole = (username: string) => { const roles: Record<string, string> = { member: 'leader', leader: 'admin', admin: 'member' }; const updated = users.map((u: any) => u.username === username ? { ...u, role: roles[u.role] || 'member' } : u); localStorage.setItem('harvest_users', JSON.stringify(updated)); window.dispatchEvent(new Event('harvest:verified')) }

  return <div className="bg-black text-white min-h-[70vh] flex flex-col overflow-x-hidden">
    <div className="flex items-center gap-3 min-h-[56px] border-b border-zinc-800 px-3 sm:px-4 sticky top-0 z-20 bg-black">
      <button type="button" onClick={onBack} aria-label="Back to groups" className="touch-target rounded-full text-2xl hover:bg-zinc-900">‹</button>
      <h1 className="font-bold text-sm truncate flex-1">{groupId}</h1>
      <span className="shrink-0 text-[10px] sm:text-xs bg-white text-black px-2 py-1 rounded-full">{groupUsers.length} members</span>
    </div>

    {isAdmin && <div className="p-3 sm:p-4 border-b border-zinc-800 space-y-2">
      <h3 className="text-xs font-bold text-amber-400">ADMIN CONTROLS</h3>
      <div className="flex gap-2">
        <input value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder="Add member username..." className="min-w-0 flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none" />
        <button type="button" onClick={handleAdd} className="touch-target px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold">Add</button>
      </div>
    </div>}

    <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-2 pb-6">
      {groupUsers.map((u: any) => <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800 min-w-0">
        <div className="w-10 h-10 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold">{u.username[0].toUpperCase()}</div>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 inline-flex items-center justify-center text-[8px]">✓</span>}</p><p className="text-[11px] text-zinc-400 truncate">{u.location || 'Nyeri'}</p></div>
        <div className="flex gap-1.5 items-center shrink-0 flex-wrap justify-end">
          <span className={`text-[9px] px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-purple-600 text-white' : u.role === 'leader' ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>{u.role || 'member'}</span>
          {isAdmin && <><button type="button" onClick={() => handleToggleVerify(u.username)} className="touch-target px-2 rounded-full bg-zinc-800 text-white text-[10px]" aria-label={u.verified ? `Unverify ${u.username}` : `Verify ${u.username}`}>{u.verified ? '✕' : '✓'}</button><button type="button" onClick={() => handleToggleRole(u.username)} className="min-h-11 px-2 rounded-full bg-zinc-800 text-white text-[10px]">role</button><button type="button" onClick={() => handleRemove(u.username)} className="min-h-11 px-2 rounded-full bg-red-900 text-white text-[10px]">remove</button></>}
        </div>
      </div>)}
      {groupUsers.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No members yet — admin can add one above.</p>}
    </div>
  </div>
}
