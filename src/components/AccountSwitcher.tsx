import { useEffect, useState } from 'react'
import { useAuth } from '../state/auth'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function headers() {
  const token = localStorage.getItem('harvest_token') || ''
  return { Authorization: token ? `Bearer ${token}` : '', 'Content-Type': 'application/json' }
}

async function request(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}

const groups = ['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo']

function AdminPanel({ onClose }: { onClose: () => void }) {
  const { isAdmin, username } = useAuth()
  const [tab, setTab] = useState<'users'|'moderation'|'giving'>('users')
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [giving, setGiving] = useState<any | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadUsers = async () => { try { const d = await request(`/api/users?q=${encodeURIComponent(q || 'al')}`); setUsers(d.users || []) } catch (e:any) { setMessage(e.message) } }
  const loadPending = async () => { try { const d = await request('/api/pending?status=pending'); setPending(d.pending || []) } catch (e:any) { setMessage(e.message) } }
  const loadGiving = async () => { try { setGiving(await request('/api/giving/admin')) } catch (e:any) { setMessage(e.message) } }

  useEffect(() => { if (!isAdmin) return; void loadUsers(); void loadPending(); void loadGiving() }, [isAdmin])

  const updateUser = async (u: any, patch: any) => {
    setBusy(true); setMessage('')
    try { await request(`/api/admin/users/${encodeURIComponent(u.username)}`, { method:'PATCH', body:JSON.stringify(patch) }); setMessage(`${u.username} updated`); await loadUsers() }
    catch (e:any) { setMessage(e.message) } finally { setBusy(false) }
  }
  const moderate = async (id: string, action: 'approve'|'reject') => {
    setBusy(true); setMessage('')
    try { await request(`/api/pending/${id}/${action}`, { method:'POST', body: action==='reject' ? JSON.stringify({reason:'Rejected by administrator'}) : '{}' }); setMessage(`Content ${action}d`); await loadPending() }
    catch (e:any) { setMessage(e.message) } finally { setBusy(false) }
  }
  const cleanup = async () => { setBusy(true); try { const d=await request('/api/pending/cleanup',{method:'POST'}); setMessage(`Cleanup complete: ${d.rows || 0} records`); await loadPending() } catch(e:any){setMessage(e.message)} finally{setBusy(false)} }

  if (!isAdmin) return null
  return (
    <div className="fixed inset-0 bg-black/90 z-[60] flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] max-h-[92vh] overflow-auto bg-zinc-950 text-white rounded-t-3xl p-4 border-t border-zinc-800" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><div><p className="font-bold text-lg">Admin controls</p><p className="text-[11px] text-zinc-400">Signed in as {username} · full administrator</p></div><button onClick={onClose} className="px-3 py-2 rounded-xl bg-zinc-800">Close</button></div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {([['users','Members'],['moderation','Moderation'],['giving','Giving']] as const).map(([k,label])=><button key={k} onClick={()=>setTab(k)} className={`py-2 rounded-xl text-xs font-semibold ${tab===k?'bg-[#7C3AED]':'bg-zinc-900 border border-zinc-800'}`}>{label}</button>)}
        </div>
        {message && <div className="mb-3 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-300">{message}</div>}

        {tab==='users' && <>
          <div className="flex gap-2 mb-3"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void loadUsers()} placeholder="Search members…" className="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm"/><button onClick={()=>void loadUsers()} className="px-4 rounded-xl bg-white text-black text-xs font-bold">Search</button></div>
          <div className="space-y-2">
            {users.map(u=><div key={u.username} className="rounded-2xl bg-zinc-900 border border-zinc-800 p-3">
              <div className="flex items-center gap-2"><div className="w-9 h-9 rounded-full bg-[#7C3AED] flex items-center justify-center font-bold">{(u.name||u.username)[0].toUpperCase()}</div><div className="flex-1"><p className="text-sm font-semibold">{u.name} <span className="text-zinc-500">@{u.username}</span></p><p className="text-[10px] text-zinc-500">{u.role} · {u.group_name || 'No group'}</p></div><span className={`text-[10px] px-2 py-1 rounded-full ${u.verified?'bg-emerald-900 text-emerald-300':'bg-zinc-800 text-zinc-400'}`}>{u.verified?'Verified':'Unverified'}</span></div>
              <div className="grid grid-cols-2 gap-2 mt-3"><select value={u.role} disabled={busy || u.username===username} onChange={e=>void updateUser(u,{role:e.target.value})} className="bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-xs"><option value="member">Member</option><option value="admin">Admin</option></select><select value={u.group_name||''} disabled={busy} onChange={e=>void updateUser(u,{group_name:e.target.value})} className="bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-2 text-xs">{groups.map(g=><option key={g}>{g}</option>)}</select></div>
              <button disabled={busy} onClick={()=>void updateUser(u,{verified:!u.verified})} className="w-full mt-2 py-2 rounded-xl bg-zinc-800 text-xs font-semibold">{u.verified?'Remove verification':'Verify member'}</button>
            </div>)}
            {!users.length && <p className="text-center text-xs text-zinc-500 py-6">No members found.</p>}
          </div>
        </>}

        {tab==='moderation' && <>
          <div className="flex justify-between items-center mb-3"><p className="text-sm font-bold">Pending content ({pending.length})</p><button onClick={()=>void cleanup()} disabled={busy} className="text-[11px] px-3 py-2 rounded-xl bg-zinc-800">Clean stale uploads</button></div>
          <div className="space-y-2">{pending.map(x=><div key={x.id} className="rounded-2xl bg-zinc-900 border border-zinc-800 p-3"><div className="flex justify-between"><p className="text-sm font-semibold">{x.type} · @{x.username}</p><span className="text-[10px] text-amber-400">pending</span></div><p className="text-xs text-zinc-400 mt-1 line-clamp-2">{x.caption || 'No caption'}</p><div className="grid grid-cols-2 gap-2 mt-3"><button disabled={busy} onClick={()=>void moderate(x.id,'approve')} className="py-2 rounded-xl bg-emerald-700 text-xs font-bold">Approve</button><button disabled={busy} onClick={()=>void moderate(x.id,'reject')} className="py-2 rounded-xl bg-red-900 text-xs font-bold">Reject</button></div></div>)}{!pending.length&&<p className="text-center text-xs text-zinc-500 py-6">Nothing waiting for review.</p>}</div>
        </>}

        {tab==='giving' && <>{giving ? <><div className="grid grid-cols-2 gap-2 mb-4"><div className="rounded-2xl bg-zinc-900 p-4"><p className="text-[10px] text-zinc-500">Completed</p><p className="text-xl font-bold">KES {giving.totals?.completed_kes || '0'}</p></div><div className="rounded-2xl bg-zinc-900 p-4"><p className="text-[10px] text-zinc-500">Pending</p><p className="text-xl font-bold">{giving.totals?.pending_count || 0}</p></div></div><div className="space-y-2">{(giving.transactions||[]).slice(0,30).map((x:any)=><div key={x.id} className="rounded-xl bg-zinc-900 p-3 flex justify-between"><div><p className="text-xs font-semibold">@{x.username||'unknown'} · {x.purpose}</p><p className="text-[10px] text-zinc-500">{x.status} · {x.receipt_number||'no receipt'}</p></div><b className="text-sm">KES {x.amount_kes}</b></div>)}</div></> : <p className="text-center text-xs text-zinc-500 py-6">Loading giving…</p>}</>}
      </div>
    </div>
  )
}

export default function AccountSwitcher({ users, onSwitch, onClose }: { users: any[]; onSwitch: (u: string)=>void; onClose: ()=>void }) {
  const { isAdmin } = useAuth()
  const demoAccountsEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_ACCOUNTS === 'true'
  if (isAdmin) return <AdminPanel onClose={onClose} />
  if (!demoAccountsEnabled) return null
  const current = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0]?.username || localStorage.getItem('harvest_username')||'allan'}catch{return 'allan'}})()
  const testAccounts = users.slice(0,4)
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-zinc-900 rounded-t-2xl p-4 border-t border-zinc-800" onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-4"/><p className="text-sm font-bold text-white mb-3">Switch demo account</p>
        {testAccounts.map((u:any)=><button key={u.username} onClick={()=>{onSwitch(u.username);onClose()}} className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 ${current===u.username?'bg-[#0095f6]':'bg-zinc-800'}`}><div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold">{u.username[0].toUpperCase()}</div></div><div className="flex-1 text-left"><p className="text-sm font-semibold text-white">{u.username}</p><p className="text-xs text-zinc-400">{u.name} · {u.verified?'Verified':'Normal'} · {u.group}</p></div>{current===u.username&&<span>✓</span>}</button>)}
        <p className="text-[11px] text-zinc-500 text-center mt-2">Demo accounts are for local development only.</p><button onClick={onClose} className="w-full mt-3 py-3 rounded-full bg-zinc-800 text-white text-sm">Close</button>
      </div>
    </div>
  )
}
