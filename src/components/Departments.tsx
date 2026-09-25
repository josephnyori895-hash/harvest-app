import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../state/auth'
import { showToast } from './Toast'

import ErrorMessage from './ErrorMessage'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const departmentStyle = (department: any) => {
  const label = `${department.slug || ''} ${department.name || ''}`.toLowerCase()
  if (/worship|praise|music|choir/.test(label)) return { icon: '🎵', tint: 'from-fuchsia-600 to-purple-700', glow: 'bg-fuchsia-500/15' }
  if (/media|tech|sound|camera/.test(label)) return { icon: '📸', tint: 'from-sky-500 to-indigo-700', glow: 'bg-sky-500/15' }
  if (/usher|welcome|hospitality/.test(label)) return { icon: '👋', tint: 'from-amber-400 to-orange-600', glow: 'bg-amber-400/15' }
  if (/children|kid|youth/.test(label)) return { icon: '✨', tint: 'from-emerald-500 to-teal-700', glow: 'bg-emerald-500/15' }
  if (/prayer|intercess/.test(label)) return { icon: '🙏', tint: 'from-violet-500 to-indigo-800', glow: 'bg-violet-500/15' }
  return { icon: '🤝', tint: 'from-purple-600 to-indigo-800', glow: 'bg-purple-500/15' }
}

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

  // Android hardware back should close an open department detail/settings
  // screen before the app-level navigator changes tabs.
  useEffect(() => {
    const onNestedBack = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail
      if (!openSlug || !detail) return
      detail.handled = true
      setOpenSlug(null)
      setDetail(null)
      setEditing(false)
    }
    window.addEventListener('harvest:nested-back', onNestedBack)
    return () => window.removeEventListener('harvest:nested-back', onNestedBack)
  }, [openSlug])

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
      window.dispatchEvent(new Event('harvest:departments-updated'))
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
      window.dispatchEvent(new Event('harvest:departments-updated'))
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
      window.dispatchEvent(new Event('harvest:departments-updated'))
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
      window.dispatchEvent(new Event('harvest:departments-updated'))
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
      window.dispatchEvent(new Event('harvest:departments-updated'))
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
      window.dispatchEvent(new Event('harvest:departments-updated'))
    } catch (e: any) { showToast(e?.message || 'Could not add member') } finally { setBusy('') }
  }

  const removeMember = async (slug: string, uname: string) => {
    setBusy(`rm_${slug}_${uname}`)
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/members/${encodeURIComponent(uname)}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast(`${uname} removed`)
      openDetail(slug); load()
      window.dispatchEvent(new Event('harvest:departments-updated'))
    } catch { showToast('Could not remove member') } finally { setBusy('') }
  }

  const mine = departments.filter(d => d.joined)
  const availableDepartments = departments.filter(d => !d.joined)
  const availableDepartments = departments.filter(d => !d.joined)

  const DeptCard = ({ d }: { d: any }) => {
    const style = departmentStyle(d)
    return (
    <div className="group relative w-full overflow-hidden rounded-3xl border border-white/10 bg-stone-900/90 shadow-xl shadow-black/20 transition hover:border-white/20">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${style.tint}`} />
      <div className="relative p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => openDetail(d.slug)} className="min-w-0 flex flex-1 gap-3 text-left active:opacity-70">
          <div className={`w-12 h-12 shrink-0 rounded-2xl ${style.glow} border border-white/10 flex items-center justify-center text-2xl shadow-inner`}>
            {style.icon}
          </div>
          <div className="min-w-0 pt-0.5">
          <p className="text-sm font-bold text-white flex items-center gap-2 truncate">
            <span className="truncate">{d.name}</span>
            {d.leader && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold">LEADER</span>}
            {d.joined && !d.leader && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-600 text-white font-extrabold">JOINED</span>}
          </p>
          {d.description && <p className="text-[11px] text-stone-400 mt-1 line-clamp-2">{d.description}</p>}
          <p className="text-[10px] text-stone-500 mt-1.5 font-semibold">{d.member_count} {Number(d.member_count) === 1 ? 'person' : 'people'} serving</p>
          </div>
        </button>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {(d.joined || isAdmin) && onOpenDeptChat && (
            <button type="button" onClick={() => onOpenDeptChat(d.slug, d.name)} className="relative px-3 py-1.5 pr-7 rounded-full bg-[#7C3AED] text-white text-[10px] font-extrabold active:opacity-70">
              💬 Chat
              {Number(unreadByDepartment[d.slug]) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-stone-950 shadow-sm" aria-label={`${unreadByDepartment[d.slug]} unread messages`}>
                  {Number(unreadByDepartment[d.slug]) > 99 ? '99+' : unreadByDepartment[d.slug]}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            aria-label={d.joined ? `Leave ${d.name}` : `Join ${d.name}`}
            onClick={() => d.joined ? void leave(d.slug) : void join(d.slug)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${busy === d.slug ? 'opacity-50 bg-stone-700 text-stone-300' : d.joined ? 'bg-stone-800 text-stone-300 border border-stone-700' : 'bg-[#7C3AED] text-white'}`}
          >
            {d.joined ? 'Leave' : 'Join'}
          </button>
        </div>
      </div>
      </div>
    </div>
  )}

  if (openSlug) {
    const isDepartmentLeader = detail?.members?.some(m => m.username === viewerName && m.role === 'leader')
    const canManage = isAdmin || isDepartmentLeader
    return (
      <div className="department-detail-screen flex min-h-[70dvh] max-h-[100dvh] min-w-0 flex-col overflow-hidden bg-[#141210] text-white pb-0">
        <div className="flex items-center gap-3 h-14 shrink-0 border-b border-stone-800 px-3 bg-[#141210] z-10">
          <button onClick={() => { setOpenSlug(null); setDetail(null) }} className="text-2xl w-10 h-10" aria-label="Back">‹</button>
          <h1 className="font-bold text-sm truncate flex-1">{detail?.department?.name || '…'}</h1>
          {detail?.department?.slug && <button onClick={() => (detail.department.joined ? void leave(detail.department.slug) : void join(detail.department.slug))} disabled={busy === detail.department.slug} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${detail.department.joined ? 'bg-stone-800 text-stone-300 border border-stone-700' : 'bg-[#7C3AED] text-white'}`}>{detail.department.joined ? 'Leave' : 'Join'}</button>}
          {canManage && detail?.department && <button onClick={() => setEditing(v => !v)} className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 text-lg" aria-label="Department settings" title="Department settings">⚙️</button>}
        </div>
        {!detail ? <p className="text-stone-500 text-sm text-center py-10">Loading…</p> : (
          <div className="department-detail-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-[calc(1rem+var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))] space-y-2">
            {editing && canManage ? (
              <div className="p-3 rounded-xl bg-stone-900 border border-amber-500/40 mb-3">
                <p className="text-[10px] font-bold text-amber-400 mb-2">DEPARTMENT SETTINGS</p>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Department name" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Short description (optional)" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
                <div className="flex gap-2">
                  <button disabled={busy === 'edit'} onClick={() => void saveEdit()} className="flex-1 py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">{busy === 'edit' ? 'Saving…' : 'Save changes'}</button>
                  <button disabled={busy === 'edit'} onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl bg-stone-800 text-stone-300 text-xs font-bold">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {detail.department.description && <p className="text-xs text-stone-400 pb-1">{detail.department.description}</p>}
                {(detail.department.joined || isAdmin) && onOpenDeptChat && (
                  <button onClick={() => onOpenDeptChat(detail.department.slug, detail.department.name)} className="relative w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold active:opacity-70 mb-2">
                    💬 Open team chat
                    {Number(unreadByDepartment[detail.department.slug]) > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-stone-950 shadow-sm" aria-label={`${unreadByDepartment[detail.department.slug]} unread messages`}>
                        {Number(unreadByDepartment[detail.department.slug]) > 99 ? '99+' : unreadByDepartment[detail.department.slug]}
                      </span>
                    )}
                  </button>
                )}
                {canManage && (
                  <button onClick={() => setEditing(true)} className="text-[11px] font-bold text-amber-400">⚙️ Department settings</button>
                )}
              </>
            )}
            {canManage && (
              <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 mb-3">
                <p className="text-[10px] font-bold text-amber-400 mb-2">ADMIN — ADD MEMBER</p>
                <div className="flex gap-2">
                  <input value={addUsername} onChange={e => setAddUsername(e.target.value)} placeholder="username" autoCapitalize="none" className="min-w-0 flex-1 bg-stone-950 border border-stone-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
                  <button disabled={busy.startsWith('assign')} onClick={() => void assign(detail.department.slug, addUsername, 'member')} className="px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Add</button>
                  <button disabled={busy.startsWith('assign')} onClick={() => void assign(detail.department.slug, addUsername, 'leader')} className="px-3 rounded-xl bg-amber-400 text-black text-xs font-bold disabled:opacity-50">Leader</button>
                </div>
              </div>
            )}
            {detail.members.map(u => (
              <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-stone-900 border border-stone-800">
                <div className="w-9 h-9 shrink-0 rounded-full bg-stone-700 flex items-center justify-center text-xs font-bold">{String(u.name || u.username)[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{u.name || u.username}{u.username === viewerName ? ' (you)' : ''} {u.role === 'leader' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold ml-1">LEADER</span>}</p>
                  <p className="text-[11px] text-stone-500 truncate">@{u.username} · {u.group_name || 'Harvest'}</p>
                </div>
                {canManage && u.username !== viewerName && (
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      disabled={busy.startsWith(`assign_${detail.department.slug}`)}
                      onClick={() => void assign(detail.department.slug, u.username, u.role === 'leader' ? 'member' : 'leader')}
                      className="px-2.5 py-1.5 rounded-full bg-stone-800 text-white text-[10px] font-bold"
                    >
                      {u.role === 'leader' ? 'Make member' : 'Make leader'}
                    </button>
                    <button disabled={busy.startsWith(`rm_${detail.department.slug}_`)} onClick={() => void removeMember(detail.department.slug, u.username)} className="px-2.5 py-1.5 rounded-full bg-red-900 text-white text-[10px] font-bold">Remove</button>
                  </div>
                )}
              </div>
            ))}
            {detail.members.length === 0 && <p className="text-sm text-stone-500 text-center py-8">No one is serving here yet — be the first to join!</p>}
            {isAdmin && (
              <button disabled={busy === `del_${detail.department.slug}` || editing} onClick={() => void deleteDepartment(detail.department.slug, detail.department.name)} className="w-full mt-4 py-2.5 rounded-xl bg-red-950 border border-red-900 text-red-300 text-xs font-bold disabled:opacity-50">{busy === `del_${detail.department.slug}` ? 'Deleting…' : '🗑 Delete department'}</button>
            )}
            {!isAdmin && (
              <p className="text-xs text-stone-500 text-center py-4">Members of a department see the team chat at the top of Chats when they're signed in.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-[#141210] text-white min-h-[70vh] pb-8">
      <div className="relative overflow-hidden px-5 pt-7 pb-6 border-b border-white/10 bg-gradient-to-br from-[#21123e] via-[#110d20] to-black">
        <div className="absolute -right-12 -top-16 w-44 h-44 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute -left-14 bottom-0 w-40 h-28 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] uppercase tracking-[0.22em] text-purple-200/70 font-bold">Harvest Family · Serve together</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Departments</h1>
          <p className="text-sm text-stone-300 mt-2 max-w-sm">Find your place, build your team, and keep the conversation moving.</p>
          <div className="flex gap-2 mt-5">
            <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2 backdrop-blur"><p className="text-lg leading-none font-black">{departments.length}</p><p className="text-[9px] uppercase tracking-wide text-stone-300 mt-1">Teams</p></div>
            <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2 backdrop-blur"><p className="text-lg leading-none font-black">{mine.length}</p><p className="text-[9px] uppercase tracking-wide text-stone-300 mt-1">Your teams</p></div>
            <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2 backdrop-blur"><p className="text-lg leading-none font-black">💬</p><p className="text-[9px] uppercase tracking-wide text-stone-300 mt-1">Team chat</p></div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {error && <ErrorMessage message={error} kind="network" action={<button type="button" onClick={() => void load()} className="rounded-full bg-white px-3 py-1.5 text-[10px] font-extrabold text-black">Retry</button>} />}

        {isAdmin && (
          <div className="p-3 rounded-xl bg-stone-900 border border-stone-800">
            <p className="text-[10px] font-bold text-amber-400 mb-2">ADMIN — NEW DEPARTMENT</p>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Department name (e.g. Transport)" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Short description (optional)" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2.5 text-sm outline-none mb-2" />
            <button disabled={busy === 'create' || !newName.trim()} onClick={() => void createDepartment()} className="w-full py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Create department</button>
          </div>
        )}

        {mine.length > 0 && (
          <section>
            <h2 className="text-sm font-black text-white mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400" />Your teams</h2>
            <div className="space-y-2">{mine.map(d => <DeptCard key={d.id} d={d} />)}</div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-black text-white mb-3">Explore departments</h2>
          {loading ? (
            <div role="status" aria-live="polite" className="rounded-2xl border border-stone-800 bg-stone-950 px-4 py-6 text-center">
              <div className="mx-auto w-7 h-7 rounded-full border-2 border-stone-700 border-t-purple-400 animate-spin" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold text-stone-400">Loading departments…</p>
            </div>
          ) : availableDepartments.length === 0 ? (
            <div className="rounded-3xl border border-stone-800 bg-stone-950 px-5 py-10 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center text-2xl" aria-hidden="true">🏛️</div>
              <h2 className="mt-4 text-sm font-extrabold text-white">{departments.length === 0 ? 'No departments yet' : 'You’re already in every department'}</h2>
              <p className="mt-2 text-xs leading-5 text-stone-500">{departments.length === 0 ? (isAdmin ? 'Create the first department above.' : 'Departments will appear here when they are available.') : 'There are no other departments available to join right now.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {availableDepartments.map(d => <DeptCard key={d.id} d={d} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
