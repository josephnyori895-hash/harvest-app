import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../state/auth'
import { showToast } from './Toast'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

// Small Groups — created by the system admin, who appoints a group admin and
// chooses to stay (as admin or member) or not join at all. Group admins manage
// their members: approve requests, promote/demote, remove.
export default function Groups({ onOpenChat }: { onOpenChat?: (slug: string, name: string) => void }) {
  const { isAdmin, username: viewerName } = useAuth()
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ group: any; members: any[] } | null>(null)
  const [requests, setRequests] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', admin_username: '', community: '', participation: 'admin' })
  // ── WhatsApp-style group settings (system admin) ──
  const [showSettings, setShowSettings] = useState(false)
  const [stForm, setStForm] = useState({ name: '', description: '', community: '', addOnly: false })
  const [addUname, setAddUname] = useState('')
  const [addRole, setAddRole] = useState<'member' | 'admin'>('member')
  const [savingSettings, setSavingSettings] = useState(false)
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({})

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API}/api/groups`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load groups'))))
      .then(d => { setGroups(Array.isArray(d.groups) ? d.groups : []); setError('') })
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
        ;(d.team_conversations || []).filter((x: any) => x.kind === 'group').forEach((x: any) => { next[String(x.slug)] = Number(x.unread) || 0 })
        if (live) setUnreadByGroup(next)
      } catch { /* keep last known counts */ }
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
    setDetail(null); setRequests([])
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}`, { headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load group')
      setDetail(d)
      if (d.members?.some((m: any) => m.role === 'admin' && m.username === viewerName) || isAdmin) {
        const rr = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/requests`, { headers: authHeaders() })
        if (rr.ok) { const dd = await rr.json(); setRequests(dd.requests || []) }
      }
    } catch { setOpenSlug(null); showToast('Could not open that group') }
  }

  const create = async () => {
    if (busy === 'create' || !form.name.trim()) return
    setBusy('create')
    try {
      const r = await fetch(`${API}/api/groups`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          name: form.name.trim(), description: form.description.trim() || undefined,
          admin_username: form.admin_username.trim().toLowerCase() || undefined,
          community: form.community.trim() || undefined,
          creator_participation: form.participation,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create group')
      showToast(`"${form.name.trim()}" created`)
      setShowCreate(false); setForm({ name: '', description: '', admin_username: '', community: '', participation: 'admin' })
      load()
    } catch (e: any) { showToast(e?.message || 'Could not create group') } finally { setBusy('') }
  }

  const join = async (slug: string) => {
    setBusy(`join_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/join`, { method: 'POST', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'failed')
      showToast(d.status === 'pending' ? 'Request sent — the group admin will approve it' : 'Joined')
      load()
    } catch (e: any) { showToast(e?.message || 'Could not request to join') } finally { setBusy('') }
  }

  const leave = async (slug: string) => {
    setBusy(`leave_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/leave`, { method: 'POST', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'failed')
      showToast('You left the group')
      load(); if (openSlug === slug) openDetail(slug)
    } catch (e: any) { showToast(e?.message || 'Could not leave') } finally { setBusy('') }
  }

  const decideRequest = async (slug: string, inviteId: string, approve: boolean) => {
    setBusy(`req_${inviteId}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/requests/${encodeURIComponent(inviteId)}/approve`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ approve }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'failed')
      showToast(approve ? 'Approved — they are now a member' : 'Rejected')
      openDetail(slug); load()
    } catch (e: any) { showToast(e?.message || 'Could not process request') } finally { setBusy('') }
  }

  const setRole = async (slug: string, uname: string, role: 'admin' | 'member') => {
    setBusy(`role_${slug}_${uname}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/role`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ username: uname, role }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'failed')
      showToast(role === 'admin' ? `${uname} is now a group admin` : `${uname} is now a normal member`)
      openDetail(slug); load()
    } catch (e: any) { showToast(e?.message || 'Could not change role') } finally { setBusy('') }
  }

  const removeMember = async (slug: string, uname: string) => {
    setBusy(`rm_${slug}_${uname}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/members/${encodeURIComponent(uname)}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast(`${uname} removed`)
      openDetail(slug); load()
    } catch { showToast('Could not remove member') } finally { setBusy('') }
  }

  // ── Settings actions (system admin) ──
  const startSettings = () => {
    if (!detail?.group) return
    setStForm({
      name: detail.group.name || '',
      description: detail.group.description || '',
      community: detail.group.community || '',
      addOnly: Boolean(detail.group.invite_only),
    })
    setShowSettings(true)
  }

  const saveSettings = async () => {
    if (!detail?.group || savingSettings) return
    const name = stForm.name.trim()
    if (name.length < 2) { showToast('Group name is too short'); return }
    setSavingSettings(true)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(detail.group.slug)}/settings`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ name, description: stForm.description.trim(), community: stForm.community.trim(), invite_only: stForm.addOnly }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save')
      showToast('Group settings saved ✓')
      setShowSettings(false)
      load(); await openDetail(detail.group.slug)
    } catch (e: any) { showToast(e?.message || 'Could not save settings') } finally { setSavingSettings(false) }
  }

  const addMemberDirect = async () => {
    if (!detail?.group || !addUname.trim()) return
    setBusy('add_member')
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(detail.group.slug)}/members`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ username: addUname.trim().toLowerCase(), role: addRole }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Not found')
      showToast(addRole === 'admin' ? `${addUname} added as admin` : `${addUname} added`)
      setAddUname('')
      openDetail(detail.group.slug); load()
    } catch (e: any) { showToast(e?.message || 'Could not add member') } finally { setBusy('') }
  }

  const deleteGroup = async (slug: string, name: string) => {
    if (!window.confirm(`Permanently delete "${name}"? Members will be released and the group chat history stays but the group cannot be recovered.`)) return
    setBusy(`del_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}`, { method: 'DELETE', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not delete')
      showToast(`"${name}" deleted`)
      setOpenSlug(null); setDetail(null); load()
    } catch (e: any) { showToast(e?.message || 'Could not delete group') } finally { setBusy('') }
  }

  const GroupRow = ({ g }: { g: any }) => (
    <div className="w-full p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => openDetail(g.slug)} className="min-w-0 flex-1 text-left active:opacity-70">
          <p className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
            {g.name}
            {g.is_group_admin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold">ADMIN</span>}
            {g.joined && !g.is_group_admin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-600 text-white font-extrabold">MEMBER</span>}
          </p>
          {g.description && <p className="text-[11px] text-zinc-400 mt-0.5">{g.description}</p>}
          <p className="text-[10px] text-zinc-500 mt-1">{g.community ? `${g.community} · ` : ''}{g.member_count} member{g.member_count === 1 ? '' : 's'}</p>
        </button>
        <div className="shrink-0 flex items-center gap-2">
          {g.joined && onOpenChat && (
            <button type="button" onClick={() => onOpenChat(g.slug, g.name)} className="relative px-3 py-1.5 pr-7 rounded-full bg-[#7C3AED] text-white text-[10px] font-extrabold active:opacity-70">
              💬 Chat
              {Number(unreadByGroup[g.slug]) > 0 && <span className="absolute -right-1.5 -top-1.5 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-zinc-950 shadow-sm">{Number(unreadByGroup[g.slug]) > 99 ? '99+' : unreadByGroup[g.slug]}</span>}
            </button>
          )}
          {g.joined
            ? <button type="button" onClick={() => void leave(g.slug)} disabled={busy === `leave_${g.slug}`} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold border border-zinc-700 bg-zinc-800 text-zinc-300 ${busy === `leave_${g.slug}` ? 'opacity-50' : ''}`}>Leave</button>
            : g.my_request === 'pending'
              ? <span className="px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-amber-400/20 text-amber-400 border border-amber-400/40">⏳ Requested</span>
              : <button type="button" onClick={() => void join(g.slug)} disabled={busy === `join_${g.slug}`} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-[#7C3AED] text-white ${busy === `join_${g.slug}` ? 'opacity-50' : ''}`}>Request</button>}
        </div>
      </div>
    </div>
  )

  if (openSlug) {
    const isGroupAdmin = detail?.members?.some(m => m.username === viewerName && m.role === 'admin')
    const canManage = isAdmin || isGroupAdmin
    const me = detail?.members?.find(m => m.username === viewerName)
    return (
      <div className="bg-black text-white min-h-[70vh] pb-8">
        <div className="flex items-center gap-3 h-14 border-b border-zinc-800 px-3 sticky top-0 bg-black z-10">
          <button onClick={() => { setOpenSlug(null); setDetail(null); setShowSettings(false) }} className="text-2xl w-10 h-10" aria-label="Back">‹</button>
          <h1 className="font-bold text-sm truncate flex-1">{detail?.group?.name || '…'}</h1>
          {isAdmin && detail?.group && !showSettings && <button onClick={startSettings} className="text-xl px-2" aria-label="Group settings" title="Group settings">⚙️</button>}
        </div>
        {!detail ? <p className="text-zinc-500 text-sm text-center py-10">Loading…</p> : (
          <div className="p-4 space-y-2">
            {showSettings && isAdmin ? (
              /* ── WhatsApp-style group settings panel ── */
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-zinc-900 border border-amber-500/40 space-y-3">
                  <p className="text-[10px] font-bold text-amber-400">ADMIN — GROUP SETTINGS</p>
                  <div>
                    <label htmlFor="gst-name" className="block text-[10px] font-bold text-zinc-400 mb-1">GROUP NAME</label>
                    <input id="gst-name" value={stForm.name} onChange={e => setStForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                  </div>
                  <div>
                    <label htmlFor="gst-desc" className="block text-[10px] font-bold text-zinc-400 mb-1">DESCRIPTION</label>
                    <input id="gst-desc" value={stForm.description} onChange={e => setStForm(f => ({ ...f, description: e.target.value }))} placeholder="What this group is about" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                  </div>
                  <div>
                    <label htmlFor="gst-com" className="block text-[10px] font-bold text-zinc-400 mb-1">COMMUNITY (congregation)</label>
                    <input id="gst-com" value={stForm.community} onChange={e => setStForm(f => ({ ...f, community: e.target.value }))} placeholder="e.g. Harvest Central" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400" />
                  </div>
                  <button
                    onClick={() => setStForm(f => ({ ...f, addOnly: !f.addOnly }))}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-left"
                    role="switch" aria-checked={stForm.addOnly}
                  >
                    <span>
                      <span className="block text-sm font-bold text-white">Add-only group</span>
                      <span className="block text-[11px] text-zinc-400 mt-0.5">{stForm.addOnly ? 'ON — only you can add members (like a WhatsApp admin-only add)' : 'OFF — people can send join requests'}</span>
                    </span>
                    <span className={`shrink-0 w-11 h-6 rounded-full relative transition ${stForm.addOnly ? 'bg-amber-400' : 'bg-zinc-700'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${stForm.addOnly ? 'left-[22px]' : 'left-0.5'}`} />
                    </span>
                  </button>
                  <div className="flex gap-2">
                    <button disabled={savingSettings} onClick={() => void saveSettings()} className="flex-1 py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">{savingSettings ? 'Saving…' : '💾 Save settings'}</button>
                    <button onClick={() => setShowSettings(false)} className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-bold">Cancel</button>
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <p className="text-[10px] font-bold text-amber-400">ADD MEMBER DIRECTLY</p>
                  <div className="flex gap-2">
                    <input value={addUname} onChange={e => setAddUname(e.target.value)} placeholder="username" autoCapitalize="none" className="min-w-0 flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
                    <button disabled={busy === 'add_member' || !addUname.trim()} onClick={() => void addMemberDirect()} className="px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Add</button>
                  </div>
                  <div className="flex gap-2">
                    {(['member', 'admin'] as const).map(r => (
                      <button key={r} onClick={() => setAddRole(r)} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${addRole === r ? 'bg-amber-400 text-black' : 'bg-zinc-800 text-zinc-300'}`}>{r === 'admin' ? 'As group admin' : 'As member'}</button>
                    ))}
                  </div>
                </div>
                <button
                  disabled={busy === `del_${detail.group.slug}`}
                  onClick={() => void deleteGroup(detail.group.slug, detail.group.name)}
                  className="w-full py-2.5 rounded-xl bg-red-950 border border-red-900 text-red-300 text-xs font-bold disabled:opacity-50"
                >
                  {busy === `del_${detail.group.slug}` ? 'Deleting…' : '🗑 Delete this group'}
                </button>
              </div>
            ) : (
              <>
            {detail.group.description && <p className="text-xs text-zinc-400 pb-1">{detail.group.description}</p>}

            {me && onOpenChat && (
              <button onClick={() => onOpenChat(detail.group.slug, detail.group.name)} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold active:opacity-70 mb-2">💬 Open group chat{Number(unreadByGroup[detail.group.slug]) > 0 ? ` · ${Number(unreadByGroup[detail.group.slug]) > 99 ? '99+' : unreadByGroup[detail.group.slug]} new` : ''}</button>
            )}

            {canManage && requests.length > 0 && (
              <div className="p-3 rounded-xl bg-zinc-900 border border-amber-900/50 mb-2">
                <p className="text-[10px] font-bold text-amber-400 mb-2">JOIN REQUESTS ({requests.length})</p>
                {requests.map(q => (
                  <div key={q.id} className="flex items-center gap-2 py-1.5">
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{q.name || q.username}</p><p className="text-[10px] text-zinc-500">@{q.username}</p></div>
                    <button disabled={busy === `req_${q.id}`} onClick={() => void decideRequest(detail.group.slug, q.id, true)} className="px-3 py-1.5 rounded-full bg-green-600 text-white text-[10px] font-bold disabled:opacity-50">Approve</button>
                    <button disabled={busy === `req_${q.id}`} onClick={() => void decideRequest(detail.group.slug, q.id, false)} className="px-3 py-1.5 rounded-full bg-zinc-700 text-zinc-300 text-[10px] font-bold disabled:opacity-50">Reject</button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold pt-1">Members ({detail.members.length})</p>
            {detail.members.map(u => (
              <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="w-9 h-9 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold">{String(u.name || u.username)[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{u.name || u.username}{u.username === viewerName ? ' (you)' : ''} {u.role === 'admin' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold ml-1">ADMIN</span>}</p>
                  <p className="text-[11px] text-zinc-500 truncate">@{u.username}</p>
                </div>
                {canManage && u.username !== viewerName && (
                  <div className="flex gap-1.5 shrink-0">
                    <button disabled={busy.startsWith(`role_${detail.group.slug}_`)} onClick={() => void setRole(detail.group.slug, u.username, u.role === 'admin' ? 'member' : 'admin')} className="px-2.5 py-1.5 rounded-full bg-zinc-800 text-white text-[10px] font-bold disabled:opacity-50">{u.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                    <button disabled={busy.startsWith(`rm_${detail.group.slug}_`)} onClick={() => void removeMember(detail.group.slug, u.username)} className="px-2.5 py-1.5 rounded-full bg-red-900 text-white text-[10px] font-bold disabled:opacity-50">Remove</button>
                  </div>
                )}
              </div>
            ))}
            {detail.members.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No members yet.</p>}

            <div className="pt-3">
              {me
                ? <button onClick={() => void leave(detail.group.slug)} disabled={busy === `leave_${detail.group.slug}`} className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-300 text-xs font-bold disabled:opacity-50">Leave this group{me.role === 'admin' ? ' (appoint another admin first if you are the only one)' : ''}</button>
                : <button onClick={() => void join(detail.group.slug)} disabled={busy === `join_${detail.group.slug}`} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Request to join</button>}
            </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-black text-white min-h-[70vh] pb-8">
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Harvest Family</p>
          <h1 className="text-2xl font-extrabold">Groups</h1>
          <p className="text-xs text-zinc-500 mt-1">Fellowship in small groups across Nyeri.</p>
        </div>
        {isAdmin && <button onClick={() => setShowCreate(s => !s)} className="px-4 py-2 rounded-full bg-[#7C3AED] text-white text-xs font-extrabold">{showCreate ? 'Close' : '+ New'}</button>}
      </div>

      <div className="p-4 space-y-4">
        {error && <div role="alert" className="p-3 rounded-xl bg-rose-950 border border-rose-900 text-sm text-rose-300">{error}</div>}

        {isAdmin && showCreate && (
          <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
            <p className="text-[10px] font-bold text-amber-400">NEW GROUP</p>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Group name (e.g. Young Couples)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
            <input value={form.admin_username} onChange={e => setForm(f => ({ ...f, admin_username: e.target.value }))} placeholder="Group admin username (e.g. pst.grace)" autoCapitalize="none" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
            <input value={form.community} onChange={e => setForm(f => ({ ...f, community: e.target.value }))} placeholder="Community (e.g. Harvest Central)" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none" />
            <p className="text-[10px] text-zinc-500">A community hosts 3–10 groups.</p>
            <div>
              <p className="text-[11px] font-bold text-zinc-400 mb-1">Your participation:</p>
              <div className="flex gap-2 flex-wrap">
                {[['admin', 'Stay as admin'], ['member', 'Stay as member'], ['none', 'Not a member']].map(([v, label]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, participation: v }))} className={`px-3 py-2 rounded-full text-xs font-bold ${form.participation === v ? 'bg-[#7C3AED] text-white' : 'bg-zinc-800 text-zinc-300'}`}>{label}</button>
                ))}
              </div>
            </div>
            <button disabled={busy === 'create' || !form.name.trim()} onClick={() => void create()} className="w-full py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Create group</button>
          </div>
        )}

        {loading ? <p className="text-zinc-500 text-sm">Loading…</p> : (
          <div className="space-y-2">{groups.map(g => <GroupRow key={g.id} g={g} />)}</div>
        )}
        {!loading && groups.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No groups yet{isAdmin ? ' — create the first one' : ''}.</p>}
      </div>
    </div>
  )
}
