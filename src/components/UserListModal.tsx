import { useAuth } from '../state/auth'

export default function UserListModal({ type, userId, users, onBack }: { type: string; userId: string; users: any[]; onBack: () => void }) {
  const { isAdmin } = useAuth()

  // Filter users based on type
  let filteredUsers: any[] = []
  if (type === 'followers') {
    filteredUsers = users.filter(u => u.username !== userId)
  } else if (type === 'following') {
    filteredUsers = users.filter(u => u.username !== userId)
  } else {
    filteredUsers = users.filter(u => u.username !== userId)
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
        <h1 className="font-bold text-sm capitalize">{type}</h1>
        <span className="ml-auto text-xs bg-white text-black px-2 py-1 rounded-full">{filteredUsers.length}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {filteredUsers.map((u: any) => (
          <div key={u.username} className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex gap-3 items-center">
              <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold">{u.username[0].toUpperCase()}</div>
              <div>
                <p className="text-sm font-semibold">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 inline-flex items-center justify-center text-[8px]">✓</span>}</p>
                <p className="text-[11px] text-zinc-400">{u.role || 'member'} • {u.location || 'Nyeri'}</p>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <button onClick={() => handleToggleVerify(u.username)} className="px-2 py-1 rounded-full bg-zinc-800 text-white text-[10px]">{u.verified ? '✕' : '✓'}</button>
                <button onClick={() => handleToggleRole(u.username)} className="px-2 py-1 rounded-full bg-zinc-800 text-white text-[10px]">role</button>
              </div>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No {type} yet</p>}
      </div>
    </div>
  )
}