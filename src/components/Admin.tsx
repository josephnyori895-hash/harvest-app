import { useCallback, useEffect, useState } from 'react'
import AdminMedia from './AdminMedia'
import { shareAnnouncementToWhatsApp } from '../lib/whatsappShare'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
// The installed app always uses the API. The old VITE_USE_API gate silently
// disabled this whole screen in production builds.
const USE_API = true

const GROUPS = ['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo']
type Tab = 'moderation' | 'media' | 'accounts' | 'announce' | 'audit' | 'home' | 'give'

type Props = {
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: () => void
}

export default function Admin({ onBack, users, setUsers, onOpenGroups, onOpenDepartments, onOpenSermons }: Props) {
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

  // ── Home content state (hero banner + weekly verse) ──
  const [content, setContent] = useState<Record<string, string>>({})
  const [contentBusy, setContentBusy] = useState(false)
  const CONTENT_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'hero_kicker', label: 'Small heading (top of banner)', hint: 'e.g. Karibu, family', max: 120 },
    { key: 'hero_title', label: 'Main banner title', hint: 'e.g. Compel. Raise. Release.', max: 120 },
    { key: 'hero_subtitle', label: 'Banner subtitle', hint: 'e.g. Get one saved, keep one saved, get another saved.', max: 300, textarea: true },
    { key: 'verse_text', label: 'This week’s encouragement — verse', hint: 'The quote shown mid-screen', max: 300, textarea: true },
    { key: 'verse_ref', label: 'Verse reference', hint: 'e.g. Hebrews 10:24 · Grow together', max: 120 },
  ]
  // ── Give section fields ──
  const GIVE_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'giving_title', label: 'Giving headline', hint: 'e.g. Give with purpose', max: 120 },
    { key: 'giving_subtitle', label: 'Giving sub-text', hint: 'e.g. Secure M-Pesa giving for Harvest Family Church.', max: 300, textarea: true },
    { key: 'paybill_number', label: 'Paybill number (manual fallback)', hint: 'e.g. 4138895', max: 20 },
    { key: 'paybill_name', label: 'Paybill account name', hint: 'e.g. Harvest Family Church', max: 120 },
  ]
  const fundsJson = (() => { try { return JSON.stringify(JSON.parse(content.giving_funds || '[]'), null, 1) } catch { return (content.giving_funds || '') } })()
  const [fundsDraft, setFundsDraft] = useState<string | null>(null)
  const [quickDraft, setQuickDraft] = useState<string | null>(null)
  useEffect(() => {
    fetch(`${API}/api/content`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setContent(d?.content || {}))
      .catch(() => { /* empty form is fine — placeholders show defaults */ })
  }, [])
  const saveContent = async () => {
    if (contentBusy) return
    setContentBusy(true)
    try {
      const r = await fetch(`${API}/api/content`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
      setContent(d.content || {})
      setFundsDraft(null); setQuickDraft(null)
      flash('Saved — live for everyone ✓')
    } catch (e: any) { setError(e?.message || 'Could not save') } finally { setContentBusy(false) }
  }

  // ── Announce state ──
  const [annText, setAnnText] = useState('')
  const [annGroup, setAnnGroup] = useState<string>('')
  const [annBusy, setAnnBusy] = useState(false)
  const [annCount, setAnnCount] = useState<number | null>(null)

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

  const sendAnnounce = async () => {
    const text = annText.trim()
    if (annBusy) return
    if (text.length < 2) { setError('Write the announcement first (at least 2 characters)'); return }
    const scope = annGroup || 'ALL members'
    if (!window.confirm(`Send this announcement to ${scope}?\n\n${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`)) return
    setAnnBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/admin/announce`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, ...(annGroup ? { target_group: annGroup } : {}) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Announce failed')
      setAnnCount(data.recipients || 0)
      setAnnText('')
      setAnnGroup('')
      flash(`📣 Delivered to ${data.recipients} member${data.recipients === 1 ? '' : 's'}`)
    } catch (e: any) {
      setError(e?.message || 'Announce failed')
    } finally { setAnnBusy(false) }
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
          <p className="text-xs text-[#766E63]">Church-wide controls · Moderation · Accounts · Content · Audit</p>
        </div>
        <span className="ml-auto text-xs bg-[#F3E8FF] text-[#5B21B6] px-3 py-1.5 rounded-full font-bold whitespace-nowrap">            {tab === 'moderation' ? `${pending.length} ${status}` : tab === 'accounts' ? `${accounts.length} members` : tab === 'media' ? 'Studio' : tab === 'announce' ? '📣 Notify' : tab === 'home' ? '🏠 Edit' : 'Audit'}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button type="button" onClick={onOpenGroups} className="px-3 py-2.5 rounded-2xl bg-white border border-[#E8DEC9] text-[#5C554C] text-xs font-bold">👥 Manage Groups</button>
        <button type="button" onClick={onOpenDepartments} className="px-3 py-2.5 rounded-2xl bg-white border border-[#E8DEC9] text-[#5C554C] text-xs font-bold">🏢 Manage Departments</button>\n          <button type="button" onClick={onOpenSermons} className="px-3 py-2.5 rounded-2xl bg-white border border-[#E8DEC9] text-[#5C554C] text-xs font-bold">🎙 Manage Sermons</button>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(['moderation', 'media', 'accounts', 'announce', 'home', 'give', 'audit'] as const).map(value => (
          <button key={value} onClick={() => setTab(value)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition ${tab === value ? 'bg-[#7C3AED] text-white shadow' : 'bg-white border border-[#E8DEC9] text-[#5C554C]'}`}>
            {value === 'announce' ? '📣 Announce' : value === 'home' ? '🏠 Home text' : value === 'give' ? '💰 Give text' : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="mb-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{notice}</div>}
      {!USE_API && <div className="mb-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm">Admin tools require the server API. Enable VITE_USE_API=true in production.</div>}

      {/* ── Media studio tab ── */}
      {tab === 'media' && <AdminMedia onBack={() => setTab('moderation')} />}

      {/* ── Announce tab ── */}
      {tab === 'announce' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-[#E8DEC9] space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">📣 Announce to members</h2>
              <p className="text-xs text-[#766E63] mt-0.5">Lands as a direct message in every member's chat — with an unread badge. Members can reply straight back to you.</p>
            </div>
            <div>
              <label htmlFor="ann-body" className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">Announcement</label>
              <textarea
                id="ann-body"
                value={annText}
                onChange={e => setAnnText(e.target.value.slice(0, 2000))}
                rows={5}
                placeholder="e.g. Sunday service starts 9:00 AM at Harvest Central. Come with a friend! 🙏"
                className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-3 text-sm outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 placeholder:text-[#8A8171] resize-y"
              />
              <p className="text-[10px] text-[#766E63] text-right mt-1">{annText.length}/2000</p>
            </div>
            <div>
              <label htmlFor="ann-group" className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">Send to</label>
              <select
                id="ann-group"
                value={annGroup}
                onChange={e => setAnnGroup(e.target.value)}
                className="w-full rounded-xl border border-[#E8DEC9] bg-white px-3 py-3 text-sm font-medium outline-none focus:border-[#7C3AED]"
              >
                <option value="">All members (every congregation)</option>
                {GROUPS.map(g => <option key={g} value={g}>{g} only</option>)}
              </select>
            </div>
            <button
              onClick={sendAnnounce}
              disabled={annBusy || annText.trim().length < 2}
              className="w-full py-3.5 rounded-xl bg-[#7C3AED] text-white text-sm font-extrabold disabled:opacity-50"
            >
              {annBusy ? 'Sending…' : annGroup ? `📣 Send to ${annGroup}` : '📣 Send to all members'}
            </button>
            {annCount !== null && <p className="text-xs text-emerald-700 font-bold text-center">✓ Last announcement delivered to {annCount} members</p>}
            {annText.trim().length >= 2 && (
              <button
                onClick={() => shareAnnouncementToWhatsApp(annText.trim())}
                className="w-full py-3.5 rounded-xl bg-[#25D366] text-white text-sm font-extrabold flex items-center justify-center gap-2"
                title="Opens WhatsApp — pick the church group to post it in"
              >
                <span aria-hidden>🟢</span> Share this on WhatsApp
              </button>
            )}
            <p className="text-[10px] text-[#766E63]">Every send is recorded in the Audit tab. Use responsibly — this reaches the whole church.</p>
          </div>
        </div>
      )}

      {/* ── Home text tab: edit the banner + weekly verse ── */}
      {tab === 'home' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-[#E8DEC9] space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">🏠 Home screen text</h2>
              <p className="text-xs text-[#766E63] mt-0.5">Edits what every member sees at the top of the Community screen — the purple banner and the weekly encouragement. Changes go live for everyone immediately.</p>
            </div>
            {CONTENT_FIELDS.map(f => (
              <div key={f.key}>
                <label htmlFor={`ct-${f.key}`} className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">{f.label}</label>
                {f.textarea ? (
                  <textarea
                    id={`ct-${f.key}`}
                    value={content[f.key] ?? ''}
                    onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))}
                    rows={2}
                    placeholder={f.hint}
                    className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 placeholder:text-[#8A8171] resize-y"
                  />
                ) : (
                  <input
                    id={`ct-${f.key}`}
                    value={content[f.key] ?? ''}
                    onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))}
                    placeholder={f.hint}
                    className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/20 placeholder:text-[#8A8171]"
                  />
                )}
                <p className="text-[10px] text-[#766E63] text-right mt-0.5">{(content[f.key] ?? '').length}/{f.max}</p>
              </div>
            ))}
            <button
              onClick={() => void saveContent()}
              disabled={contentBusy}
              className="w-full py-3.5 rounded-xl bg-[#7C3AED] text-white text-sm font-extrabold disabled:opacity-50"
            >
              {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
            </button>
            <p className="text-[10px] text-[#766E63]">Tip: clear a field to restore the original default wording. Members see changes the next time they open the Community screen.</p>
          </div>
        </div>
      )}

      {/* ── Give text tab: edit the giving screen ── */}
      {tab === 'give' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-[#E8DEC9] space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">💰 Give screen</h2>
              <p className="text-xs text-[#766E63] mt-0.5">Edit the giving headline, the Paybill fallback details, the giving funds (buttons) and the quick amounts. Saves go live for every member immediately.</p>
            </div>
            {GIVE_FIELDS.map(f => (
              <div key={f.key}>
                <label htmlFor={`gv-${f.key}`} className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">{f.label}</label>
                {f.textarea ? (
                  <textarea id={`gv-${f.key}`} value={content[f.key] ?? ''} onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))} rows={2} placeholder={f.hint} className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED] resize-y" />
                ) : (
                  <input id={`gv-${f.key}`} value={content[f.key] ?? ''} onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))} placeholder={f.hint} className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
                )}
              </div>
            ))}
            <div>
              <label htmlFor="gv-funds" className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">Giving funds (one per line: id | Label | sub-text | icon)</label>
              <textarea
                id="gv-funds"
                value={fundsDraft ?? fundsJson}
                onChange={e => setFundsDraft(e.target.value)}
                rows={5}
                placeholder="tithe | Tithe | First fruits | 💰"
                className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-xs font-mono outline-none focus:border-[#7C3AED] resize-y"
              />
              <p className="text-[10px] text-[#766E63] mt-0.5">Max 12 funds. The id is one word (tithe, offering, building…). Icon is any emoji. Clear to restore the defaults.</p>
            </div>
            <div>
              <label htmlFor="gv-quick" className="block text-[10px] font-extrabold uppercase tracking-wider text-[#766E63] mb-1">Quick amounts (comma separated KES)</label>
              <input
                id="gv-quick"
                value={quickDraft ?? (() => { try { return (JSON.parse(content.giving_quick || '[]') as number[]).join(', ') } catch { return '' } })()}
                onChange={e => setQuickDraft(e.target.value)}
                placeholder="100, 200, 500, 1000, 2500, 5000"
                className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]"
              />
            </div>
            <button
              onClick={() => {
                if (!window.confirm('Save and publish these giving changes to every member?')) return
                // Parse the friendly funds format (id | Label | sub | icon) into JSON.
                const next: Record<string, string> = { ...content }
                if (fundsDraft !== null) {
                  const lines = fundsDraft.split('\n').map(l => l.trim()).filter(Boolean)
                  if (lines.length) {
                    const funds = lines.map(l => {
                      const [id, label, sub, icon] = l.split('|').map(x => (x || '').trim())
                      return { id: (id || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'), label: label || id, sub: sub || '', icon: icon || '💝' }
                    }).filter(f => f.id && f.label)
                    next.giving_funds = JSON.stringify(funds)
                  } else next.giving_funds = ''
                }
                if (quickDraft !== null) {
                  const nums = quickDraft.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
                  next.giving_quick = nums.length ? JSON.stringify(nums) : ''
                }
                setContent(next)
                setTimeout(() => {
                  void (async () => {
                    setContentBusy(true)
                    try {
                      const r = await fetch(`${API}/api/content`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
                      const d = await r.json().catch(() => ({}))
                      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
                      setContent(d.content || {}); setFundsDraft(null); setQuickDraft(null)
                      flash('Give screen updated — live for everyone ✓')
                    } catch (e: any) { setError(e?.message || 'Could not save') } finally { setContentBusy(false) }
                  })()
                }, 0)
              }}
              disabled={contentBusy}
              className="w-full py-3.5 rounded-xl bg-[#7C3AED] text-white text-sm font-extrabold disabled:opacity-50"
            >
              {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
            </button>
            <p className="text-[10px] text-[#766E63]">These settings change what members see. The M-Pesa STK push itself is controlled by the server’s Daraja keys, not here.</p>
          </div>
        </div>
      )}

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
