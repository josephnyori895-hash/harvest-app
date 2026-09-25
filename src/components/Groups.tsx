import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../state/auth'
import { showToast } from './Toast'

import ErrorMessage from './ErrorMessage'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function notifyGroupsChanged() { window.dispatchEvent(new Event('harvest:groups-changed')) }

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
  const [form, setForm] = useState({ name: '', description: '', admin_username: '', community: '' })
  // ── WhatsApp-style group settings (system admin) ──
  const [showSettings, setShowSettings] = useState(false)
  const [stForm, setStForm] = useState({ name: '', description: '', community: '', addOnly: false, allowMemberEditInfo: false, allowMemberSend: true, allowMemberAdd: false, allowMemberInvite: false, approveNewMembers: true, sendMessageHistory: false, lat: '', lng: '', location_label: '' })
  const [addUname, setAddUname] = useState('')
  const [addRole, setAddRole] = useState<'member' | 'admin'>('member')
  const [savingSettings, setSavingSettings] = useState(false)
  const [unreadByGroup, setUnreadByGroup] = useState<Record<string, number>>({})

  // Android hardware back should close an open group detail/settings screen
  // before the app-level navigator changes tabs.
  useEffect(() => {
    const onNestedBack = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail
      if (!openSlug || !detail) return
      detail.handled = true
      setOpenSlug(null)
      setDetail(null)
      setRequests([])
      setShowSettings(false)
    }
    window.addEventListener('harvest:nested-back', onNestedBack)
    return () => window.removeEventListener('harvest:nested-back', onNestedBack)
  }, [openSlug])

  // Live unread badge per group chat (polls while the screen is visible).
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

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API}/api/groups`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load groups'))))
      .then(d => { setGroups(Array.isArray(d.groups) ? d.groups : []) ; setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Keep this screen in sync when groups change elsewhere (admin studio,
  // other tabs, settings saved in another instance).
  useEffect(() => {
    window.addEventListener('harvest:groups-changed', load)
    return () => window.removeEventListener('harvest:groups-changed', load)
  }, [load])

  const openDetail = async (slug: string) => {
    setBusy(`open_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}`, { headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not open group')
      setDetail({ group: d.group, members: d.members || [] })
      setRequests(d.requests || [])
      setOpenSlug(slug)
      setShowSettings(false)
      setStForm(f => ({ ...f, name: d.group.name, description: d.group.description || '', community: d.group.community || '', addOnly: !d.group.allow_member_add && !d.group.allow_member_invite }))
    } catch (e: any) { showToast(e?.message || 'Could not open group') } finally { setBusy('') }
  }

  const create = async () => {
    if (busy === 'create') return
    setBusy('create')
    try {
      const r = await fetch(`${API}/api/groups`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(form) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create group')
      showToast(`Group "${form.name}" created`)
      setShowCreate(false); setForm({ name: '', description: '', admin_username: '', community: '' })
      load(); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not create group') } finally { setBusy('') }
  }

  const join = async (slug: string) => {
    setBusy(`join_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/join`, { method: 'POST', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not request to join')
      showToast(d.status === 'requested' ? 'Join request sent ⏳' : 'Welcome to the group! 🎉')
      load()
      // Chat rails read /api/groups/mine — tell them membership changed.
      window.dispatchEvent(new Event('harvest:groups-changed'))
      if (openSlug === slug) void openDetail(slug)
    } catch (e: any) { showToast(e?.message || 'Could not join') } finally { setBusy('') }
  }

  const leave = async (slug: string) => {
    setBusy(`leave_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/leave`, { method: 'POST', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not leave')
      showToast('You left the group')
      setOpenSlug(null); setDetail(null); load(); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not leave') } finally { setBusy('') }
  }

  const decideRequest = async (slug: string, reqId: string, approve: boolean) => {
    setBusy(`req_${reqId}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/requests/${reqId}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ approve }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not update request')
      showToast(approve ? 'Member approved ✓' : 'Request rejected')
      void openDetail(slug); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not update request') } finally { setBusy('') }
  }

  const setRole = async (slug: string, username: string, role: 'admin' | 'member') => {
    setBusy(`role_${slug}_${username}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/members/${encodeURIComponent(username)}/role`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ role }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not change role')
      showToast(role === 'admin' ? `${username} is now a group admin ⭐` : `${username} is now a member`)
      void openDetail(slug); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not change role') } finally { setBusy('') }
  }

  const removeMember = async (slug: string, username: string) => {
    setBusy(`rm_${slug}_${username}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}/members/${encodeURIComponent(username)}`, { method: 'DELETE', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not remove member')
      showToast(`${username} removed`)
      void openDetail(slug); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not remove member') } finally { setBusy('') }
  }

  const addMemberDirect = async () => {
    if (!addUname.trim()) return
    setBusy('add_member')
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(openSlug || '')}/members`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ username: addUname.trim(), role: addRole }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not add member')
      showToast(`${addUname.trim()} added ✓`)
      setAddUname('')
      void openDetail(openSlug || ''); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not add member') } finally { setBusy('') }
  }

  const saveSettings = async () => {
    if (!detail?.group || savingSettings) return
    setSavingSettings(true)
    try {
      // The worker reads snake_case; map the camelCase form keys across.
      // The location fields power registration auto-assignment (system admin only).
      const body: Record<string, unknown> = {
        name: stForm.name,
        description: stForm.description,
        community: stForm.community,
        invite_only: stForm.addOnly,
        allow_member_edit_info: stForm.allowMemberEditInfo,
        allow_member_send: stForm.allowMemberSend,
        allow_member_add: stForm.allowMemberAdd,
        allow_member_invite: stForm.allowMemberInvite,
        approve_new_members: stForm.approveNewMembers,
        send_message_history: stForm.sendMessageHistory,
      }
      if (isAdmin) {
        if (stForm.lat.trim() !== '') body.lat = Number(stForm.lat)
        if (stForm.lng.trim() !== '') body.lng = Number(stForm.lng)
        body.location_label = stForm.location_label
      }
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(openSlug || '')}/settings`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save settings')
      showToast('Group settings saved ✓')
      setShowSettings(false); notifyGroupsChanged()
      void openDetail(openSlug || '')
      load()
      // Renames/description changes must reach every group picker.
      window.dispatchEvent(new Event('harvest:groups-changed'))
    } catch (e: any) { showToast(e?.message || 'Could not save settings') } finally { setSavingSettings(false); setBusy('') }
  }

  const startSettings = () => {
    if (!detail) return
    const g = detail.group
    setStForm({ name: g.name, description: g.description || '', community: g.community || '', addOnly: !g.allow_member_add && !g.allow_member_invite, allowMemberEditInfo: !!g.allow_member_edit_info, allowMemberSend: !!g.allow_member_send, allowMemberAdd: !!g.allow_member_add, allowMemberInvite: !!g.allow_member_invite, approveNewMembers: !!g.approve_new_members, sendMessageHistory: !!g.send_message_history, lat: g.lat === null || g.lat === undefined ? '' : String(g.lat), lng: g.lng === null || g.lng === undefined ? '' : String(g.lng), location_label: g.location_label || '' })
    setShowSettings(true)
  }

  const deleteGroup = async (slug: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    setBusy(`del_${slug}`)
    try {
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(slug)}`, { method: 'DELETE', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not delete')
      showToast(`"${name}" deleted`)
      setOpenSlug(null); setDetail(null); load(); notifyGroupsChanged()
    } catch (e: any) { showToast(e?.message || 'Could not delete group') } finally { setBusy('') }
  }

  // Group membership avatar colors — warm church tints, one per name.
  const avatarTint = (name: string) => {
    const tints = [
      'from-[#EDE9FE] to-[#C4B5FD] text-[#5B21B6]',
      'from-[#FEF3C7] to-[#FDE68A] text-[#B45309]',
      'from-[#FCE7F3] to-[#F9A8D4] text-[#9D174D]',
      'from-[#D1FAE5] to-[#A7F3D0] text-[#065F46]',
      'from-[#DBEAFE] to-[#BFDBFE] text-[#1E40AF]',
      'from-[#FFE4E6] to-[#FECDD3] text-[#9F1239]',
    ]
    let h = 0
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 997
    return tints[h % tints.length]
  }

  const GroupRow = ({ g }: { g: any }) => (
    <div className="w-full p-4 rounded-[22px] bg-white border border-[#E8DEC9] shadow-sm hover:shadow-md transition">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => openDetail(g.slug)} className="min-w-0 flex-1 text-left active:opacity-70">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br ${avatarTint(g.name)} flex items-center justify-center text-sm font-extrabold shadow-sm`}>{String(g.name).split(/\s+/).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[#29251F] flex items-center gap-2 flex-wrap">
                {g.name}
                {g.is_group_admin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white font-extrabold">ADMIN</span>}
                {g.joined && !g.is_group_admin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#0F766E] text-white font-extrabold">MEMBER</span>}
              </p>
              <p className="text-[10px] text-[#8B8175] mt-0.5">{g.community ? `${g.community} · ` : ''}{g.member_count} member{g.member_count === 1 ? '' : 's'}</p>
            </div>
          </div>
          {g.description && <p className="text-[11px] text-[#766E63] mt-2 leading-5">{g.description}</p>}
        </button>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {g.joined && onOpenChat && (
            <button type="button" onClick={() => onOpenChat(g.slug, g.name)} className="relative px-3 py-1.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-extrabold active:opacity-70 shadow-sm">
              💬 Chat
              {Number(unreadByGroup[g.slug]) > 0 && <span className="absolute -right-1.5 -top-1.5 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-white shadow-sm">{Number(unreadByGroup[g.slug]) > 99 ? '99+' : unreadByGroup[g.slug]}</span>}
            </button>
          )}
          {g.joined
            ? <button type="button" onClick={() => void leave(g.slug)} disabled={busy === `leave_${g.slug}`} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold border border-[#E8DEC9] bg-[#FAF6EC] text-[#766E63] ${busy === `leave_${g.slug}` ? 'opacity-50' : ''}`}>Leave</button>
            : g.my_request === 'pending'
              ? <span className="px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]">⏳ Requested</span>
              : <button type="button" onClick={() => void join(g.slug)} disabled={busy === `join_${g.slug}`} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold bg-[#7C3AED] text-white shadow-sm ${busy === `join_${g.slug}` ? 'opacity-50' : ''}`}>Request</button>}
        </div>
      </div>
    </div>
  )

  if (openSlug) {
    const isGroupAdmin = detail?.members?.some(m => m.username === viewerName && m.role === 'admin')
    const canManage = isAdmin || isGroupAdmin
    const me = detail?.members?.find(m => m.username === viewerName)
    return (
      <div className="group-detail-screen flex min-h-[70dvh] max-h-[100dvh] min-w-0 flex-col overflow-hidden bg-[#FFFBF0] text-[#29251F] pb-0">
        <div className="flex items-center gap-3 h-14 shrink-0 border-b border-[#E8DEC9] px-3 bg-[#FFFBF0]/95 backdrop-blur z-10">
          <button onClick={() => { setOpenSlug(null); setDetail(null); setShowSettings(false) }} className="text-2xl w-10 h-10 text-[#5B21B6]" aria-label="Back">‹</button>
          <h1 className="font-extrabold text-sm truncate flex-1">{detail?.group?.name || '…'}</h1>
          {canManage && detail?.group && !showSettings && <button onClick={startSettings} className="text-xl px-2" aria-label="Group settings" title="Group settings">⚙️</button>}
        </div>
        {!detail ? <p className="text-[#8B8175] text-sm text-center py-10">Loading…</p> : (
          <div className="group-detail-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-[calc(1rem+var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))] space-y-2">
            {showSettings && canManage ? (
              /* ── WhatsApp-style group settings panel ── */
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-white border-2 border-[#7C3AED]/30 space-y-3 shadow-sm">
                  <p className="text-[10px] font-extrabold text-[#7C3AED] tracking-widest">ADMIN — GROUP SETTINGS</p>
                  <div>
                    <label htmlFor="gst-name" className="block text-[10px] font-bold text-[#766E63] mb-1">GROUP NAME</label>
                    <input id="gst-name" value={stForm.name} onChange={e => setStForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                  </div>
                  <div>
                    <label htmlFor="gst-desc" className="block text-[10px] font-bold text-[#766E63] mb-1">DESCRIPTION</label>
                    <input id="gst-desc" value={stForm.description} onChange={e => setStForm(f => ({ ...f, description: e.target.value }))} placeholder="What this group is about" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                  </div>
                  <div>
                    <label htmlFor="gst-com" className="block text-[10px] font-bold text-[#766E63] mb-1">COMMUNITY (congregation)</label>
                    <input id="gst-com" value={stForm.community} onChange={e => setStForm(f => ({ ...f, community: e.target.value }))} placeholder="e.g. Harvest Central" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                  </div>
                  {isAdmin && (
                    <div className="p-3 rounded-xl bg-[#F5F3FF] border border-[#DDD6FE] space-y-2">
                      <p className="text-[10px] font-extrabold text-[#5B21B6] tracking-widest">📍 REGISTRATION LOCATION</p>
                      <p className="text-[11px] text-[#5B21B6]/80">New members who sign up near these GPS coordinates automatically join this congregation.</p>
                      <div className="grid min-w-0 grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="gst-lat" className="block text-[10px] font-bold text-[#766E63] mb-1">LATITUDE</label>
                          <input id="gst-lat" inputMode="decimal" value={stForm.lat} onChange={e => setStForm(f => ({ ...f, lat: e.target.value }))} placeholder="-0.4197" className="w-full bg-white border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                        </div>
                        <div>
                          <label htmlFor="gst-lng" className="block text-[10px] font-bold text-[#766E63] mb-1">LONGITUDE</label>
                          <input id="gst-lng" inputMode="decimal" value={stForm.lng} onChange={e => setStForm(f => ({ ...f, lng: e.target.value }))} placeholder="36.9475" className="w-full bg-white border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="gst-loc" className="block text-[10px] font-bold text-[#766E63] mb-1">AREA LABEL</label>
                        <input id="gst-loc" value={stForm.location_label} onChange={e => setStForm(f => ({ ...f, location_label: e.target.value }))} placeholder="e.g. Nyeri Town" className="w-full bg-white border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-[10px] font-extrabold text-[#8B8175] tracking-widest">GROUP PERMISSIONS</p>
                    {([
                      ['allowMemberEditInfo', 'Edit group settings', 'Members can change the group name and description.', stForm.allowMemberEditInfo],
                      ['allowMemberSend', 'Send new messages', 'Turn off for an announcements-only group.', stForm.allowMemberSend],
                      ['allowMemberAdd', 'Add other members', 'Allow ordinary members to add people directly.', stForm.allowMemberAdd],
                      ['allowMemberInvite', 'Invite via link', 'Allow ordinary members to create/share group invite links.', stForm.allowMemberInvite],
                      ['approveNewMembers', 'Approve new members', 'Join requests must be approved by a group admin.', stForm.approveNewMembers],
                      ['sendMessageHistory', 'Send message history', 'Allow message history to be shared with new members.', stForm.sendMessageHistory],
                    ] as const).map(([key, title, description, enabled]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStForm(f => ({ ...f, [key]: !f[key] }))}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#FAF6EC] border border-[#E8DEC9] text-left"
                        role="switch"
                        aria-checked={enabled}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-[#29251F]">{title}</span>
                          <span className="block text-[11px] text-[#766E63] mt-0.5">{description}</span>
                        </span>
                        <span className={`shrink-0 w-11 h-6 rounded-full relative transition ${enabled ? 'bg-[#7C3AED]' : 'bg-[#DDD6FE]'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setStForm(f => ({ ...f, addOnly: !f.addOnly }))}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#FAF6EC] border border-[#E8DEC9] text-left"
                      role="switch" aria-checked={stForm.addOnly}
                    >
                      <span>
                        <span className="block text-sm font-bold text-[#29251F]">Admin-only membership</span>
                        <span className="block text-[11px] text-[#766E63] mt-0.5">{stForm.addOnly ? 'ON — members cannot request to join; admins add them.' : 'OFF — members can request to join.'}</span>
                      </span>
                      <span className={`shrink-0 w-11 h-6 rounded-full relative transition ${stForm.addOnly ? 'bg-[#7C3AED]' : 'bg-[#DDD6FE]'}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${stForm.addOnly ? 'left-[22px]' : 'left-0.5'}`} />
                      </span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={savingSettings} onClick={() => void saveSettings()} className="flex-1 py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50 shadow-sm">{savingSettings ? 'Saving…' : '💾 Save settings'}</button>
                    <button onClick={() => setShowSettings(false)} className="px-4 py-2.5 rounded-xl bg-[#F4E8D0] text-[#766E63] text-xs font-bold">Cancel</button>
                  </div>
                </div>
                <div className="p-4 rounded-2xl bg-white border border-[#E8DEC9] space-y-2 shadow-sm">
                  <p className="text-[10px] font-extrabold text-[#7C3AED] tracking-widest">ADD MEMBER DIRECTLY</p>
                  <div className="flex gap-2">
                    <input value={addUname} onChange={e => setAddUname(e.target.value)} placeholder="username" autoCapitalize="none" className="min-w-0 flex-1 bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                    <button disabled={busy === 'add_member' || !addUname.trim()} onClick={() => void addMemberDirect()} className="px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Add</button>
                  </div>
                  <div className="flex gap-2">
                    {(['member', 'admin'] as const).map(r => (
                      <button key={r} onClick={() => setAddRole(r)} className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold ${addRole === r ? 'bg-[#7C3AED] text-white' : 'bg-[#F4E8D0] text-[#766E63]'}`}>{r === 'admin' ? 'As group admin' : 'As member'}</button>
                    ))}
                  </div>
                </div>
                {isAdmin && (
                <button
                  disabled={busy === `del_${detail.group.slug}`}
                  onClick={() => void deleteGroup(detail.group.slug, detail.group.name)}
                  className="w-full py-2.5 rounded-xl bg-white border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50"
                >
                  {busy === `del_${detail.group.slug}` ? 'Deleting…' : '🗑 Delete this group'}
                </button>
                )}
              </div>
            ) : (
              <>
            {detail.group.description && <p className="text-xs text-[#766E63] pb-1 leading-5">{detail.group.description}</p>}

            {me && onOpenChat && (
              <button onClick={() => onOpenChat(detail.group.slug, detail.group.name)} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold active:opacity-70 mb-2 shadow-sm">💬 Open group chat{Number(unreadByGroup[detail.group.slug]) > 0 ? ` · ${Number(unreadByGroup[detail.group.slug]) > 99 ? '99+' : unreadByGroup[detail.group.slug]} new` : ''}</button>
            )}

            {canManage && requests.length > 0 && (
              <div className="p-3 rounded-xl bg-white border border-[#FDE68A] mb-2 shadow-sm">
                <p className="text-[10px] font-extrabold text-[#B45309] mb-2 tracking-widest">JOIN REQUESTS ({requests.length})</p>
                {requests.map(q => (
                  <div key={q.id} className="flex items-center gap-2 py-1.5">
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{q.name || q.username}</p><p className="text-[10px] text-[#8B8175]">@{q.username}</p></div>
                    <button disabled={busy === `req_${q.id}`} onClick={() => void decideRequest(detail.group.slug, q.id, true)} className="px-3 py-1.5 rounded-full bg-[#0F766E] text-white text-[10px] font-bold disabled:opacity-50">Approve</button>
                    <button disabled={busy === `req_${q.id}`} onClick={() => void decideRequest(detail.group.slug, q.id, false)} className="px-3 py-1.5 rounded-full bg-[#F4E8D0] text-[#766E63] text-[10px] font-bold disabled:opacity-50">Reject</button>
                  </div>
                ))}
              </div>
            )}

            {canManage && (
              <div className="p-3 rounded-xl bg-white border border-[#E8DEC9] shadow-sm">
                <p className="text-[10px] font-extrabold text-[#8B8175] tracking-widest mb-2">GROUP PERMISSIONS</p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <span className="text-[#4B433A]">{detail.group.allow_member_send ? '✓ Everyone can message' : '✓ Admins only can message'}</span>
                  <span className="text-[#4B433A]">{detail.group.allow_member_add ? '✓ Members can add people' : '✓ Admins add people'}</span>
                  <span className="text-[#4B433A]">{detail.group.approve_new_members ? '✓ Join requests approved' : '✓ Open joining'}</span>
                  <span className="text-[#4B433A]">{detail.group.allow_member_edit_info ? '✓ Members can edit info' : '✓ Admins edit info'}</span>
                </div>
              </div>
            )}

            <p className="text-[10px] uppercase tracking-widest text-[#8B8175] font-bold pt-1">Members ({detail.members.length})</p>
            {detail.members.map(u => (
              <div key={u.username} className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-[#E8DEC9] shadow-sm">
                <div className={`w-10 h-10 shrink-0 rounded-full bg-gradient-to-br ${avatarTint(u.name || u.username)} flex items-center justify-center text-xs font-extrabold`}>{String(u.name || u.username)[0].toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{u.name || u.username}{u.username === viewerName ? ' (you)' : ''} {u.role === 'admin' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white font-extrabold ml-1">ADMIN</span>}</p>
                  <p className="text-[11px] text-[#8B8175] truncate">@{u.username}</p>
                </div>
                {canManage && u.username !== viewerName && (
                  <div className="flex gap-1.5 shrink-0">
                    <button disabled={busy.startsWith(`role_${detail.group.slug}_`)} onClick={() => void setRole(detail.group.slug, u.username, u.role === 'admin' ? 'member' : 'admin')} className="px-2.5 py-1.5 rounded-full bg-[#F4E8D0] text-[#5B21B6] text-[10px] font-bold disabled:opacity-50">{u.role === 'admin' ? 'Make member' : 'Make admin'}</button>
                    <button disabled={busy.startsWith(`rm_${detail.group.slug}_`)} onClick={() => void removeMember(detail.group.slug, u.username)} className="px-2.5 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold disabled:opacity-50">Remove</button>
                  </div>
                )}
              </div>
            ))}
            {detail.members.length === 0 && <p className="text-sm text-[#8B8175] text-center py-8">No members yet.</p>}

            <div className="pt-3">
              {me
                ? <button onClick={() => void leave(detail.group.slug)} disabled={busy === `leave_${detail.group.slug}`} className="w-full py-3 rounded-2xl border border-[#E8DEC9] bg-white text-[#766E63] text-xs font-bold disabled:opacity-50">Leave this group{me.role === 'admin' ? ' (appoint another admin first if you are the only one)' : ''}</button>
                : <button onClick={() => void join(detail.group.slug)} disabled={busy === `join_${detail.group.slug}`} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50 shadow-sm">Request to join</button>}
            </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-[70vh] bg-[#FFFBF0] text-[#29251F] pb-8">
      <div className="px-4 pt-5 pb-4 bg-gradient-to-br from-[#5B21B6] via-[#6D28D9] to-[#7C3AED] text-white">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200 font-bold">Harvest Family</p>
            <h1 className="text-2xl font-extrabold">Groups</h1>
            <p className="text-xs text-purple-100 mt-1">Fellowship in small groups across Nyeri.</p>
          </div>
          {isAdmin && <button onClick={() => setShowCreate(s => !s)} className="px-4 py-2 rounded-full bg-white text-[#5B21B6] text-xs font-extrabold shadow-sm">{showCreate ? 'Close' : '+ New'}</button>}
        </div>
        {(() => { const joined = groups.filter((g: any) => g.joined).length; return groups.length > 0 ? (
          <div className="mt-4 flex gap-2">
            <span className="px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-[11px] font-bold">👥 {groups.length} groups</span>
            <span className="px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-[11px] font-bold">✓ {joined} joined</span>
          </div>
        ) : null })()}
      </div>

      <div className="p-4 space-y-4">
        {error && <ErrorMessage message={error} />}

        {isAdmin && showCreate && (
          <div className="p-4 rounded-2xl bg-white border-2 border-[#7C3AED]/30 space-y-2 shadow-sm">
            <p className="text-[10px] font-extrabold text-[#7C3AED] tracking-widest">NEW GROUP</p>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Group name (e.g. Young Couples)" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <input value={form.admin_username} onChange={e => setForm(f => ({ ...f, admin_username: e.target.value }))} placeholder="Group admin username (e.g. pst.grace)" autoCapitalize="none" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <input value={form.community} onChange={e => setForm(f => ({ ...f, community: e.target.value }))} placeholder="Community (e.g. Harvest Central)" className="w-full bg-[#FAF6EC] border border-[#E8DEC9] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <p className="text-[10px] text-[#8B8175]">A community hosts 3–10 groups.</p>
            <div className="p-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
              <p className="text-[11px] font-extrabold text-[#B45309]">CREATOR ADMIN</p>
              <p className="text-[11px] text-[#766E63] mt-1">You will automatically become a group admin. You can add other admins later from Group Settings.</p>
            </div>
            <button disabled={busy === 'create' || !form.name.trim()} onClick={() => void create()} className="w-full py-2.5 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50 shadow-sm">Create group</button>
          </div>
        )}

        {loading ? <p className="text-[#8B8175] text-sm">Loading…</p> : (
          <div className="space-y-3">{groups.map(g => <GroupRow key={g.id} g={g} />)}</div>
        )}
        {!loading && groups.length === 0 && <div className="text-center py-10"><div className="w-16 h-16 mx-auto rounded-full bg-[#F4E8D0] flex items-center justify-center text-3xl">👥</div><p className="text-sm text-[#8B8175] mt-3">No groups yet{isAdmin ? ' — create the first one' : ''}.</p></div>}
      </div>
    </div>
  )
}
