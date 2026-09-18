import { useCallback, useEffect, useState } from 'react'
import AdminMedia from './AdminMedia'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
// The installed app always uses the API. The old VITE_USE_API gate silently
// disabled this whole screen in production builds.
const USE_API = true

const GROUPS = ['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo']
type Tab = 'moderation' | 'media' | 'accounts' | 'audit'

type Props = {
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
}

export default function Admin({ onBack, users, setUsers }: Props) {
  const [tab, setTab] = useState<Tab>('moderation')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const token = () => localStorage.getItem('harvest_token') || ''

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }

  // ── Moderation state ──
  const [pending, setPending] = useState<any[]>([])
  const [status, setStatus] = useState<'pending' | 'rejected' | 'transcoding'>('pending')
  const [cleanupBusy, setCleanupBusy] = useState(false)

  // ── Accounts state ──
  const [accounts, setAccounts] = useState<any[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [newUser, setNewUser] = useState({ username: '', name: '', pin: '', role: 'member', group_name: GROUPS[0] })
  const [showCreate, setShowCreate] = useState(false)
  const [restoreName, setRestoreName] = useState('')

  // ── Audit state ──
  const [audit, setAudit] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  const loadPending = useCallback(async () => {
    if (!USE_API) { setPending([]); return }
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

  const loadAccounts = useCallback(async () => {
    if (!USE_API) return
    setLoadingAccounts(true)
    try {
      setError('')
      const response = await fetch(`${API}/api/users/map`, { headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to load accounts')
      setAccounts(data.users || [])
    } catch (e: any) {
      setError(e?.message || 'Unable to load accounts')
    } finally { setLoadingAccounts(false) }
  }, [])

  const loadAudit = useCallback(async () => {
    if (!USE_API) return
    setLoadingAudit(true)
    try {
      setError('')
      const response = await fetch(`${API}/api/admin/audit?limit=60`, { headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to load audit log')
      setAudit(data.audit || [])
    } catch (e: any) {
      setError(e?.message || 'Unable to load audit log')
    } finally { setLoadingAudit(false) }
  }, [])

  useEffect(() => {
    if (tab === 'moderation') void loadPending()
    if (tab === 'accounts') void loadAccounts()
    if (tab === 'audit') void loadAudit()
  }, [tab, loadPending, loadAccounts, loadAudit])

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
      flash(action === 'approve' ? 'Published to the church feed' : 'Rejected')
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
      flash('Orphaned uploads cleaned')
      await loadPending()
    } catch (e: any) {
      setError(e?.message || 'Cleanup failed')
    } finally { setCleanupBusy(false) }
  }

  const patchUser = async (username: string, body: Record<string, any>) => {
    if (busy) return
    setBusy(username); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Update failed')
      const updated = data.user
      setAccounts(list => list.map(u => u.username === username ? { ...u, ...updated } : u))
      setUsers(users.map(u => u.username === username ? { ...u, verified: updated.verified, role: updated.role, group: updated.group_name } : u))
      flash(`${username} updated`)
    } catch (e: any) {
      setError(e?.message || 'Unable to update account')
    } finally { setBusy(null) }
  }

  const createUser = async () => {
    if (busy) return
    const uname = newUser.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (!uname || !newUser.name.trim() || !/^\d{4,6}$/.test(newUser.pin.trim())) {
      setError('Username, full name and a 4–6 digit PIN are required')
      return
    }
    setBusy('create'); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ username: uname, name: newUser.name.trim(), pin: newUser.pin.trim(), role: newUser.role, group_name: newUser.group_name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to create account')
      setNewUser({ username: '', name: '', pin: '', role: 'member', group_name: GROUPS[0] })
      setShowCreate(false)
      flash(`Account ${uname} created — share the PIN privately`)
      await loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Unable to create account')
    } finally { setBusy(null) }
  }

  const restoreUser = async () => {
    const uname = restoreName.trim().toLowerCase()
    if (!uname || busy) return
    setBusy('restore'); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(uname)}/restore`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Restore failed')
      setRestoreName('')
      flash(`${uname} restored`)
      await loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Restore failed')
    } finally { setBusy(null) }
  }

  const removeUser = async (username: string) => {
    if (busy) return
    if (!window.confirm(`Permanently delete ${username}? This cannot be undone.`)) return
    setBusy(username); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Delete failed')
      setAccounts(list => list.filter(u => u.username !== username))
      flash(`${username} deleted`)
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally { setBusy(null) }
  }

  const filteredAccounts = accounts.filter(u => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return `${u.username} ${u.name} ${u.group_name}`.toLowerCase().includes(needle)
  })

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-[#E8DEC9]" aria-label="Back">‹</button>
        <div className="min-w-0">
          <h1 className="font-extrabold">Harvest Admin</h1>
          <p className="text-xs text-[#766E63]">Moderation · Accounts · Audit</p>
        </div>
        <span className="ml-auto text-xs bg-[#F3E8FF] text-[#5B21B6] px-3 py-1.5 rounded-full font-bold whitespace-nowrap">{tab === 'moderation' ? `${pending.length} ${status}` : tab === 'accounts' ? `${accounts.length} members` : tab === 'media' ? 'Studio' : 'Audit'}</span>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(['moderation', 'media', 'accounts', 'audit'] as const).map(value => (
          <button key={value} onClick={() => setTab(value)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition ${tab === value ? 'bg-[#7C3AED] text-white shadow' : 'bg-white border border-[#E8DEC9] text-[#5C554C]'}`}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="mb-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{notice}</div>}
      {!USE_API && <div className="mb-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm">Admin tools require the server API. Enable VITE_USE_API=true in production.</div>}

      {/* ── Media studio tab ── */}
      {tab === 'media' && <AdminMedia onBack={() => setTab('moderation')} />}

      {/* ── Moderation tab ── */}
      {tab === 'moderation' && (
        <>
          <div className="flex gap-2 mb-4 overflow-auto">
            {(['pending', 'transcoding', 'rejected'] as const).map(value => <button key={value} onClick={() => setStatus(value)} className={`px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap ${status === value ? 'bg-[#7C3AED] text-white' : 'bg-white border border-[#E8DEC9]'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}
            <button onClick={() => void cleanup()} disabled={cleanupBusy} className="ml-auto px-3 py-2 rounded-full text-xs font-bold bg-[#F5EEDF] border border-[#E8DEC9] disabled:opacity-50">{cleanupBusy ? 'Cleaning…' : 'Clean orphaned uploads'}</button>
          </div>
          {pending.length === 0 ? <p className="text-sm text-[#766E63] text-center py-12">No {status} media — all caught up.</p> : pending.map(item => (
            <div key={item.id} className="bg-white border border-[#E8DEC9] rounded-3xl p-4 mb-3 shadow-sm">
              <div className="flex justify-between items-center"><span className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[#F3E8FF] text-[#5B21B6]">{item.type}</span><span className="text-xs text-[#766E63]">{new Date(item.created_at).toLocaleString()}</span></div>
              <p className="text-sm font-semibold mt-3">{item.name || item.username || 'Harvest member'}</p>
              <p className="text-sm text-[#5C554C] mt-1">{item.caption || 'No caption'}</p>
              {item.thumb_url && <img src={item.thumb_url} alt="Pending media" className="w-full max-h-72 object-cover rounded-2xl mt-3 bg-[#F5EEDF]" />}
              {status === 'pending' && <div className="flex gap-2 mt-3"><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'approve')} className="flex-1 py-2.5 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy === String(item.id) ? 'Working…' : 'Approve & publish'}</button><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'reject')} className="flex-1 py-2.5 rounded-2xl bg-[#F5EEDF] text-[#BE185D] text-sm font-bold disabled:opacity-50">Reject</button></div>}
              {status === 'rejected' && item.reject_reason && <p className="text-xs text-[#BE185D] mt-3">Reason: {item.reject_reason}</p>}
            </div>
          ))}
        </>
      )}

      {/* ── Accounts tab ── */}
      {tab === 'accounts' && (
        <>
          <div className="flex gap-2 mb-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" className="flex-1 bg-white border border-[#E8DEC9] rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <button onClick={() => setShowCreate(v => !v)} className="px-4 py-2.5 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold whitespace-nowrap">＋ New account</button>
          </div>

          {showCreate && (
            <div className="bg-white border border-[#E8DEC9] rounded-3xl p-4 mb-3 space-y-2">
              <p className="text-sm font-bold">Create member account</p>
              <div className="flex gap-2">
                <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} placeholder="username" className="flex-1 bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7C3AED]" />
                <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Full name" className="flex-1 bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7C3AED]" />
              </div>
              <div className="flex gap-2">
                <input value={newUser.pin} onChange={e => setNewUser(u => ({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="PIN (4–6 digits)" inputMode="numeric" className="flex-1 bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7C3AED]" />
                <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} className="bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <select value={newUser.group_name} onChange={e => setNewUser(u => ({ ...u, group_name: e.target.value }))} className="bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none max-w-[45%]">
                  {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <button onClick={() => void createUser()} disabled={busy === 'create'} className="w-full py-2.5 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create account'}</button>
            </div>
          )}

          {loadingAccounts ? <p className="text-sm text-[#766E63] text-center py-10">Loading members…</p> : filteredAccounts.length === 0 ? <p className="text-sm text-[#766E63] text-center py-10">No members found.</p> : filteredAccounts.map(u => (
            <div key={u.username} className="bg-white border border-[#E8DEC9] rounded-3xl p-4 mb-2">
              <button onClick={() => setExpanded(expanded === u.username ? null : u.username)} className="w-full flex gap-3 items-center justify-between text-left">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{u.name || u.username} {u.verified && <span className="text-[#7C3AED]">✓</span>}</p>
                  <p className="text-xs text-[#766E63] truncate">@{u.username} · {u.group_name}</p>
                  {u.phone && <p className="text-xs text-[#766E63] truncate">📞 {u.phone}</p>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-[#F3E8FF] text-[#5B21B6]' : 'bg-[#F5EEDF] text-[#766E63]'}`}>{(u.role || 'member').toUpperCase()}</span>
              </button>
              {expanded === u.username && (
                <div className="mt-3 pt-3 border-t border-[#F5EEDF] space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <select value={u.group_name || GROUPS[0]} onChange={e => void patchUser(u.username, { group_name: e.target.value })} className="flex-1 min-w-[140px] bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-xs outline-none">
                      {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select value={u.role || 'member'} onChange={e => void patchUser(u.username, { role: e.target.value })} className="bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-xs outline-none">
                      <option value="member">Member role</option>
                      <option value="admin">Admin role</option>
                    </select>
                  </div>
                  {u.role !== 'admin' && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#766E63] mb-1">Leader powers (grants)</p>
                      <div className="flex gap-1.5 flex-wrap">
                      {([
                        ['post_media', 'Post media'],
                        ['create_groups', 'Create groups'],
                        ['manage_groups', 'Manage groups'],
                        ['manage_communities', 'Manage communities'],
                        ['delete_media', 'Delete media'],
                      ] as const).map(([cap, label]) => {
                        const on = (u.grants || '').split(',').filter(Boolean).includes(cap)
                        return (
                          <button key={cap} disabled={busy === u.username} onClick={() => void patchUser(u.username, { grants: on ? (u.grants || '').split(',').filter((g: string) => g && g !== cap) : [...(u.grants || '').split(',').filter(Boolean), cap] })} className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold border ${on ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white text-[#766E63] border-[#E8DEC9]'}`}>{label}</button>
                        )
                      })}
                      </div>
                      <p className="text-[10px] text-[#766E63] mt-1">Pastors/leaders: tap to grant. Posting media, creating groups, managing groups/communities, deleting media.</p>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button disabled={busy === u.username} onClick={() => { const p = window.prompt(`New PIN for ${u.username} (4–6 digits)`); if (p) void patchUser(u.username, { pin_reset: p }) }} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-[#F5EEDF] text-[#5C554C] disabled:opacity-50">Reset PIN</button>
                    <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { verified: !u.verified })} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-[#F3E8FF] text-[#5B21B6] disabled:opacity-50">{u.verified ? 'Remove ✓' : 'Verify ✓'}</button>
                    <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { active: u.active === false })} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-[#F5EEDF] text-[#5C554C] disabled:opacity-50">{u.active === false ? 'Reactivate' : 'Deactivate'}</button>
                    <button disabled={busy === u.username} onClick={() => void removeUser(u.username)} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="mt-4 bg-white border border-[#E8DEC9] rounded-3xl p-4">
            <p className="text-sm font-bold">Restore a deactivated account</p>
            <p className="text-xs text-[#766E63] mt-1">Deactivated members can't sign in until restored.</p>
            <div className="flex gap-2 mt-2">
              <input value={restoreName} onChange={e => setRestoreName(e.target.value)} placeholder="username" className="flex-1 bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#7C3AED]" />
              <button onClick={() => void restoreUser()} disabled={busy === 'restore'} className="px-4 py-2 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">{busy === 'restore' ? '…' : 'Restore'}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Audit tab ── */}
      {tab === 'audit' && (
        loadingAudit ? <p className="text-sm text-[#766E63] text-center py-10">Loading audit log…</p> : audit.length === 0 ? <p className="text-sm text-[#766E63] text-center py-10">No admin activity recorded yet.</p> : (
          <div className="space-y-2">
            {audit.map(entry => (
              <div key={entry.id} className="bg-white border border-[#E8DEC9] rounded-2xl px-4 py-3 flex gap-3 items-start">
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-[#F5EEDF] text-[#5C554C] whitespace-nowrap">{entry.action}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{entry.actor_username || 'system'} → {entry.target_type} {String(entry.target_id).slice(0, 8)}</p>
                  <p className="text-[11px] text-[#766E63]">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
