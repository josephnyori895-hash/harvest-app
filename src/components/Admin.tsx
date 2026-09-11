import { useCallback, useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const USE_API = import.meta.env.VITE_USE_API === 'true'

type Props = {
  pending: any[]
  onApprove: (id: number) => void
  onReject: (id: number) => void
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
}

export default function Admin({ onBack, users, setUsers }: Props) {
  const [pending, setPending] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'pending' | 'rejected' | 'transcoding'>('pending')
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const token = () => localStorage.getItem('harvest_token') || ''

  const loadPending = useCallback(async () => {
    if (!USE_API) {
      setError('Admin moderation requires the server API. Enable VITE_USE_API=true in production.')
      setPending([])
      return
    }
    try {
      setError('')
      const response = await fetch(`${API}/api/pending?status=${status}`, { headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to load moderation queue')
      setPending(data.pending || [])
    } catch (e: any) {
      setError(e?.message || 'Unable to load moderation queue')
    }
  }, [status])

  useEffect(() => { void loadPending() }, [loadPending])

  const moderate = async (id: string, action: 'approve' | 'reject') => {
    if (busy) return
    setBusy(id); setError('')
    try {
      const body = action === 'reject' ? { reason: 'Rejected by Harvest admin' } : undefined
      const response = await fetch(`${API}/api/pending/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `Unable to ${action} media`)
      setPending(items => items.filter(item => String(item.id) !== String(id)))
      window.dispatchEvent(new Event('harvest:approved'))
    } catch (e: any) {
      setError(e?.message || `Unable to ${action} media`)
    } finally { setBusy(null) }
  }

  const cleanup = async () => {
    if (cleanupBusy) return
    setCleanupBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/pending/cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Cleanup failed')
      await loadPending()
    } catch (e: any) {
      setError(e?.message || 'Cleanup failed')
    } finally { setCleanupBusy(false) }
  }

  const toggleVerify = async (username: string) => {
    const target = users.find(u => u.username === username)
    if (!target || busy) return
    setBusy(username); setError('')
    try {
      if (!USE_API) throw new Error('Account verification requires the server API.')
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ verified: !target.verified }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Verification update failed')
      setUsers(users.map(u => u.username === username ? { ...u, verified: data.user.verified, role: data.user.role, group: data.user.group_name } : u))
    } catch (e: any) {
      setError(e?.message || 'Unable to update account')
    } finally { setBusy(null) }
  }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-[#E8DEC9]" aria-label="Back">‹</button>
        <div><h1 className="font-extrabold">Harvest moderation</h1><p className="text-xs text-[#766E63]">Server-backed media approvals</p></div>
        <span className="ml-auto text-xs bg-[#F3E8FF] text-[#5B21B6] px-3 py-1.5 rounded-full font-bold">{pending.length} {status}</span>
      </div>

      <div className="flex gap-2 mb-4 overflow-auto">
        {(['pending', 'transcoding', 'rejected'] as const).map(value => <button key={value} onClick={() => setStatus(value)} className={`px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap ${status === value ? 'bg-[#7C3AED] text-white' : 'bg-white border border-[#E8DEC9]'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        <button onClick={() => void cleanup()} disabled={cleanupBusy} className="ml-auto px-3 py-2 rounded-full text-xs font-bold bg-[#F5EEDF] border border-[#E8DEC9] disabled:opacity-50">{cleanupBusy ? 'Cleaning…' : 'Clean orphaned uploads'}</button>
      </div>

      {error && <div role="alert" className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      {!USE_API && <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm">The legacy browser moderation queue has been disabled. Connect the server API to moderate media.</div>}

      {USE_API && pending.length === 0 ? <p className="text-sm text-[#766E63] text-center py-12">No {status} media — all caught up.</p> : USE_API && pending.map(item => (
        <div key={item.id} className="bg-white border border-[#E8DEC9] rounded-3xl p-4 mb-3 shadow-sm">
          <div className="flex justify-between items-center"><span className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[#F3E8FF] text-[#5B21B6]">{item.type}</span><span className="text-xs text-[#766E63]">{new Date(item.created_at).toLocaleString()}</span></div>
          <p className="text-sm font-semibold mt-3">{item.name || item.username || 'Harvest member'}</p>
          <p className="text-sm text-[#5C554C] mt-1">{item.caption || 'No caption'}</p>
          {item.thumb_url && <img src={item.thumb_url} alt="Pending media" className="w-full max-h-72 object-cover rounded-2xl mt-3 bg-[#F5EEDF]" />}
          {status === 'pending' && <div className="flex gap-2 mt-3"><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'approve')} className="flex-1 py-2.5 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy === String(item.id) ? 'Working…' : 'Approve & publish'}</button><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'reject')} className="flex-1 py-2.5 rounded-2xl bg-[#F5EEDF] text-[#BE185D] text-sm font-bold disabled:opacity-50">Reject</button></div>}
          {status === 'rejected' && item.reject_reason && <p className="text-xs text-[#BE185D] mt-3">Reason: {item.reject_reason}</p>}
        </div>
      ))}

      <div className="mt-8 border-t border-[#E8DEC9] pt-5">
        <h2 className="font-extrabold text-sm">Verified accounts</h2>
        <p className="text-xs text-[#766E63] mt-1">Verification is separate from the admin role.</p>
        <div className="mt-3 space-y-2">{users.map(u => <div key={u.username} className="flex gap-3 items-center justify-between p-3 rounded-2xl bg-white border border-[#E8DEC9]"><div className="min-w-0"><p className="text-sm font-semibold truncate">{u.username} {u.verified && '✓'}</p><p className="text-xs text-[#766E63] truncate">{u.name} · {u.group}</p></div><button disabled={busy === u.username} onClick={() => void toggleVerify(u.username)} className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#F3E8FF] text-[#5B21B6] disabled:opacity-50">{busy === u.username ? 'Saving…' : u.verified ? 'Unverify' : 'Verify'}</button></div>)}</div>
      </div>
    </div>
  )
}
