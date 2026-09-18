import { useEffect, useState } from 'react'
import { useAuth } from '../state/auth'
import { showToast } from './Toast'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

type GroupInfo = {
  id: string
  slug: string
  name: string
  description: string
  community: string
  invite_only?: number | boolean
  add_only?: boolean
  lat?: number | null
  lng?: number | null
  location_label?: string
  member_count?: number
}

// WhatsApp-style group settings: header card → editable fields → member list.
// The admin can rename the group, change its description/community, flip the
// add-only toggle, and link the group to a map location for auto-assignment.
export default function GroupDetails({ groupId, users, onBack }: { groupId: string; users: any[]; onBack: () => void }) {
  const { isAdmin } = useAuth()
  const groupUsers = users.filter((u: any) => (u.group_name || u.group) === groupId)
  const [addName, setAddName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState<GroupInfo | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [community, setCommunity] = useState('')
  const [addOnly, setAddOnly] = useState(true)
  const [locLabel, setLocLabel] = useState('')
  const [locating, setLocating] = useState(false)

  const loadInfo = async () => {
    try {
      const r = await fetch(`${API}/api/groups`, { headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      const g: GroupInfo | undefined = (d.groups || []).find((x: any) => x.name === groupId || x.slug === groupId)
      if (g) {
        setInfo(g)
        setName(g.name || '')
        setDescription(g.description || '')
        setCommunity(g.community || '')
        setAddOnly(g.invite_only === undefined ? Boolean(g.add_only) : Boolean(g.invite_only))
        setLocLabel(g.location_label || '')
      }
    } catch { /* settings stay hidden if load fails */ }
  }

  useEffect(() => { if (isAdmin) void loadInfo() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [isAdmin])

  const patch = async (username: string, body: any) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Update failed')
      window.dispatchEvent(new Event('harvest:verified'))
    } catch (e: any) {
      setMsg(e?.message || 'Update failed')
    } finally { setBusy(false) }
  }

  const verifyToggle = async (username: string, verified: boolean) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${API}/api/admin/verify/${encodeURIComponent(username)}`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ verified }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Update failed')
      window.dispatchEvent(new Event('harvest:verified'))
    } catch (e: any) {
      setMsg(e?.message || 'Update failed')
    } finally { setBusy(false) }
  }

  const handleAdd = () => {
    const username = addName.trim().toLowerCase().replace(/\s+/g, '_')
    const exists = users.find((u: any) => u.username === username)
    if (!exists) { setMsg(`No member named "${username}" found`); return }
    if ((exists.group_name || exists.group) === groupId) { setMsg(`${username} is already in this group`); return }
    void patch(username, { group_name: groupId })
    setAddName('')
  }

  const handleRemove = (username: string) => void patch(username, { group_name: 'Unassigned' })
  const handleToggleVerify = (username: string, verified: boolean) => void verifyToggle(username, !verified)
  const handleToggleRole = (u: any) => void patch(u.username, { role: u.role === 'admin' ? 'member' : 'admin' })

  // ── Group settings (admin) ──
  const saveSettings = async () => {
    if (!info || busy) return
    setBusy(true)
    try {
      const body: any = { name: name.trim(), description: description.trim(), community: community.trim(), invite_only: addOnly }
      if (locLabel.trim() && info.lat != null && info.lng != null) body.location = { lat: info.lat, lng: info.lng, label: locLabel.trim() }
      else if (!locLabel.trim()) body.location = null
      const r = await fetch(`${API}/api/groups/${encodeURIComponent(info.slug)}/settings`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save settings')
      showToast('Group settings saved ✓')
      setShowSettings(false)
      window.dispatchEvent(new Event('harvest:verified'))
      void loadInfo()
    } catch (e: any) { showToast(e?.message || 'Could not save settings') } finally { setBusy(false) }
  }

  const captureLocation = () => {
    if (!navigator.geolocation) { showToast('Location not available on this device'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      p => {
        if (info) setInfo({ ...info, lat: p.coords.latitude, lng: p.coords.longitude })
        if (!locLabel.trim()) setLocLabel('Pinned here')
        setLocating(false)
        showToast('Location captured — remember to save')
      },
      () => { setLocating(false); showToast('Could not get location — check permissions') },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const clearLocation = () => {
    if (info) setInfo({ ...info, lat: null, lng: null })
    setLocLabel('')
  }

  return <div className="bg-black text-white min-h-[70vh] flex flex-col overflow-x-hidden">
    <div className="flex items-center gap-3 min-h-[56px] border-b border-zinc-800 px-3 sm:px-4 sticky top-0 z-20 bg-black">
      <button type="button" onClick={onBack} aria-label="Back to groups" className="touch-target rounded-full text-2xl hover:bg-zinc-900">‹</button>
      <h1 className="font-bold text-sm truncate flex-1">{groupId}</h1>
      {isAdmin && <button type="button" onClick={() => setShowSettings(s => !s)} className="shrink-0 px-3 py-2 rounded-full bg-zinc-800 text-white text-[11px] font-bold" aria-label="Group settings">⚙ Settings</button>}
      <span className="shrink-0 text-[10px] sm:text-xs bg-white text-black px-2 py-1 rounded-full">{groupUsers.length} members</span>
    </div>

    {msg && <div role="alert" className="mx-3 mt-2 p-2 rounded-lg bg-rose-950 border border-rose-900 text-xs text-rose-300">{msg}</div>}

    {isAdmin && info && (
      <div className="p-3 sm:p-4 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-amber-400 to-purple-600 flex items-center justify-center text-white font-extrabold text-lg shrink-0">{(info.name || groupId)[0].toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">{info.name}</p>
            <p className="text-[11px] text-zinc-400 truncate">{info.description || 'No description yet'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {info.add_only !== undefined && <span className="text-[9px] font-extrabold px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">{info.invite_only || info.add_only ? '🔒 ADD-ONLY' : '🌍 OPEN TO JOIN'}</span>}
          {(info.lat != null && info.lng != null) ? <span className="text-[9px] font-extrabold px-2 py-1 rounded-full bg-emerald-900 text-emerald-300">📍 {info.location_label || 'Location linked'} · new members auto-assigned</span> : <span className="text-[9px] font-extrabold px-2 py-1 rounded-full bg-zinc-800 text-zinc-500">No location linked</span>}
        </div>
      </div>
    )}

    {isAdmin && showSettings && info && (
      <div className="p-3 sm:p-4 border-b border-zinc-800 space-y-3 bg-zinc-900">
        <h3 className="text-xs font-bold text-amber-400">GROUP SETTINGS</h3>
        <div>
          <label htmlFor="gs-name" className="block text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 mb-1">Group name</label>
          <input id="gs-name" value={name} onChange={e => setName(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#7C3AED]" />
        </div>
        <div>
          <label htmlFor="gs-desc" className="block text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 mb-1">Description</label>
          <input id="gs-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this group about?" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-[#7C3AED]" />
        </div>
        <div>
          <label htmlFor="gs-community" className="block text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 mb-1">Community</label>
          <input id="gs-community" value={community} onChange={e => setCommunity(e.target.value)} placeholder="e.g. Harvest Central" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-[#7C3AED]" />
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-bold">🔒 Add-only group</p>
            <p className="text-[11px] text-zinc-400">{addOnly ? 'Members cannot join — only you add them. Recommended for ministry teams.' : 'Anyone can tap Join (one-tap join).'}</p>
          </div>
          <button type="button" role="switch" aria-checked={addOnly} onClick={() => setAddOnly(v => !v)} className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${addOnly ? 'bg-[#7C3AED]' : 'bg-zinc-700'}`} aria-label="Toggle add-only">
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${addOnly ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
          <p className="text-sm font-bold">📍 Location link</p>
          <p className="text-[11px] text-zinc-400">New members who share GPS at signup are auto-placed in the nearest located group.</p>
          <input value={locLabel} onChange={e => setLocLabel(e.target.value)} placeholder="Area name (e.g. Kamakwa Road)" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-[#7C3AED]" />
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={captureLocation} disabled={locating} className="px-3 py-2 rounded-full bg-[#7C3AED] text-white text-[11px] font-bold disabled:opacity-50">{locating ? 'Locating…' : '📍 Pin my current location'}</button>
            {(info.lat != null || locLabel) && <button type="button" onClick={clearLocation} className="px-3 py-2 rounded-full bg-zinc-800 text-zinc-300 text-[11px] font-bold">Remove location</button>}
          </div>
          {info.lat != null && info.lng != null && <p className="text-[10px] text-emerald-400 font-mono">{info.lat.toFixed(5)}, {info.lng.toFixed(5)}</p>}
        </div>

        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void saveSettings()} className="flex-1 py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-extrabold disabled:opacity-50">{busy ? 'Saving…' : 'Save settings'}</button>
          <button type="button" onClick={() => setShowSettings(false)} className="px-4 py-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-bold">Cancel</button>
        </div>
      </div>
    )}

    {isAdmin && <div className="p-3 sm:p-4 border-b border-zinc-800 space-y-2">
      <h3 className="text-xs font-bold text-amber-400">ADD MEMBER</h3>
      <div className="flex gap-2">
        <input value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder="Add member username..." autoCapitalize="none" className="min-w-0 flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-sm outline-none" />
        <button type="button" disabled={busy} onClick={handleAdd} className="touch-target px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold disabled:opacity-50">Add</button>
      </div>
    </div>}

    <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-2 pb-6">
      {groupUsers.map((u: any) => <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800 min-w-0">
        <div className="w-10 h-10 shrink-0 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold">{String(u.username)[0].toUpperCase()}</div>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{u.name || u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 inline-flex items-center justify-center text-[8px]">✓</span>}</p><p className="text-[11px] text-zinc-400 truncate">@{u.username}{u.me ? ' (you)' : ''}</p></div>
        <div className="flex gap-1.5 items-center shrink-0 flex-wrap justify-end">
          <span className={`text-[9px] px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-purple-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>{u.role || 'member'}</span>
          {isAdmin && !u.me && <><button type="button" disabled={busy} onClick={() => handleToggleVerify(u.username, u.verified)} className="touch-target px-2 rounded-full bg-zinc-800 text-white text-[10px]" aria-label={u.verified ? `Unverify ${u.username}` : `Verify ${u.username}`}>{u.verified ? '✕' : '✓'}</button><button type="button" disabled={busy} onClick={() => handleToggleRole(u)} className="min-h-11 px-2 rounded-full bg-zinc-800 text-white text-[10px]">role</button><button type="button" disabled={busy} onClick={() => handleRemove(u.username)} className="min-h-11 px-2 rounded-full bg-red-900 text-white text-[10px]">remove</button></>}
        </div>
      </div>)}
      {groupUsers.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">No members yet — admin can add one above.</p>}
    </div>
  </div>
}
