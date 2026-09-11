import { useState } from 'react'
import { useAuth } from '../state/auth'

export default function GroupDetails({ groupId, users, onBack, onSwitch }: { groupId: string; users: any[]; onBack: () => void; onSwitch: () => void }) {
  const { isAdmin, role } = useAuth()
  const groupUsers = users.filter((u: any) => (u.group || 'Harvest Nyeri') === groupId)
  const [addName, setAddName] = useState('')

  const handleAdd = () => {
    if (!addName.trim()) return
    const username = addName.trim().toLowerCase().replace(/\s+/g, '_')
    const exists = users.find((u: any) => u.username === username)
    if (exists) {
      const updated = users.map((u: any) => u.username === username ? {...u, group: groupId, assignedGroupIds: [...(u.assignedGroupIds||[]), groupId]} : u)
      localStorage.setItem('harvest_users', JSON.stringify(updated))
      window.dispatchEvent(new Event('harvest:verified'))
    }
    setAddName('')
  }

  const handleRemove = (username: string) => {
    const updated = users.map((u: any) => u.username === username ? {...u, group: 'Unassigned', assignedGroupIds: []} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const handleToggleVerify = (username: string) => {
    const updated = users.map((u: any) => u.username === username ? {...u, verified: !u.verified} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  const handleToggleRole = (username: string) => {
    const roles: Record<string, string> = { member: 'leader', leader: 'admin', admin: 'member' }
    const updated = users.map((u: any) => u.username === username ? {...u, role: roles[u.role] || 'member'} : u)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('harvest:verified'))
  }

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col">
      <div className="flex items-center gap-3 h-[56px] border-b border-zinc-800 px-4">
        <button onClick={onBack} className="text-xl">‹</button>
        <h1 className="font-bold text-sm">{groupId}</h1>
        <span className="ml-auto text-xs bg-white text-black px-2 py-1 rounded-full">{groupUsers.length} members</span>
      </div>

      {/* Admin Controls */}
      {isAdmin && (
        <div className="p-4 border-b border-zinc-800 space-y-2">
          <h3 className="text-xs font-bold text-amber-400">ADMIN CONTROLS</h3>
          <div className="flex gap-2">
            <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Add member username..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs outline-none" />
            <button onClick={handleAdd} className="px-3 py-2 rounded-xl bg-[#0095f6] text-white text-xs font-bold">Add</button>
          </div>
        </div>
      )}

      {/* Member List */}
      <div className="flex-1 overflow-auto p-4 space-y-2">
        {groupUsers.map((u: any) => (
          <div key={u.username} className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex gap-3 items-center">
              <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold">{u.username[0].toUpperCase()}</div>
              <div>
                <p className="text-sm font-semibold">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 inline-flex items-center justify-center text-[8px]">✓</span>}</p>
                <p className="text-[11px] text-zinc-400">{u.location || 'Nyeri'}</p>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${u.role==='admin' ? 'bg-purple-600 text-white' : u.role==='leader' ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>
                {u.role || 'member'}
              </span>
              {isAdmin && (
                <>
                  <button onClick={() => handleToggleVerify(u.username)} className="px-2 py-1 rounded-full bg-zinc-800 text-white text-[10px]">{u.verified ? '✕' : '✓'}</button>
                  <button onClick={() => handleToggleRole(u.username)} className="px-2 py-1 rounded-full bg-zinc-800 text-white text-[10px]">role</button>
                  <button onClick={() => handleRemove(u.username)} className="px-2 py-1 rounded-full bg-red-900 text-white text-[10px]">remove</button>
                </>
              )}
            </div>
          </div>
        ))}
        {groupUsers.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No members yet — admin add above</p>}
      </div>
    </div>
  )
}