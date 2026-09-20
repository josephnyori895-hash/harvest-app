import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../state/auth'
import { showToast } from './Toast'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

// Departments (ministry teams): praise & worship, ushering, media, etc.
// Members join/leave themselves; admins create departments and manage members.
export default function Departments({ onOpenDeptChat }: { onOpenDeptChat?: (slug: string, name: string) => void }) {
  const { isAdmin, username: viewerName } = useAuth()
  const [departments, setDepartments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ department: any; members: any[] } | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editing, setEditing] = useState(false)
  const [unreadByDepartment, setUnreadByDepartment] = useState<Record<string, number>>({})

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API}/api/departments`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load departments'))))
      .then(d => { setDepartments(Array.isArray(d.departments) ? d.departments : []); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    let live = true
    const refreshUnread = async () => {
      if (!localStorage.getItem('harvest_token')) return
      try {
        const r = await fetch(`${API}/api/chat/conversations`, { headers: authHeaders() })
        if (!r.ok) return
        const d = await r.json()
        const next: Record<string, number> = {}
        ;(d.team_conversations || []).filter((x: any) => x.kind === 'department').forEach((x: any) => {
          next[String(x.slug)] = Number(x.unread) || 0
        })
        if (live) setUnreadByDepartment(next)
      } catch { /* keep the last known counts */ }
    }
    void refreshUnread()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnread()
    }, 3000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshUnread()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const openDetail = async (slug: string) => {
    setOpenSlug(slug)
    setDetail(null)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}`, { headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load department')
      setDetail(d)
      // Keep the team rail in sync after opening detail.
      setTimeout(() => { void load() }, 0)
    } catch {
      setOpenSlug(null); showToast('Could not open that department')
    }
  }

  const join = async (slug: string) => {
    setBusy(slug)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/join`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast('Welcome to the team! 🙌')
      load()
      if (openSlug === slug) openDetail(slug)
    } catch { showToast('Could not join — try again') } finally { setBusy('') }
  }

  const leave = async (slug: string) => {
    setBusy(slug)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/leave`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast('You left the team')
      load()
      if (openSlug === slug) openDetail(slug)
    } catch { showToast('Could not leave — try again') } finally { setBusy('') }
  }

  const createDepartment = async () => {
    if (!newName.trim() || busy === 'create') return
    setBusy('create')
    try {
      const r = await fetch(`${API}/api/departments`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create')
      showToast(`"${newName.trim()}" created`)
      setNewName(''); setNewDesc('')
      load()
    } catch (e: any) { showToast(e?.message || 'Could not create department') } finally { setBusy('') }
  }

  const startEdit = () => {
    if (!detail?.department) return
    setEditName(detail.department.name || '')
    setEditDesc(detail.department.description || '')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!detail?.department || busy === 'edit') return
    const name = editName.trim()
    if (name.length < 2) { showToast('Department name is too short'); return }
    setBusy('edit')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(detail.department.slug)}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ name, description: editDesc.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save')
      showToast('Department updated')
      setEditing(false)
      load()
      await openDetail(detail.department.slug)
    } catch (e: any) { showToast(e?.message || 'Could not update department') } finally { setBusy('') }
  }

  const deleteDepartment = async (slug: string, name: string) => {
    if (!window.confirm(`Permanently delete "${name}"? Members will be released and this cannot be undone.`)) return
    setBusy(`del_${slug}`)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}`, { method: 'DELETE', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not delete')
      showToast(`"${name}" deleted`)
      setOpenSlug(null); setDetail(null); load()
    } catch (e: any) { showToast(e?.message || 'Could not delete department') } finally { setBusy('') }
  }

  const assign = async (slug: string, uname: string, role: 'member' | 'leader') => {
    if (!uname.trim()) return
    setBusy(`assign_${slug}`)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/members`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ username: uname.trim().toLowerCase(), role }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Not found')
      showToast(role === 'leader' ? `${uname} is now a leader` : `${uname} added`)
      setAddUsername('')
      openDetail(slug); load()
    } catch (e: any) { showToast(e?.message || 'Could not add member') } finally { setBusy('') }
  }

  const removeMember = async (slug: string, uname: string) => {
    setBusy(`rm_${slug}_${uname}`)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/members/${encodeURIComponent(uname)}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast(`${uname} removed`)
      openDetail(slug); load()
    } catch { showToast('Could not remove member') } finally { setBusy('') }
  }

  const mine = departments.filter(d => d.joined)

  const DeptCard = ({ d }: { d: any }) => (
    <div className="w-full p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => openDetail(d.slug)} className="min-w-0 flex-1 text-left active:opacity-70">
          <p className="text-sm font-bold text-white flex items-center gap-2">
            {d.name}
            {d.leader && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold">LEADER</span>}
            {d.joined && !d.leader && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-600 text-white font-extrabold">JOINED</span>}
          </p>
          {d.description && <p className="text-[11px] text-zinc-400 mt-0.5">{d.description}</p>}
          <p className="text-[10px] text-zinc-500 mt-1">{d.member_count} serving</p>
        </button>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {(d.joined || isAdmin) && onOpenDeptChat && (
            <button type="button" onClick={() => onOpenDeptChat(d.slug, d.name)} className="relative px-3 py-1.5 pr-7 rounded-full bg-[#7C3AED] text-white text-[10px] font-extrabold active:opacity-70">
              💬 Chat
              {Number(unreadByDepartment[d.slug]) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-zinc-950 shadow-sm" aria-label={`${unreadByDepartment[d.slug]} unread messages`}>
                  {Number(unreadByDepartment[d.slug]) > 99 ? '99+' : unreadByDepartment[d.slug]}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            aria-label={d.joined ? `Leave ${d.name}` : `Join ${d.name}`}
            onClick={() => d.joined ? void leave(d.slug) : void join(d.slug)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${busy === d.slug ? 'opacity-50 bg-zinc-700 text-zinc-300' : d.joined ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-[#7C3AED] text-white'}`}
          >
            {d.joined ? 'Leave' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  )

  if (openSlug) {
    const isDepartmentLeader = detail?.members?.some(m => m.username === viewerName && m.role === 'leader')
    const canManage = isAdmin || isDepartmentLeader
    return (
      <div className="bg-black text-white min-h-[70vh] pb-8">
        <div className="flex items-center gap-3 h-14 border-b border-zinc-800 px-3 sticky top-0 bg-black z-10">
          <button onClick={() => { setOpenSlug(null); setDetail(null) }} className="text-2xl w-10 h-10" aria-label="Back">‹</button>
          <h1 className="font-bold text-sm truncate flex-1">{detail?.department?.name || '…'}</h1>
          {detail?.department?.slug && <button onClick={() => (detail.department.joined ? void leave(detail.department.slug) : void join(detail.department.slug))} disabled={busy === detail.department.slug} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${detail.department.joined ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-[#7C3AED] text-white'}`}>{detail.department.joined ? 'Leave' : 'Join'}</button>}
        </div>
        {!detail ? <p className="text-zinc-500 text-sm text-center py-10">Loading…</p> : (
          <div className="p-4 space-y-2">
            {editing && canManage ?
              <div className="p-3 rounded-xl bg-zinc-900 border border-amber-500/40 mb-3">
                <p className="text-[10px] font-bold text-amber-400 mb-2">ADMIN — EDIT DEPARTMENT</p>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Department name" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Short description (optional)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
                <div className="flex gap-2">
                  <button disabled={busy === 'edit'} onClick={() => void saveEdit()} className="flex-1 py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">{busy === 'edit' ? 'Saving…' : 'Save changes'}</button>
                  <button disabled={busy === 'edit'} onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {detail.department.description && <p className="text-xs text-zinc-400 pb-1">{detail.department.description}</p>}
                {(detail.department.joined || isAdmin) && onOpenDeptChat && (
                  <button onClick={() => onOpenDeptChat(detail.department.slug, detail.department.name)} className="relative w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold active:opacity-70 mb-2">
                    💬 Open team chat
                    {Number(unreadByDepartment[detail.department.slug]) > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-zinc-950 shadow-sm" aria-label={`${unreadByDepartment[detail.department.slug]} unread messages`}>
                        {Number(unreadByDepartment[detail.department.slug]) > 99 ? '99+' : unreadByDepartment[detail.department.slug]}
                      </span>
                    )}
                  </button>
                )}
                {isAdmin && (
                  <button onClick={startEdit} className="text-[11px] font-bold text-amber-400">✏️ Edit name & description</button>
                )}
              </>
            )}
            {canManage && (
              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 mb-3">
                <p className="text-[10px] font-bold text-amber-400 mb-2">ADMIN — ADD MEMBER</p>
                <div className="flex gap-2">
                  <input value={addUsername} onChange={e => setAddUsername(e.target.value)} placeholder="username" autoCapitalize="none" className="min-w-0 flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
                  <button disabled={busy.startsWith('assign')} onClick={() => void assign(detail.department.slug, addUsername, 'member')} className="px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Add</button>
                  <button disabled={busy.startsWith('assign')} onClick={() => void assign(detail.department.slug, addUsername, 'leader')} className="px-3 rounded-xl bg-amber-400 text-black text-xs font-bold disabled:opacity-50">Leader</button>
                </div>
              </div>
            )}
            {detail.members.map(u => (
              <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="w-9 h-9 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold">{String(u.name || u.username)[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{u.name || u.username}{u.username === viewerName ? ' (you)' : ''} {u.role === 'leader' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold ml-1">LEADER</span>}</p>
                  <p className="text-[11px] text-zinc-500 truncate">@{u.username} · {u.group_name || 'Harvest'}</p>
                </div>
                {canManage && u.username !== viewerName && (
                  <button disabled={busy.startsWith(`rm_${detail.department.slug}_`)} onClick={() => void removeMember(detail.department.slug, u.username)} className="shrink-0 px-2.5 py-1.5 rounded-full bg-red-900 text-white text-[10px] font-bold">Remove</button>
                )}
              </div>
            ))}
            {detail.members.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No one is serving here yet — be the first to join!</p>}
            {isAdmin && (
              <button disabled={busy === `del_${detail.department.slug}` || editing} onClick={() => void deleteDepartment(detail.department.slug, detail.department.name)} className="w-full mt-4 py-2.5 rounded-xl bg-red-950 border border-red-900 text-red-300 text-xs font-bold disabled:opacity-50">{busy === `del_${detail.department.slug}` ? 'Deleting…' : '🗑 Delete department'}</button>
            )}
            {!isAdmin && (
              <p className="text-xs text-zinc-500 text-center py-4">Members of a department see the team chat at the top of Chats when they're signed in.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-black text-white min-h-[70vh] pb-8">
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Harvest Family</p>
        <h1 className="text-2xl font-extrabold">Departments</h1>
        <p className="text-xs text-zinc-500 mt-1">Find where you serve - your teams have real chat rooms.</p>
      </div>

      <div className="p-4 space-y-6">
        {error && <div role="alert" className="p-3 rounded-xl bg-rose-950 border border-rose-900 text-sm text-rose-300">{error}</div>}

        {isAdmin && (
          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <p className="text-[10px] font-bold text-amber-400 mb-2">ADMIN — NEW DEPARTMENT</p>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Department name (e.g. Transport)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Short description (optional)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
            <button disabled={busy === 'create' || !newName.trim()} onClick={() => void createDepartment()} className="w-full py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Create department</button>
          </div>
        )}

        {mine.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-amber-400 mb-2">Your teams</h2>
            <div className="space-y-2">{mine.map(d => <DeptCard key={d.id} d={d} />)}</div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-bold text-white mb-2">All departments</h2>
          {loading ? <p className="text-zinc-500 text-sm">Loading…</p> : (
            <div className="space-y-2">
              {departments.filter(d => !d.joined).map(d => <DeptCard key={d.id} d={d} />)}
              {!loading && departments.length === 0 && <p className="text-sm text-zinc-500">No departments yet{isAdmin ? ' — create one above' : ''}.</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
