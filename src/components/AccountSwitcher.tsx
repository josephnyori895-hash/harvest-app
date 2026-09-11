export default function AccountSwitcher({ users, onSwitch, onClose }: { users: any[]; onSwitch: (u: string)=>void; onClose: ()=>void }) {
  // Demo account switching is development-only. Production accounts must use real auth.
  const demoAccountsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_ACCOUNTS === 'true'
  if (!demoAccountsEnabled) return null

  const current = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0]?.username || localStorage.getItem('harvest_username')||'allan'}catch{return 'allan'}})()
  const testAccounts = users.slice(0,4)
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-zinc-900 rounded-t-2xl p-4 border-t border-zinc-800" onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-4"/>
        <p className="text-sm font-bold text-white mb-3">Switch demo account</p>
        {testAccounts.map((u:any)=>(
          <button key={u.username} onClick={()=>{onSwitch(u.username);onClose()}} className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 ${current===u.username?'bg-[#0095f6]': 'bg-zinc-800'} `}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold">{u.username[0].toUpperCase()}</div></div>
            <div className="flex-1 text-left"><p className="text-sm font-semibold flex items-center gap-1 text-white">{u.username} {u.verified&&<span className="w-3 h-3 rounded-full bg-[#0095f6] flex items-center justify-center text-[7px]">✓</span>} {current===u.username&&<span className="text-[10px] bg-white text-black px-1.5 py-0.5 rounded-full">active</span>}</p><p className="text-xs text-zinc-400">{u.name} • {u.verified?'Verified':'Normal'} • {u.group}</p></div>
            {current===u.username&&<span className="text-white">✓</span>}
          </button>
        ))}
        <p className="text-[11px] text-zinc-500 text-center mt-2">Demo accounts are for local development only. Current: <b className="text-white">{current}</b></p>
        <button onClick={onClose} className="w-full mt-3 py-3 rounded-full bg-zinc-800 text-white text-sm">Close</button>
      </div>
    </div>
  )
}
