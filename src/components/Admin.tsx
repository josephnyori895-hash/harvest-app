import { useCallback, useEffect, useState } from 'react'
import AdminMedia from './AdminMedia'
import { useCongregations } from '../lib/useCongregations'
import { shareAnnouncementToWhatsApp } from '../lib/whatsappShare'
import { timeAgo } from '../lib/time'

import ErrorMessage from './ErrorMessage'
import { Icon } from '../ui'
import { showToast } from './Toast'
import { runAction } from '../lib/actionFeedback'
import { presign, uploadToMinio } from '../lib/api'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
// The installed app always uses the API. The old VITE_USE_API gate silently
// disabled this whole screen in production builds.
const USE_API = true
// Example shapes shown in the advert editor's empty fields.
const ADVERT_SETTINGS_EXAMPLE = JSON.stringify({ placement: 'feed', interval: 6, daily_cap: 2 }, null, 2)
const ADVERT_EXAMPLE = JSON.stringify([{
  id: 'harvest-bookshop',
  title: 'Harvest Bookshop',
  body: 'Bibles, devotionals and Sunday-school books at the church entrance.',
  cta_url: 'https://example.com/bookshop',
  enabled: true,
  advertise_from: '2026-10-30T00:00:00Z',
  advertise_until: '2026-12-24T23:59:59Z',
}], null, 2)

type Tab = 'dashboard' | 'moderation' | 'media' | 'accounts' | 'announce' | 'audit' | 'home' | 'give' | 'chat' | 'adverts' | 'content'

type Props = {
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: () => void
  onOpenMusic?: () => void
  onOpenGive?: () => void
}

export default function Admin({ onBack, users, setUsers, onOpenGroups, onOpenDepartments, onOpenSermons, onOpenMusic, onOpenGive }: Props) {
  const { congregations: GROUPS } = useCongregations()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const token = () => localStorage.getItem('harvest_token') || ''

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }

  // Every admin action reports out loud: errors become a red toast with the real
  // server message, confirmations a green one. The inline banner stays too, but
  // an admin who scrolled far down the Everything editor never misses it.
  useEffect(() => { if (error) showToast(error, 'error', 6000) }, [error])
  useEffect(() => { if (notice) showToast(notice, 'success') }, [notice])

  // ── Daily operations dashboard ──
  const [dashboard, setDashboard] = useState({ pending: 0, members: 0, groups: 0, departments: 0, content: [] as any[], chats: [] as any[], audit: [] as any[] })
  const [loadingDashboard, setLoadingDashboard] = useState(false)

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

  // ── Chat moderation state ──
  const [chatConversations, setChatConversations] = useState<any[]>([])
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [selectedChat, setSelectedChat] = useState('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingChatMessages, setLoadingChatMessages] = useState(false)

  // ── Audit state ──
  const [audit, setAudit] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  // ── Home content state (hero banner + weekly verse) ──
  const [content, setContent] = useState<Record<string, string>>({})
  const [contentBusy, setContentBusy] = useState(false)
  // Everything editor: the server decides which keys are editable, the admin
  // edits them all in one place instead of hunting through six tabs.
  const [editable, setEditable] = useState<Record<string, number>>({})
  const [customLimit, setCustomLimit] = useState(1000)
  const [contentDraft, setContentDraft] = useState<Record<string, string> | null>(null)
  const [contentQuery, setContentQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const contentValue = (k: string) => contentDraft?.[k] ?? content[k] ?? ''
  const setContentValue = (k: string, v: string) => setContentDraft(d => ({ ...(d ?? content), [k]: v }))
  const CONTENT_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'hero_kicker', label: 'Small heading (top of banner)', hint: 'e.g. Karibu, family', max: 120 },
    { key: 'hero_title', label: 'Main banner title', hint: 'e.g. Compel. Raise. Release.', max: 120 },
    { key: 'hero_subtitle', label: 'Banner subtitle', hint: 'e.g. Get one saved, keep one saved, get another saved.', max: 300, textarea: true },
    { key: 'verse_text', label: 'This week’s encouragement — verse', hint: 'The quote shown mid-screen', max: 300, textarea: true },
    { key: 'verse_ref', label: 'Verse reference', hint: 'e.g. Hebrews 10:24 · Grow together', max: 120 },
    { key: 'pastor_usernames', label: 'Pastors’ usernames (Pray with Pastor)', hint: 'One username per line or comma-separated. Leave empty until pastors join.', max: 600, textarea: true },
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
  // ── Sponsored adverts in the Home feed ──
  // Stored as JSON in site_content; the feed worker interleaves them and caps
  // appearances per member per day, so saving here goes live on next refresh.
  const advertsJson = (() => { try { return JSON.stringify(JSON.parse(content.sponsor_adverts || '[]'), null, 2) } catch { return (content.sponsor_adverts || '[]') } })()
  const settingsJson = (() => { try { return JSON.stringify(JSON.parse(content.advert_settings || '{}'), null, 2) } catch { return (content.advert_settings || '{}') } })()
  const [advertsDraft, setAdvertsDraft] = useState<string | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<string | null>(null)
  // Photo composer: adverts should be made with a picture, not a pasted URL.
  const [adTitle, setAdTitle] = useState('')
  const [adBody, setAdBody] = useState('')
  const [adCta, setAdCta] = useState('')
  const [adPhoto, setAdPhoto] = useState<File | null>(null)
  const [adBusy, setAdBusy] = useState(false)
  const addAdvertWithPhoto = async () => {
    if (adBusy) return
    if (!adTitle.trim()) { setError('Give the advert a title'); return }
    if (!adPhoto) { setError('Choose a photo for this advert'); return }
    setError('')
    setAdBusy(true)
    const photo = adPhoto
    const res = await runAction('Uploading advert photo', async () => {
      const pre = await presign({
        type: 'post',
        contentType: photo.type || 'image/jpeg',
        bytes: photo.size,
        ext: (photo.name.split('.').pop() || 'jpg').toLowerCase(),
      })
      await uploadToMinio(pre.url, pre.fields, photo)
      return pre.key
    }, 'Photo uploaded ✓')
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Could not upload the photo')
      setAdBusy(false)
      return
    }
    let current: any[] = []
    try { current = JSON.parse((advertsDraft ?? advertsJson) || '[]') } catch { current = [] }
    const baseSlug = adTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    const id = baseSlug || `advert-${Date.now()}`
    const next = [...current, {
      id: current.some(a => a?.id === id) ? `${id}-${Date.now().toString(36).slice(-4)}` : id,
      title: adTitle.trim().slice(0, 80),
      body: adBody.trim().slice(0, 400),
      image_key: res.data,
      cta_url: adCta.trim() || window.location.origin,
      enabled: true,
    }]
    setAdvertsDraft(JSON.stringify(next, null, 2))
    setAdTitle(''); setAdBody(''); setAdCta(''); setAdPhoto(null)
    flash('Advert added — press Save below to publish it')
    setAdBusy(false)
  }
  useEffect(() => {
    fetch(`${API}/api/content`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        setContent(d?.content || {})
        if (d?.editable && typeof d.editable === 'object') setEditable(d.editable)
        if (Number(d?.customLimit) > 0) setCustomLimit(Number(d.customLimit))
      })
      .catch(() => { /* empty form is fine — placeholders show defaults */ })
  }, [])
  const saveContent = async () => {
    if (contentBusy) return
    setContentBusy(true)
    setError('')
    // Merge the Everything draft over the loaded content so a single save
    // publishes every edit, including keys added on the spot.
    const payload: Record<string, string> = { ...content, ...(contentDraft || {}) }
    const res = await runAction('Saving changes', async () => {
      const r = await fetch(`${API}/api/content`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
      return d
    }, 'Saved — live for everyone ✓')
    if (res.ok) {
      const d: any = res.data
      setContent(d.content || {})
      if (d.editable) setEditable(d.editable)
      setFundsDraft(null); setQuickDraft(null)
      setAdvertsDraft(null); setSettingsDraft(null); setContentDraft(null)
      flash('Saved — live for everyone ✓')
    } else {
      setError(res.error?.message || 'Could not save')
    }
    setContentBusy(false)
  }

  // ── Announce state ──
  const [annText, setAnnText] = useState('')
  const [annGroup, setAnnGroup] = useState<string>('')
  const [annBusy, setAnnBusy] = useState(false)
  const [annCount, setAnnCount] = useState<number | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true); setError('')
    const headers = { Authorization: 'Bearer ' + token() }
    try {
      const [pendingR, usersR, groupsR, departmentsR, contentR, chatsR, auditR] = await Promise.all([
        fetch(API + '/api/pending?status=pending', { headers }),
        fetch(API + '/api/users/map', { headers }),
        fetch(API + '/api/groups', { headers }),
        fetch(API + '/api/departments', { headers }),
        fetch(API + '/api/feed?limit=8', { headers }),
        fetch(API + '/api/chat/conversations', { headers }),
        fetch(API + '/api/admin/audit?limit=8', { headers }),
      ])
      const read = async (r: Response) => r.ok ? r.json() : {}
      const [p,u,g,d,feed,ch,a] = await Promise.all([read(pendingR),read(usersR),read(groupsR),read(departmentsR),read(contentR),read(chatsR),read(auditR)])
      setDashboard({
        pending: (p.pending || []).length,
        members: (u.users || []).filter((member: any) => {
          const created = member.created_at ? new Date(member.created_at).getTime() : 0
          return created > Date.now() - 7 * 24 * 60 * 60 * 1000
        }).length,
        groups: (g.groups || []).length,
        departments: (d.departments || []).length,
        content: (feed.posts || feed.items || feed.reels || []).slice(0, 8),
        chats: (ch.team_conversations || []).slice(0, 8),
        audit: (a.audit || []).slice(0, 8),
      })
    } catch (e: any) { setError(e?.message || 'Unable to load dashboard') } finally { setLoadingDashboard(false) }
  }, [])

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

  const loadChatConversations = useCallback(async () => {
    setLoadingChats(true); setError('')
    try {
      const r = await fetch(API + '/api/chat/conversations', { headers: { Authorization: 'Bearer ' + token() } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Unable to load conversations')
      const team = (d.conversations || []).filter((x: any) => x.key?.startsWith('group:') || x.key?.startsWith('department:'))
      setChatConversations(team)
      if (!selectedChat && team[0]?.key) setSelectedChat(team[0].key)
    } catch (e: any) { setError(e?.message || 'Unable to load conversations') } finally { setLoadingChats(false) }
  }, [selectedChat])

  const loadChatMessages = useCallback(async () => {
    if (!selectedChat) return
    setLoadingChatMessages(true); setError('')
    try {
      const prefix = selectedChat.startsWith('group:') ? 'group' : 'department'
      const slug = selectedChat.slice(prefix.length + 1)
      const r = await fetch(API + '/api/chat/history?' + prefix + '=' + encodeURIComponent(slug) + '&limit=100', { headers: { Authorization: 'Bearer ' + token() } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Unable to load messages')
      setChatMessages(d.messages || [])
    } catch (e: any) { setError(e?.message || 'Unable to load messages') } finally { setLoadingChatMessages(false) }
  }, [selectedChat])

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
    if (tab === 'dashboard') void loadDashboard()
    if (tab === 'moderation') void loadPending()
    if (tab === 'accounts') void loadAccounts()
    if (tab === 'chat') void loadChatConversations()
    if (tab === 'chat') void loadChatMessages()
    if (tab === 'audit') void loadAudit()
  }, [tab, loadDashboard, loadPending, loadAccounts, loadChatConversations, loadChatMessages, loadAudit])

  // Dashboard counts go stale when a group is created/deleted elsewhere —
  // re-pull whenever the groups table changes.
  useEffect(() => {
    const onGroupsChanged = () => { if (tab === 'dashboard') void loadDashboard() }
    window.addEventListener('harvest:groups-changed', onGroupsChanged)
    return () => window.removeEventListener('harvest:groups-changed', onGroupsChanged)
  }, [tab, loadDashboard])

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

  const moderateChatMessage = async (message: any) => {
    if (busy || !message?.id) return
    if (!window.confirm('Remove this message for everyone?')) return
    setBusy(String(message.id)); setError('')
    try {
      const r = await fetch(API + '/api/chat/messages/' + encodeURIComponent(message.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token() } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Unable to remove message')
      setChatMessages(list => list.map(x => String(x.id) === String(message.id) ? { ...x, deleted_at: new Date().toISOString(), text: 'This message was deleted' } : x))
      flash('Message removed for everyone')
    } catch (e: any) { setError(e?.message || 'Unable to remove message') } finally { setBusy(null) }
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

  // Pagination: render one page of member cards at a time. Rendering the full
  // directory (each card = 10+ controls) janks past a few hundred members on
  // low-end phones. Page size 30 keeps scroll weight bounded; search and
  // pagination compose (page resets to 1 on query change).
  const ACCOUNTS_PAGE_SIZE = 30
  const [accountsPage, setAccountsPage] = useState(1)
  const accountsPages = Math.max(1, Math.ceil(filteredAccounts.length / ACCOUNTS_PAGE_SIZE))
  const safeAccountsPage = Math.min(accountsPage, accountsPages)
  const pagedAccounts = filteredAccounts.slice((safeAccountsPage - 1) * ACCOUNTS_PAGE_SIZE, safeAccountsPage * ACCOUNTS_PAGE_SIZE)
  // Reset to the first page whenever the search query changes.
  useEffect(() => { setAccountsPage(1) }, [q])

  return (
    <div className="bg-surface text-ink min-h-[70vh] p-4">
      <div className="mb-4 flex items-start gap-3">
        <button onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-raised text-ink" aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold tracking-tight">Admin</h1>
          <p className="text-2xs text-ink-muted">Run the church: members, media, money, copy and chats</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-2xs font-extrabold text-accent-strong">
          {tab === 'moderation' ? `${pending.length} ${status}` : tab === 'accounts' ? `${accounts.length} members` : tab === 'media' ? 'Studio' : tab === 'announce' ? 'Notify' : tab === 'content' ? 'Everything' : 'Admin'}
        </span>
      </div>

      {/* Direct reach into every surface — no dead ends, no hunting. */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {([
          ['Members', 'users', () => setTab('accounts')],
          ['Approvals', 'shield', () => setTab('moderation')],
          ['Groups', 'users', () => onOpenGroups?.()],
          ['Departments', 'building', () => onOpenDepartments?.()],
          ['Sermons', 'mic', () => onOpenSermons?.()],
          ['Worship', 'music', () => onOpenMusic?.()],
          ['Giving', 'coins', () => onOpenGive?.()],
          ['All text', 'sparkle', () => setTab('content')],
        ] as const).map(([label, icon, action]) => (
          <button key={label} type="button" onClick={action} className="flex min-h-11 items-center gap-2 rounded-2xl border border-line bg-surface-raised px-3 text-2xs font-extrabold text-ink transition hover:bg-surface-sunken">
            <Icon name={icon} size={16} className="text-accent" /> {label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Admin sections">
        {([
          ['dashboard', 'Today'], ['moderation', 'Approvals'], ['media', 'Studio'], ['accounts', 'Members'],
          ['announce', 'Announce'], ['content', 'Everything'], ['home', 'Home text'], ['give', 'Give text'],
          ['adverts', 'Adverts'], ['chat', 'Chats'], ['audit', 'Audit'],
        ] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-2xs font-extrabold transition ${tab === value ? 'bg-ink text-white shadow' : 'border border-line bg-surface-raised text-ink-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Everything: every editable display string, one editor ── */}
      {tab === 'content' && (
        <div className="space-y-3" data-testid="admin-content">
          <div className="rounded-card border border-line bg-surface-raised p-4">
            <h2 className="text-sm font-extrabold">Every word the church reads</h2>
            <p className="mt-1 text-2xs text-ink-muted">
              Home banner, giving copy, page titles, contact details, community rules — plus any new
              <b> copy_</b> or <b>app_</b> key you add below. One save publishes all of it.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-full border border-line bg-surface px-3.5">
              <Icon name="search" size={16} className="text-ink-subtle" />
              <input value={contentQuery} onChange={e => setContentQuery(e.target.value)} placeholder="Find a setting…" className="min-h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle" aria-label="Find a content setting" />
              {contentDraft && <span className="shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold text-gold-strong">{Object.keys(contentDraft).length} edited</span>}
            </div>
          </div>

          <div className="space-y-2">
            {[...new Set([...Object.keys(editable), ...Object.keys(content), ...Object.keys(contentDraft || {})])]
              .filter(k => !contentQuery.trim() || k.includes(contentQuery.trim().toLowerCase().replace(/\s+/g, '_')))
              .sort()
              .map(k => {
                const limit = editable[k] || customLimit
                const value = contentValue(k)
                const isJson = /^(giving_funds|giving_quick|giving_payment_methods|sponsor_adverts|advert_settings)$/.test(k)
                return (
                  <div key={k} className="rounded-card border border-line bg-surface-raised p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <label htmlFor={`all-${k}`} className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">{k.replace(/_/g, ' ')}</label>
                      <span className="shrink-0 text-[10px] text-ink-subtle">{value.length}/{limit}</span>
                    </div>
                    <textarea
                      id={`all-${k}`}
                      value={value}
                      onChange={e => setContentValue(k, e.target.value.slice(0, limit))}
                      rows={isJson ? 5 : value.length > 90 ? 4 : 2}
                      spellCheck={false}
                      className={`mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent ${isJson ? 'font-mono text-xs' : ''}`}
                    />
                  </div>
                )
              })}
          </div>

          <div className="rounded-card border border-line bg-surface-raised p-3">
            <label htmlFor="new-content-key" className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Add a new key</label>
            <div className="mt-2 flex gap-2">
              <input id="new-content-key" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="copy_new_heading" className="input-base min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => {
                  const k = newKey.trim().toLowerCase()
                  if (!/^(copy|app)_[a-z0-9_]{1,40}$/.test(k)) { setError('Custom keys must start with copy_ or app_ (a–z, 0–9, _)'); return }
                  setError('')
                  setContentValue(k, '')
                  setNewKey('')
                  flash(`${k} added — edit it above, then save`)
                }}
                className="shrink-0 rounded-full bg-accent px-4 text-2xs font-extrabold text-white"
              >Add</button>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-muted">Use this for new surfaces so no wording ever waits on a code change.</p>
          </div>

          <button onClick={() => void saveContent()} disabled={contentBusy} data-testid="admin-content-save" className="min-h-11 w-full rounded-full bg-accent text-sm font-extrabold text-white disabled:opacity-50">
            {contentBusy ? 'Saving…' : 'Save every change — live for everyone'}
          </button>
        </div>
      )}

      {error && <ErrorMessage message={error} />}
      {notice && <div role="status" className="mb-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{notice}</div>}
      {!USE_API && <div className="mb-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm">Admin tools require the server API. Enable VITE_USE_API=true in production.</div>}

      {/* ── Daily operations dashboard ── */}
      {tab === 'dashboard' && (
        <div className="space-y-3">
          {loadingDashboard ? <p className="text-sm text-ink-muted text-center py-10">Loading today’s operations…</p> : <>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Pending approvals', dashboard.pending, 'moderation', '🛡️'],
                ['New members (7d)', dashboard.members, 'accounts', '👥'],
                ['Active groups', dashboard.groups, 'groups', '🟣'],
                ['Departments', dashboard.departments, 'departments', '🏢'],
              ].map(([label,count,target,icon]) => <button key={String(label)} onClick={() => target === 'groups' ? onOpenGroups?.() : target === 'departments' ? onOpenDepartments?.() : setTab(target as Tab)} className="text-left bg-white border border-line rounded-2xl p-4"><span className="text-lg">{icon}</span><p className="text-2xl font-extrabold mt-1">{count}</p><p className="text-[11px] text-ink-muted">{label}</p></button>)}
            </div>
            <div className="bg-white border border-line rounded-2xl p-4">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-sm">⚡ Quick actions</h2><button onClick={() => void loadDashboard()} className="text-xs font-bold text-accent">Refresh</button></div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button onClick={() => setTab('moderation')} className="py-3 rounded-xl bg-accent-soft text-accent-strong text-xs font-bold">Review approvals</button>
                <button onClick={() => setTab('accounts')} className="py-3 rounded-xl bg-surface-sunken text-xs font-bold">Manage members</button>
                <button onClick={() => onOpenGroups?.()} className="py-3 rounded-xl bg-surface-sunken text-xs font-bold">Manage groups</button>
                <button onClick={() => onOpenDepartments?.()} className="py-3 rounded-xl bg-surface-sunken text-xs font-bold">Manage departments</button>
                <button onClick={() => setTab('announce')} className="py-3 rounded-xl bg-surface-sunken text-xs font-bold">Send announcement</button>
                <button onClick={() => setTab('chat')} className="py-3 rounded-xl bg-surface-sunken text-xs font-bold">Moderate chat</button>
              </div>
            </div>
            <div className="bg-white border border-line rounded-2xl p-4">
              <h2 className="font-extrabold text-sm mb-3">📰 Recent content</h2>
              {dashboard.content.length ? dashboard.content.map((x:any) => <div key={x.id} className="py-2 border-b border-surface-sunken last:border-0"><p className="text-xs font-bold">{x.caption || x.title || x.username || 'Content'}</p><p className="text-[10px] text-ink-muted">{x.type || 'post'} · {x.created_at ? timeAgo(x.created_at) : ''}</p></div>) : <p className="text-xs text-ink-muted">No recent content.</p>}
            </div>
            <div className="bg-white border border-line rounded-2xl p-4">
              <h2 className="font-extrabold text-sm mb-3">💬 Recent chat activity</h2>
              {dashboard.chats.length ? dashboard.chats.map((x:any) => <div key={x.conversation_key} className="py-2 border-b border-surface-sunken last:border-0"><p className="text-xs font-bold">{x.name}</p><p className="text-[10px] text-ink-muted truncate">{x.last_from ? '@'+x.last_from+' · ' : ''}{x.last_text || 'No messages'} · {x.unread || 0} unread</p></div>) : <p className="text-xs text-ink-muted">No recent team chat activity.</p>}
            </div>
            <div className="bg-white border border-line rounded-2xl p-4">
              <div className="flex items-center justify-between"><h2 className="font-extrabold text-sm">🧾 Recent admin actions</h2><button onClick={() => setTab('audit')} className="text-xs font-bold text-accent">View all</button></div>
              {dashboard.audit.length ? dashboard.audit.map((x:any) => <div key={x.id} className="py-2 border-b border-surface-sunken last:border-0"><p className="text-xs font-bold">{x.action}</p><p className="text-[10px] text-ink-muted">{x.actor_username || 'system'} → {x.target_type} {x.target_id || ''} · {new Date(x.created_at).toLocaleString()}</p></div>) : <p className="text-xs text-ink-muted mt-2">No admin actions recorded yet.</p>}
            </div>
          </>}
        </div>
      )}

      {/* ── Media studio tab ── */}
      {tab === 'media' && <AdminMedia onBack={() => setTab('moderation')} />}

      {/* ── Announce tab ── */}
      {tab === 'announce' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-line space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">📣 Announce to members</h2>
              <p className="text-xs text-ink-muted mt-0.5">Lands as a direct message in every member's chat — with an unread badge. Members can reply straight back to you.</p>
            </div>
            <div>
              <label htmlFor="ann-body" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Announcement</label>
              <textarea
                id="ann-body"
                value={annText}
                onChange={e => setAnnText(e.target.value.slice(0, 2000))}
                rows={5}
                placeholder="e.g. Sunday service starts 9:00 AM at Harvest Central. Come with a friend! 🙏"
                className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-ink-subtle resize-y"
              />
              <p className="text-[10px] text-ink-muted text-right mt-1">{annText.length}/2000</p>
            </div>
            <div>
              <label htmlFor="ann-group" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Send to</label>
              <select
                id="ann-group"
                value={annGroup}
                onChange={e => setAnnGroup(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-3 text-sm font-medium outline-none focus:border-accent"
              >
                <option value="">All members (every congregation)</option>
                {GROUPS.map(g => <option key={g} value={g}>{g} only</option>)}
              </select>
            </div>
            <button
              onClick={sendAnnounce}
              disabled={annBusy || annText.trim().length < 2}
              className="w-full py-3.5 rounded-xl bg-accent text-white text-sm font-extrabold disabled:opacity-50"
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
            <p className="text-[10px] text-ink-muted">Every send is recorded in the Audit tab. Use responsibly — this reaches the whole church.</p>
          </div>
        </div>
      )}

      {/* ── Home text tab: edit the banner + weekly verse ── */}
      {/* (The Everything tab above covers every key; these stay as guided forms.) */}
      {tab === 'home' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-line space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">🏠 Home screen text</h2>
              <p className="text-xs text-ink-muted mt-0.5">Edits what every member sees at the top of the Community screen — the purple banner and the weekly encouragement. Changes go live for everyone immediately.</p>
            </div>
            {CONTENT_FIELDS.map(f => (
              <div key={f.key}>
                <label htmlFor={`ct-${f.key}`} className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">{f.label}</label>
                {f.key === 'pastor_usernames' ? (
                  <div>
                    <textarea id={`ct-${f.key}`} value={content[f.key] ?? content.pastor_username ?? ''}
                      onChange={e => setContent(c => ({ ...c, pastor_usernames: e.target.value.slice(0, f.max) }))}
                      rows={3} placeholder={f.hint}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y" />
                    <p className="text-[10px] text-ink-muted mt-1">Use real usernames, not display names. Multiple pastors are supported.</p>
                  </div>
                ) : f.textarea ? (
                  <textarea
                    id={`ct-${f.key}`}
                    value={content[f.key] ?? ''}
                    onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))}
                    rows={2}
                    placeholder={f.hint}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-ink-subtle resize-y"
                  />
                ) : (
                  <input
                    id={`ct-${f.key}`}
                    value={content[f.key] ?? ''}
                    onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))}
                    placeholder={f.hint}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-ink-subtle"
                  />
                )}
                <p className="text-[10px] text-ink-muted text-right mt-0.5">{(content[f.key] ?? '').length}/{f.max}</p>
              </div>
            ))}
            <button
              onClick={() => void saveContent()}
              disabled={contentBusy}
              className="w-full py-3.5 rounded-xl bg-accent text-white text-sm font-extrabold disabled:opacity-50"
            >
              {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
            </button>
            <p className="text-[10px] text-ink-muted">Tip: clear a field to restore the original default wording. Members see changes the next time they open the Community screen.</p>
          </div>
        </div>
      )}

      {/* ── Give text tab: edit the giving screen ── */}
      {tab === 'give' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-line space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">💰 Give screen</h2>
              <p className="text-xs text-ink-muted mt-0.5">Edit the giving headline, the Paybill fallback details, the giving funds (buttons) and the quick amounts. Saves go live for every member immediately.</p>
            </div>
            {GIVE_FIELDS.map(f => (
              <div key={f.key}>
                <label htmlFor={`gv-${f.key}`} className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">{f.label}</label>
                {f.textarea ? (
                  <textarea id={`gv-${f.key}`} value={content[f.key] ?? ''} onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))} rows={2} placeholder={f.hint} className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent resize-y" />
                ) : (
                  <input id={`gv-${f.key}`} value={content[f.key] ?? ''} onChange={e => setContent(c => ({ ...c, [f.key]: e.target.value.slice(0, f.max) }))} placeholder={f.hint} className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                )}
              </div>
            ))}
            <div>
              <label htmlFor="gv-funds" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Giving funds (one per line: id | Label | sub-text | icon)</label>
              <textarea
                id="gv-funds"
                value={fundsDraft ?? fundsJson}
                onChange={e => setFundsDraft(e.target.value)}
                rows={5}
                placeholder="tithe | Tithe | First fruits | 💰"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-mono outline-none focus:border-accent resize-y"
              />
              <p className="text-[10px] text-ink-muted mt-0.5">Max 12 funds. The id is one word (tithe, offering, building…). Icon is any emoji. Clear to restore the defaults.</p>
            </div>
            <div>
              <label htmlFor="gv-quick" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Quick amounts (comma separated KES)</label>
              <input
                id="gv-quick"
                value={quickDraft ?? (() => { try { return (JSON.parse(content.giving_quick || '[]') as number[]).join(', ') } catch { return '' } })()}
                onChange={e => setQuickDraft(e.target.value)}
                placeholder="100, 200, 500, 1000, 2500, 5000"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
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
              className="w-full py-3.5 rounded-xl bg-accent text-white text-sm font-extrabold disabled:opacity-50"
            >
              {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
            </button>
            <p className="text-[10px] text-ink-muted">These settings change what members see. The M-Pesa STK push itself is controlled by the server’s Daraja keys, not here.</p>
          </div>
        </div>
      )}

      {/* ── Sponsored adverts tab ── */}
      {tab === 'adverts' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-line space-y-3">
            <div>
              <h2 className="font-extrabold text-sm">📢 Sponsored adverts</h2>
              <p className="text-xs text-ink-muted mt-0.5">Third-party adverts shown inside the Community feed. Each member sees an advert at most “daily cap” times a day — counted on the server, so refreshing cannot show it more.</p>
            </div>
            <div>
              <label htmlFor="ad-settings" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Placement and limits</label>
              <textarea
                id="ad-settings"
                value={settingsDraft ?? settingsJson}
                onChange={e => setSettingsDraft(e.target.value)}
                rows={4}
                placeholder={ADVERT_SETTINGS_EXAMPLE}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-mono outline-none focus:border-accent resize-y"
              />
              <p className="text-[10px] text-ink-muted mt-0.5">placement: <b>feed</b> or <b>none</b> · interval: 3–20 posts between adverts · daily_cap: 1–10 appearances per member per day.</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-3" data-testid="advert-photo-composer">
              <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">New advert with a photo</p>
              <p className="mt-1 text-[10px] text-ink-muted">Upload a picture straight from your phone — no hosting or link needed. It is added to the list below for you to review.</p>
              <label htmlFor="ad-photo" className="mt-2 flex min-h-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-sunken">
                {adPhoto
                  ? <img src={URL.createObjectURL(adPhoto)} alt="Selected advert" className="h-24 w-full object-cover" />
                  : <span className="flex items-center gap-2 text-2xs font-bold text-ink-muted"><Icon name="camera" size={18} /> Choose a photo</span>}
                <input
                  id="ad-photo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { setAdPhoto(e.target.files?.[0] || null); e.target.value = '' }}
                />
              </label>
              <input value={adTitle} onChange={e => setAdTitle(e.target.value.slice(0, 80))} placeholder="Headline (e.g. Harvest Bookshop)" className="input-base mt-2" aria-label="Advert headline" />
              <textarea value={adBody} onChange={e => setAdBody(e.target.value.slice(0, 400))} rows={2} placeholder="One or two lines about the offer" className="input-base mt-2 resize-y" aria-label="Advert body" />
              <input value={adCta} onChange={e => setAdCta(e.target.value)} placeholder="Link (optional — defaults to the church site)" className="input-base mt-2" aria-label="Advert link" />
              <button type="button" onClick={() => void addAdvertWithPhoto()} disabled={adBusy || !adPhoto || !adTitle.trim()} className="mt-2 min-h-11 w-full rounded-full bg-ink text-2xs font-extrabold text-white disabled:opacity-40">
                {adBusy ? 'Uploading photo…' : 'Add this advert'}
              </button>
            </div>

            <div>
              <label htmlFor="ad-list" className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1">Adverts (JSON array)</label>
              <textarea
                id="ad-list"
                value={advertsDraft ?? advertsJson}
                onChange={e => setAdvertsDraft(e.target.value)}
                rows={10}
                placeholder={ADVERT_EXAMPLE}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-xs font-mono outline-none focus:border-accent resize-y"
              />
              <p className="text-[10px] text-ink-muted mt-0.5">Max 20 adverts. Required: <b>id</b> (a–z, 0–9, - or _), <b>title</b> (80 chars) and <b>cta_url</b> (http/https). Optional: <b>body</b> (400), <b>image_key</b> (an uploaded photo — added by the composer above), <b>image_url</b> (external link), <b>enabled</b>, <b>audience</b> (all | members), <b>advertise_from</b> / <b>advertise_until</b> (ISO date-times for scheduled runs).</p>
            </div>
            <button
              onClick={() => {
                if (!window.confirm('Publish these adverts to the Home feed?')) return
                let adverts: unknown
                let settings: unknown
                try { adverts = JSON.parse((advertsDraft ?? advertsJson) || '[]') } catch { setError('Adverts must be valid JSON'); return }
                try { settings = JSON.parse((settingsDraft ?? settingsJson) || '{}') } catch { setError('Placement and limits must be valid JSON'); return }
                setError('')
                void (async () => {
                  setContentBusy(true)
                  try {
                    const r = await fetch(`${API}/api/content`, {
                      method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sponsor_adverts: JSON.stringify(adverts), advert_settings: JSON.stringify(settings) }),
                    })
                    const d = await r.json().catch(() => ({}))
                    if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
                    setContent(d.content || content); setAdvertsDraft(null); setSettingsDraft(null)
                    flash('Adverts published — live on the next feed refresh ✓')
                  } catch (e: any) { setError(e?.message || 'Could not save adverts') } finally { setContentBusy(false) }
                })()
              }}
              disabled={contentBusy}
              className="w-full py-3.5 rounded-xl bg-accent text-white text-sm font-extrabold disabled:opacity-50"
            >
              {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
            </button>
            <p className="text-[10px] text-ink-muted">Leave the list as <b>[]</b> to switch sponsored adverts off. Adverts are always labelled Sponsored and never styled as church posts.</p>
          </div>
        </div>
      )}

      {/* ── Moderation tab ── */}
      {tab === 'moderation' && (
        <>
          <div className="flex gap-2 mb-4 overflow-auto">
            {(['pending', 'transcoding', 'rejected'] as const).map(value => <button key={value} onClick={() => setStatus(value)} className={`px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap ${status === value ? 'bg-accent text-white' : 'bg-white border border-line'}`}>{value[0].toUpperCase() + value.slice(1)}</button>)}
            <button onClick={() => void cleanup()} disabled={cleanupBusy} className="ml-auto px-3 py-2 rounded-full text-xs font-bold bg-surface-sunken border border-line disabled:opacity-50">{cleanupBusy ? 'Cleaning…' : 'Clean orphaned uploads'}</button>
          </div>
          {pending.length === 0 ? <p className="text-sm text-ink-muted text-center py-12">No {status} media — all caught up.</p> : pending.map(item => (
            <div key={item.id} className="bg-white border border-line rounded-3xl p-4 mb-3 shadow-sm">
              <div className="flex justify-between items-center"><span className="text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-accent-soft text-accent-strong">{item.type}</span><span className="text-xs text-ink-muted">{new Date(item.created_at).toLocaleString()}</span></div>
              <p className="text-sm font-semibold mt-3">{item.name || item.username || 'Harvest member'}</p>
              <p className="text-sm text-ink-muted mt-1">{item.caption || 'No caption'}</p>
              {item.thumb_url && <img src={item.thumb_url} alt="Pending media" className="w-full max-h-72 object-cover rounded-2xl mt-3 bg-surface-sunken" />}
              {status === 'pending' && <div className="flex gap-2 mt-3"><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'approve')} className="flex-1 py-2.5 rounded-2xl bg-accent text-white text-sm font-bold disabled:opacity-50">{busy === String(item.id) ? 'Working…' : 'Approve & publish'}</button><button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'reject')} className="flex-1 py-2.5 rounded-2xl bg-surface-sunken text-[#BE185D] text-sm font-bold disabled:opacity-50">Reject</button></div>}
              {status === 'rejected' && item.reject_reason && <p className="text-xs text-[#BE185D] mt-3">Reason: {item.reject_reason}</p>}
            </div>
          ))}
        </>
      )}

      {/* ── Accounts tab ── */}
      {tab === 'accounts' && (
        <>
          <div className="flex gap-2 mb-3">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search members…" className="flex-1 bg-white border border-line rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-accent" />
            <button onClick={() => setShowCreate(v => !v)} className="px-4 py-2.5 rounded-2xl bg-accent text-white text-xs font-bold whitespace-nowrap">＋ New account</button>
          </div>

          {showCreate && (
            <div className="bg-white border border-line rounded-3xl p-4 mb-3 space-y-2">
              <p className="text-sm font-bold">Create member account</p>
              <div className="flex gap-2">
                <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} placeholder="username" className="flex-1 bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-accent" />
                <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Full name" className="flex-1 bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-accent" />
              </div>
              <div className="flex gap-2">
                <input value={newUser.pin} onChange={e => setNewUser(u => ({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="PIN (4–6 digits)" inputMode="numeric" className="flex-1 bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-accent" />
                <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} className="bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <select value={newUser.group_name} onChange={e => setNewUser(u => ({ ...u, group_name: e.target.value }))} className="bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none max-w-[45%]">
                  {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <button onClick={() => void createUser()} disabled={busy === 'create'} className="w-full py-2.5 rounded-2xl bg-accent text-white text-sm font-bold disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create account'}</button>
            </div>
          )}

          {loadingAccounts ? <p className="text-sm text-ink-muted text-center py-10">Loading members…</p> : filteredAccounts.length === 0 ? <p className="text-sm text-ink-muted text-center py-10">No members found.</p> : pagedAccounts.map(u => (
            <div key={u.username} className="bg-white border border-line rounded-3xl p-4 mb-2">
              <button onClick={() => setExpanded(expanded === u.username ? null : u.username)} className="w-full flex gap-3 items-center justify-between text-left">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{u.name || u.username} {u.verified && <span className="text-accent">✓</span>}</p>
                  <p className="text-xs text-ink-muted truncate">@{u.username} · {u.group_name}</p>
                  {u.phone && <p className="text-xs text-ink-muted truncate">📞 {u.phone}</p>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${u.role === 'admin' ? 'bg-accent-soft text-accent-strong' : 'bg-surface-sunken text-ink-muted'}`}>{(u.role || 'member').toUpperCase()}</span>
              </button>
              {expanded === u.username && (
                <div className="mt-3 pt-3 border-t border-surface-sunken space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <select value={u.group_name || GROUPS[0]} onChange={e => void patchUser(u.username, { group_name: e.target.value })} className="flex-1 min-w-[140px] bg-surface border border-line rounded-xl px-3 py-2 text-xs outline-none">
                      {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select value={u.role || 'member'} onChange={e => void patchUser(u.username, { role: e.target.value })} className="bg-surface border border-line rounded-xl px-3 py-2 text-xs outline-none">
                      <option value="member">Member role</option>
                      <option value="admin">Admin role</option>
                    </select>
                  </div>
                  {u.role !== 'admin' && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-1">Leader powers (grants)</p>
                      <div className="flex gap-1.5 flex-wrap">
                      {([
                        ['post_media', 'Post media'],
                        ['create_groups', 'Create groups'],
                        ['manage_groups', 'Manage groups'],
                        ['manage_communities', 'Manage communities'],
                        ['delete_media', 'Delete media'],
                        ['moderate_chat', 'Moderate chats'],
                        ['manage_sermons', 'Manage sermons'],
                      ] as const).map(([cap, label]) => {
                        const on = (u.grants || '').split(',').filter(Boolean).includes(cap)
                        return (
                          <button key={cap} disabled={busy === u.username} onClick={() => void patchUser(u.username, { grants: on ? (u.grants || '').split(',').filter((g: string) => g && g !== cap) : [...(u.grants || '').split(',').filter(Boolean), cap] })} className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold border ${on ? 'bg-accent text-white border-accent' : 'bg-white text-ink-muted border-line'}`}>{label}</button>
                        )
                      })}
                      </div>
                      <p className="text-[10px] text-ink-muted mt-1">Pastors/leaders: tap to grant. Sermon Manager gives full control of the Sermons tab; other grants control their respective areas.</p>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button disabled={busy === u.username} onClick={() => { const p = window.prompt(`New PIN for ${u.username} (4–6 digits)`); if (p) void patchUser(u.username, { pin_reset: p }) }} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-surface-sunken text-ink-muted disabled:opacity-50">Reset PIN</button>
                    <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { verified: !u.verified })} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-accent-soft text-accent-strong disabled:opacity-50">{u.verified ? 'Remove ✓' : 'Verify ✓'}</button>
                    <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { active: u.active === false })} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-surface-sunken text-ink-muted disabled:opacity-50">{u.active === false ? 'Reactivate' : 'Deactivate'}</button>
                    <button disabled={busy === u.username} onClick={() => void removeUser(u.username)} className="flex-1 min-w-[100px] py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Pager: bounded DOM weight for large congregations */}
          {!loadingAccounts && filteredAccounts.length > ACCOUNTS_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 mt-3 px-1">
              <button
                onClick={() => setAccountsPage(p => Math.max(1, p - 1))}
                disabled={safeAccountsPage <= 1}
                className="px-4 py-2 rounded-full bg-white border border-line text-xs font-bold text-ink-muted disabled:opacity-40"
              >← Prev</button>
              <p className="text-xs text-ink-muted font-semibold">Page {safeAccountsPage} of {accountsPages} · {filteredAccounts.length} members</p>
              <button
                onClick={() => setAccountsPage(p => Math.min(accountsPages, p + 1))}
                disabled={safeAccountsPage >= accountsPages}
                className="px-4 py-2 rounded-full bg-white border border-line text-xs font-bold text-ink-muted disabled:opacity-40"
              >Next →</button>
            </div>
          )}

          <div className="mt-4 bg-white border border-line rounded-3xl p-4">
            <p className="text-sm font-bold">Restore a deactivated account</p>
            <p className="text-xs text-ink-muted mt-1">Deactivated members can't sign in until restored.</p>
            <div className="flex gap-2 mt-2">
              <input value={restoreName} onChange={e => setRestoreName(e.target.value)} placeholder="username" className="flex-1 bg-surface border border-line rounded-xl px-3 py-2 text-sm outline-none focus:border-accent" />
              <button onClick={() => void restoreUser()} disabled={busy === 'restore'} className="px-4 py-2 rounded-xl bg-accent text-white text-xs font-bold disabled:opacity-50">{busy === 'restore' ? '…' : 'Restore'}</button>
            </div>
          </div>
        </>
      )}

      {/* ── Chat moderation tab ── */}
      {tab === 'chat' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl bg-white border border-line">
            <h2 className="font-extrabold text-sm">💬 Chat moderation</h2>
            <p className="text-xs text-ink-muted mt-1">Review and remove messages from church group and department conversations.</p>
            {loadingChats ? <p className="text-xs py-4">Loading conversations…</p> : (
              <select value={selectedChat} onChange={e => setSelectedChat(e.target.value)} className="w-full mt-3 rounded-xl border border-line bg-surface px-3 py-3 text-sm">
                <option value="">Choose a conversation</option>
                {chatConversations.map((x: any) => <option key={x.key} value={x.key}>{x.name || x.key}</option>)}
              </select>
            )}
          </div>
          {selectedChat && (loadingChatMessages ? <p className="text-xs text-center py-8">Loading messages…</p> : chatMessages.length === 0 ? <p className="text-xs text-center py-8 text-ink-muted">No messages in this conversation.</p> : (
            <div className="space-y-2">{chatMessages.map((m: any) => <div key={m.id} className="bg-white border border-line rounded-2xl p-3 flex gap-3 items-start"><div className="min-w-0 flex-1"><p className="text-[10px] font-bold text-ink-muted">@{m.from} · {m.at || ''}</p><p className={m.deleted_at ? 'text-xs italic text-ink-subtle' : 'text-sm'}>{m.text}</p></div>{!m.deleted_at && <button disabled={busy === String(m.id)} onClick={() => void moderateChatMessage(m)} className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold border border-rose-200">Remove</button>}</div>)}</div>
          ))}
        </div>
      )}

      {/* ── Audit tab ── */}
      {tab === 'audit' && (
        loadingAudit ? <p className="text-sm text-ink-muted text-center py-10">Loading audit log…</p> : audit.length === 0 ? <p className="text-sm text-ink-muted text-center py-10">No admin activity recorded yet.</p> : (
          <div className="space-y-2">
            {audit.map(entry => (
              <div key={entry.id} className="bg-white border border-line rounded-2xl px-4 py-3 flex gap-3 items-start">
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-surface-sunken text-ink-muted whitespace-nowrap">{entry.action}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{entry.actor_username || 'system'} → {entry.target_type} {String(entry.target_id).slice(0, 8)}</p>
                  <p className="text-[11px] text-ink-muted">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
