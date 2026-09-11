import { useState } from 'react'

export default function Admin({ pending, onApprove, onReject, onBack, users, setUsers }: { pending: any[]; onApprove: (id: number) => void; onReject: (id: number) => void; onBack: () => void; users: any[]; setUsers: (u: any[]) => void }) {
  const toggleVerify = (username: string) => {
    const updated = users.map(u => u.username === username ? { ...u, verified: !u.verified } : u)
    setUsers(updated)
    localStorage.setItem('harvest_users', JSON.stringify(updated))
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('harvest:verified'))
  }
  return (
    <div className="bg-black text-white min-h-[70vh] p-4">
      <div className="flex items-center gap-3 mb-4"><button onClick={onBack} className="text-xl">‹</button><h1 className="font-bold">Admin • Approvals</h1><span className="ml-auto text-xs bg-amber-500 text-black px-2 py-1 rounded-full">{pending.length} pending</span></div>
      {pending.length === 0 ? <p className="text-sm text-zinc-500 text-center py-4">No pending posts — all caught up ✓</p> : pending.map(item => (
        <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-3">
          <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-white text-black">{item.type}</span><span className="text-xs text-zinc-500">{new Date(item.at).toLocaleTimeString()}</span></div>
          <p className="text-sm font-semibold mt-2">{item.user}</p>
          <p className="text-sm text-zinc-300 mt-1">{item.caption || 'No caption'}</p>
          {item.img && <img src={item.img} alt="" className="w-full h-24 object-cover rounded-lg mt-2" />}
          <div className="flex gap-2 mt-3">
            <button onClick={() => onApprove(item.id)} className="flex-1 py-2 rounded-full bg-green-600 text-white text-sm font-semibold">✓ Approve</button>
            <button onClick={() => onReject(item.id)} className="flex-1 py-2 rounded-full bg-zinc-800 text-white text-sm font-semibold">✕ Reject</button>
          </div>
        </div>
      ))}
      <div className="mt-6 border-t border-zinc-800 pt-4">
        <h2 className="font-bold text-sm flex items-center gap-2">✓ Verified Accounts <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span></h2>
        <p className="text-xs text-zinc-500">Admin can verify any account — blue tick</p>
        <div className="mt-3 space-y-2">
          {users.map(u => (
            <div key={u.username} className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="flex gap-3 items-center">
                <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm">{u.username[0].toUpperCase()}</div>
                <div><p className="text-sm font-semibold flex items-center gap-1">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span>}</p><p className="text-xs text-zinc-400">{u.name} • {u.group}</p></div>
              </div>
              <button onClick={() => toggleVerify(u.username)} className={`px-4 py-1.5 rounded-full text-xs font-semibold ${u.verified ? 'bg-blue-500 text-white' : 'bg-white text-black'}`}>{u.verified ? 'Unverify' : 'Verify'}</button>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-zinc-600 text-center mt-4">Verified = blue tick everywhere • Admin decides</p>
    </div>
  )
}
