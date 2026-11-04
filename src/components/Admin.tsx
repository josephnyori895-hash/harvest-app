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
import GivingFundsEditor from './GivingFundsEditor'
import { VerifiedBadge } from './VerifiedBadge'
import { parseFunds, parseQuick } from '../lib/givingDefaults'
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

type Tab = 'dashboard' | 'moderation' | 'media' | 'accounts' | 'announce' | 'audit' | 'home' | 'give' | 'chat' | 'adverts' | 'content' | 'ministries'

type Props = {
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: () => void
  onOpenMusic?: () => void
  onOpenGive?: () => void
  onOpenMap?: () => void
}

export default function Admin({ onBack, users, setUsers, onOpenGroups, onOpenDepartments, onOpenSermons, onOpenMusic, onOpenGive, onOpenMap }: Props) {
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
  const [dashboard, setDashboard] = useState({ pending: 0, members: 0, groups: 0, departments: 0, online: 0, verified: 0, content: [] as any[], chats: [] as any[], audit: [] as any[] })
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
  const [accountFilter, setAccountFilter] = useState<'all' | 'verified' | 'admin' | 'inactive'>('all')
  // Ministries (departments) power both the ministry manager and the per-member
  // "Ministry" selector. One list, one source of truth.
  const [departments, setDepartments] = useState<any[]>([])
  const [newMinistry, setNewMinistry] = useState('')
  const [ministryNames, setMinistryNames] = useState<Record<string, string>>({})
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
    { key: 'giving_min_kes', label: 'Minimum gift (KES)', hint: 'e.g. 1', max: 10 },
    { key: 'giving_max_kes', label: 'Largest single gift the app accepts (KES)', hint: 'e.g. 1000000', max: 10 },
    { key: 'giving_note', label: 'Note under the give button', hint: 'e.g. Giving is secure and receipted by the church treasurer.', max: 300, textarea: true },
    { key: 'giving_history_title', label: '“My giving” heading', hint: 'e.g. My giving', max: 120 },
  ]
  // Funds and quick amounts are edited as real rows (GivingFundsEditor), never
  // as JSON in a textarea. Both write into the same draft as every other field.
  const adminFunds = parseFunds(contentValue('giving_funds'))
  const adminQuick = parseQuick(contentValue('giving_quick'))
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
  const saveContent = async (extra?: Record<string, string>) => {
    if (contentBusy) return
    // Send only what actually changed. The old panel PUT the whole content map
    // on every save; once the church had more than 40 copy rows the worker
    // rejected the request outright, which is why admin edits never landed.
    const draft: Record<string, string> = { ...(contentDraft || {}), ...(extra || {}) }
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => String(content[k] ?? '') !== String(v)))
    if (!Object.keys(changed).length) { flash('Nothing has changed yet'); return }
    setContentBusy(true)
    setError('')
    const res = await runAction('Saving changes', async () => {
      const r = await fetch(`${API}/api/content`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
      return d
    }, 'Saved — live for everyone ✓')
    if (res.ok) {
      const d: any = res.data
      setContent(d.content || {})
      if (d.editable) setEditable(d.editable)
      setAdvertsDraft(null); setSettingsDraft(null); setContentDraft(null)
      flash(`Saved ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? '' : 's'} — live for everyone ✓`)
      // Screens already mounted (Home, Give…) hold the content they loaded at
      // startup. Announce the new values so they repaint without a reload.
      if (d?.content) window.dispatchEvent(new CustomEvent('harvest:content-updated', { detail: d.content }))
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
        online: (u.users || []).filter((member: any) => member.online).length,
        verified: (u.users || []).filter((member: any) => member.verified).length,
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
      // Members and ministries load together: the member card needs each
      // person's current ministry to offer a valid change.
      const [response, depsResponse] = await Promise.all([
        fetch(`${API}/api/users/map`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${API}/api/departments`, { headers: { Authorization: `Bearer ${token()}` } }),
      ])
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to load accounts')
      setAccounts(data.users || [])
      const deps = await depsResponse.json().catch(() => ({}))
      if (depsResponse.ok) setDepartments(deps.departments || [])
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

  // The hero counters must be real on arrival, not zero until Overview is
  // visited for the first time.
  useEffect(() => { void loadDashboard() }, [loadDashboard])

  useEffect(() => {
    if (tab === 'dashboard') void loadDashboard()
    if (tab === 'moderation') void loadPending()
    if (tab === 'accounts' || tab === 'ministries') void loadAccounts()
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
    if (needle && !`${u.username} ${u.name} ${u.group_name} ${u.department_name || ''}`.toLowerCase().includes(needle)) return false
    if (accountFilter === 'verified') return Boolean(u.verified)
    if (accountFilter === 'admin') return u.role === 'admin'
    if (accountFilter === 'inactive') return u.active === false
    return true
  })

  // Move a member between ministries (or out of every ministry). The admin API
  // treats a transfer as authoritative, so this works even when the member was
  // already serving somewhere else.
  const changeMinistry = async (u: any, slug: string) => {
    if (busy) return
    if ((u.department_slug || '') === slug) return
    setBusy(u.username); setError('')
    try {
      if (!slug) {
        const r = await fetch(`${API}/api/departments/${encodeURIComponent(u.department_slug)}/members/${encodeURIComponent(u.username)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token()}` },
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not remove ministry')
      } else {
        const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/members`, {
          method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u.username, role: 'member' }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not change ministry')
      }
      const dep = departments.find((x: any) => x.slug === slug)
      setAccounts(list => list.map(x => x.username === u.username ? { ...x, department_slug: slug || null, department_name: dep?.name || null } : x))
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`${u.username} is now in ${dep?.name || 'no ministry'}`)
      // Refresh the ministry counts in the background (the member row already
      // updated optimistically above, so nothing flickers).
      void loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Could not change ministry')
    } finally { setBusy(null) }
  }

  const createMinistry = async () => {
    const name = newMinistry.trim()
    if (!name || busy === 'ministry-create') return
    setBusy('ministry-create'); setError('')
    try {
      const r = await fetch(`${API}/api/departments`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create ministry')
      setNewMinistry('')
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry “${name}” created`)
    } catch (e: any) { setError(e?.message || 'Could not create ministry') } finally { setBusy(null) }
  }

  const renameMinistry = async (dep: any) => {
    const name = (ministryNames[dep.slug] ?? dep.name ?? '').trim()
    if (!name || name === dep.name || busy === `ministry-${dep.slug}`) return
    setBusy(`ministry-${dep.slug}`); setError('')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(dep.slug)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not rename ministry')
      setMinistryNames(prev => { const next = { ...prev }; delete next[dep.slug]; return next })
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry renamed to “${name}”`)
    } catch (e: any) { setError(e?.message || 'Could not rename ministry') } finally { setBusy(null) }
  }

  const deleteMinistry = async (dep: any) => {
    if (busy === `ministry-del-${dep.slug}`) return
    if (!window.confirm(`Delete the ministry “${dep.name}”? Members are released from it and this cannot be undone.`)) return
    setBusy(`ministry-del-${dep.slug}`); setError('')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(dep.slug)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not delete ministry')
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry “${dep.name}” deleted`)
    } catch (e: any) { setError(e?.message || 'Could not delete ministry') } finally { setBusy(null) }
  }

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
    <div className="min-h-[70vh] bg-surface text-ink" data-testid="admin-shell">
      {/* ── Hero ── */}
      <header className="relative overflow-hidden border-b border-line bg-ink px-4 pb-4 pt-4 text-white">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-start gap-3">
          <button onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-white" aria-label="Back to profile">
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-gold">Harvest admin</p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">Control centre</h1>
            <p className="mt-1 text-xs text-white/60">People, ministries, content, money and messages — saved changes publish immediately.</p>
          </div>
          <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-extrabold text-white/80">Admin</span>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setTab('moderation')} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums">{dashboard.pending}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/60">Awaiting review</p>
          </button>
          <button type="button" onClick={() => setTab('accounts')} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums">{accounts.length || users.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/60">Members</p>
          </button>
          <button type="button" onClick={() => onOpenMap?.()} className="rounded-2xl border border-success/30 bg-success/15 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums text-emerald-300">{dashboard.online}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200/70">Active now</p>
          </button>
        </div>
      </header>

      {/* ── Navigation: direct shortcuts + grouped sections ── */}
      <nav className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur" data-testid="admin-nav" aria-label="Admin sections">
        <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            ['Groups', 'users', () => onOpenGroups?.()],
            ['Departments', 'building', () => onOpenDepartments?.()],
            ['Sermons', 'mic', () => onOpenSermons?.()],
            ['Worship', 'music', () => onOpenMusic?.()],
            ['Giving', 'coins', () => onOpenGive?.()],
            ['Live map', 'map', () => onOpenMap?.()],
          ] as const).map(([label, icon, action]) => (
            <button key={label} type="button" onClick={action} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3 text-2xs font-extrabold text-ink-muted transition hover:text-ink">
              <Icon name={icon} size={14} className="text-accent" /> {label}
            </button>
          ))}
        </div>
        <div className="space-y-1 px-3 pb-2 pt-2">
          {([
            ['Today', [['dashboard', 'Overview']]],
            ['People', [['moderation', 'Approvals'], ['accounts', 'Members'], ['ministries', 'Ministries']]],
            ['Content', [['content', 'All text'], ['home', 'Home text'], ['give', 'Giving copy'], ['adverts', 'Adverts'], ['media', 'Studio']]],
            ['Community', [['chat', 'Chats'], ['announce', 'Announce']]],
            ['System', [['audit', 'Audit']]],
          ] as [string, [Tab, string][]][]).map(([group, entries]) => (
            <div key={group} className="flex items-center gap-2">
              <span className="w-[52px] shrink-0 text-[9px] font-extrabold uppercase tracking-[0.12em] text-ink-subtle">{group}</span>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label={`${group} admin sections`}>
                {entries.map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-2xs font-extrabold transition ${tab === value ? 'bg-ink text-white shadow-sm' : 'border border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <main className="space-y-4 p-4 pb-24">
        {error && <ErrorMessage message={error} />}
        {notice && <div role="status" className="rounded-2xl border border-success/30 bg-success-soft p-3 text-sm font-semibold text-success">{notice}</div>}
        {!USE_API && <div className="rounded-2xl border border-gold/40 bg-gold-soft p-4 text-sm">Admin tools require the server API. Enable VITE_USE_API=true in production.</div>}

        {/* ── Overview ── */}
        {tab === 'dashboard' && (
          <div className="space-y-3" data-testid="admin-dashboard">
            {loadingDashboard ? (
              <div className="rounded-card border border-line bg-surface-raised p-8 text-center text-sm text-ink-muted">Loading today’s operations…</div>
            ) : (
              <>
                {dashboard.pending > 0 && (
                  <button type="button" onClick={() => setTab('moderation')} className="flex w-full items-center gap-3 rounded-card border border-gold/40 bg-gold-soft p-4 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/20 text-gold-strong"><Icon name="alert" size={19} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-ink">{dashboard.pending} item{dashboard.pending === 1 ? '' : 's'} waiting for approval</span>
                      <span className="block text-2xs text-ink-muted">Members are waiting for their post to reach the church feed.</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="shrink-0 text-gold-strong" />
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['Awaiting review', dashboard.pending, 'moderation', 'alert'],
                    ['Verified members', dashboard.verified, 'accounts', 'check'],
                    ['New members · 7d', dashboard.members, 'accounts', 'users'],
                    ['Ministries', dashboard.departments, 'ministries', 'building'],
                  ] as const).map(([label, count, target, icon]) => (
                    <button key={label} type="button" onClick={() => setTab(target as Tab)} className="rounded-card border border-line bg-surface-raised p-4 text-left transition hover:border-accent/40 hover:bg-surface-sunken">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent-strong"><Icon name={icon} size={17} /></span>
                      <p className="mt-2 text-2xl font-extrabold leading-none tabular-nums">{count}</p>
                      <p className="mt-1 text-2xs font-bold text-ink-muted">{label}</p>
                    </button>
                  ))}
                </div>

                <div className="rounded-card border border-line bg-surface-raised p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-extrabold">Quick actions</h2>
                    <button onClick={() => void loadDashboard()} className="min-h-8 rounded-full px-2 text-2xs font-extrabold text-accent">Refresh</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => setTab('moderation')} className="min-h-11 rounded-xl bg-accent text-xs font-extrabold text-white">Review approvals</button>
                    <button onClick={() => setTab('accounts')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Manage members</button>
                    <button onClick={() => setTab('ministries')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Ministries</button>
                    <button onClick={() => onOpenMap?.()} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Live member map</button>
                    <button onClick={() => setTab('announce')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Send announcement</button>
                    <button onClick={() => setTab('content')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Church wording</button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <h2 className="mb-2 text-sm font-extrabold">Recent content</h2>
                    {dashboard.content.length ? dashboard.content.map((x: any) => (
                      <div key={x.id} className="border-b border-line py-2 last:border-0">
                        <p className="truncate text-xs font-bold">{x.caption || x.title || x.username || 'Content'}</p>
                        <p className="text-[10px] text-ink-muted">{x.type || 'post'} · {x.created_at ? timeAgo(x.created_at) : ''}</p>
                      </div>
                    )) : <p className="py-3 text-xs text-ink-muted">No recent content.</p>}
                  </div>
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-extrabold">Recent admin actions</h2>
                      <button onClick={() => setTab('audit')} className="text-2xs font-extrabold text-accent">View all</button>
                    </div>
                    {dashboard.audit.length ? dashboard.audit.map((x: any) => (
                      <div key={x.id} className="border-b border-line py-2 last:border-0">
                        <p className="text-xs font-bold capitalize">{String(x.action || '').replace(/_/g, ' ')}</p>
                        <p className="text-[10px] text-ink-muted">{x.actor_username || 'system'} → {x.target_type} · {new Date(x.created_at).toLocaleString()}</p>
                      </div>
                    )) : <p className="py-3 text-xs text-ink-muted">No admin actions recorded yet.</p>}
                  </div>
                </div>

                <div className="rounded-card border border-line bg-surface-raised p-4">
                  <h2 className="mb-2 text-sm font-extrabold">Recent chat activity</h2>
                  {dashboard.chats.length ? dashboard.chats.map((x: any) => (
                    <div key={x.conversation_key} className="border-b border-line py-2 last:border-0">
                      <p className="text-xs font-bold">{x.name}</p>
                      <p className="truncate text-[10px] text-ink-muted">{x.last_from ? '@' + x.last_from + ' · ' : ''}{x.last_text || 'No messages'} · {x.unread || 0} unread</p>
                    </div>
                  )) : <p className="py-3 text-xs text-ink-muted">No recent team chat activity.</p>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Members ── */}
        {tab === 'accounts' && (
          <div className="space-y-3" data-testid="admin-accounts">
            <div className="rounded-card border border-line bg-surface-raised p-3">
              <div className="flex gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
                  <Icon name="search" size={16} className="shrink-0 text-ink-subtle" />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Search name, username or ministry…"
                    aria-label="Search members"
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
                  />
                </div>
                <button onClick={() => setShowCreate(v => !v)} className="min-h-11 shrink-0 rounded-xl bg-accent px-3.5 text-xs font-extrabold text-white">
                  {showCreate ? 'Close' : '＋ New'}
                </button>
              </div>
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {([
                  ['all', `All ${accounts.length}`],
                  ['verified', `Verified ${accounts.filter(u => u.verified).length}`],
                  ['admin', 'Admins'],
                  ['inactive', 'Inactive'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setAccountFilter(value)}
                    className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${accountFilter === value ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {showCreate && (
              <div className="space-y-2 rounded-card border border-line bg-surface-raised p-4">
                <p className="text-sm font-extrabold">Create member account</p>
                <p className="text-2xs text-ink-muted">Share the PIN privately. New accounts start unverified until you verify them.</p>
                <div className="flex gap-2">
                  <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} placeholder="username" aria-label="New member username" className="input-base min-w-0 flex-1" />
                  <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Full name" aria-label="New member full name" className="input-base min-w-0 flex-1" />
                </div>
                <div className="flex gap-2">
                  <input value={newUser.pin} onChange={e => setNewUser(u => ({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="PIN (4–6 digits)" inputMode="numeric" aria-label="New member PIN" className="input-base min-w-0 flex-1" />
                  <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} aria-label="New member role" className="input-base w-28">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <select value={newUser.group_name} onChange={e => setNewUser(u => ({ ...u, group_name: e.target.value }))} aria-label="New member congregation" className="input-base">
                  {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <button onClick={() => void createUser()} disabled={busy === 'create'} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">
                  {busy === 'create' ? 'Creating…' : 'Create account'}
                </button>
              </div>
            )}

            {loadingAccounts ? (
              <p className="py-10 text-center text-sm text-ink-muted">Loading members…</p>
            ) : filteredAccounts.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong"><Icon name="users" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">No members match this view</p>
                <p className="mt-1 text-xs text-ink-muted">Clear the search or pick another filter.</p>
              </div>
            ) : pagedAccounts.map(u => (
              <div key={u.username} className={`rounded-card border bg-surface-raised ${u.active === false ? 'border-danger/30 opacity-80' : 'border-line'}`}>
                <button onClick={() => setExpanded(expanded === u.username ? null : u.username)} aria-expanded={expanded === u.username} className="flex w-full items-center gap-3 p-3 text-left">
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-sm font-extrabold text-white">
                    {String(u.name || u.username || '?')[0].toUpperCase()}
                    {u.online && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface-raised bg-success" aria-label="Active now" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-sm font-extrabold">
                      <span className="truncate">{u.name || u.username}</span>
                      {u.verified && <VerifiedBadge size={14} />}
                    </span>
                    <span className="block truncate text-2xs text-ink-muted">@{u.username} · {u.group_name || 'No group'}{u.department_name ? ` · ${u.department_name}` : ''}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={`badge ${u.verified ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'}`}>{u.verified ? 'Verified' : 'Unverified'}</span>
                      {u.role === 'admin' && <span className="badge bg-accent-soft text-accent-strong">Admin</span>}
                      {u.active === false && <span className="badge bg-danger-soft text-danger">Inactive</span>}
                      {u.online && <span className="badge bg-success-soft text-success">Active now</span>}
                    </span>
                  </span>
                  <Icon name="chevron-down" size={16} className={`shrink-0 text-ink-subtle transition ${expanded === u.username ? 'rotate-180' : ''}`} />
                </button>

                {expanded === u.username && (
                  <div className="border-t border-line p-3">
                    <div className="space-y-3">
                      <div>
                        <label htmlFor={`ministry-${u.username}`} className="label-caps mb-1 block">Ministry / department</label>
                        <select
                          id={`ministry-${u.username}`}
                          data-testid="member-ministry"
                          value={u.department_slug || ''}
                          disabled={busy === u.username}
                          onChange={e => void changeMinistry(u, e.target.value)}
                          className="input-base"
                        >
                          <option value="">No ministry</option>
                          {departments.map((d: any) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
                        </select>
                        <p className="mt-1 text-[10px] text-ink-muted">Changing this transfers the member straight away — you do not need them to leave first.</p>
                      </div>

                      <div className="flex gap-2">
                        <select value={u.group_name || GROUPS[0]} onChange={e => void patchUser(u.username, { group_name: e.target.value })} disabled={busy === u.username} aria-label={`${u.username} congregation`} className="input-base min-w-0 flex-1">
                          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select value={u.role || 'member'} onChange={e => void patchUser(u.username, { role: e.target.value })} disabled={busy === u.username || u.username === localStorage.getItem('harvest_username')} aria-label={`${u.username} role`} className="input-base w-32">
                          <option value="member">Member role</option>
                          <option value="admin">Admin role</option>
                        </select>
                      </div>

                      {u.role !== 'admin' && (
                        <div>
                          <p className="label-caps mb-1.5">Leader powers</p>
                          <div className="flex flex-wrap gap-1.5">
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
                                <button
                                  key={cap}
                                  disabled={busy === u.username}
                                  onClick={() => void patchUser(u.username, { grants: on ? (u.grants || '').split(',').filter((g: string) => g && g !== cap) : [...(u.grants || '').split(',').filter(Boolean), cap] })}
                                  className={`min-h-8 rounded-full px-2.5 text-[10px] font-extrabold ${on ? 'bg-accent text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                          <p className="mt-1.5 text-[10px] text-ink-muted">Sermon Manager gives full control of the Sermons tab; each other grant unlocks its own area.</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                        <button
                          data-testid="member-verify"
                          disabled={busy === u.username}
                          onClick={() => void patchUser(u.username, { verified: !u.verified })}
                          className={`min-h-10 rounded-xl text-xs font-extrabold disabled:opacity-50 ${u.verified ? 'border border-line bg-surface-sunken text-ink-muted' : 'bg-accent text-white'}`}
                        >
                          {busy === u.username ? 'Saving…' : u.verified ? 'Remove verification' : 'Verify member ✓'}
                        </button>
                        <button disabled={busy === u.username} onClick={() => { const p = window.prompt(`New PIN for ${u.username} (4–6 digits)`); if (p) void patchUser(u.username, { pin_reset: p }) }} className="min-h-10 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink-muted disabled:opacity-50">Reset PIN</button>
                        <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { active: u.active === false })} className="min-h-10 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink-muted disabled:opacity-50">{u.active === false ? 'Reactivate account' : 'Deactivate account'}</button>
                        <button disabled={busy === u.username} onClick={() => void removeUser(u.username)} className="min-h-10 rounded-xl border border-danger/30 bg-danger-soft text-xs font-extrabold text-danger disabled:opacity-50">Delete permanently</button>
                      </div>
                      <p className="text-[10px] text-ink-muted">Every change is written to the audit log. Verification unlocks posts, reels, music and sermon uploads.</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {!loadingAccounts && filteredAccounts.length > ACCOUNTS_PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between gap-3 px-1">
                <button onClick={() => setAccountsPage(p => Math.max(1, p - 1))} disabled={safeAccountsPage <= 1} className="min-h-9 rounded-full border border-line bg-surface-raised px-4 text-xs font-extrabold text-ink-muted disabled:opacity-40">← Prev</button>
                <p className="text-xs font-semibold text-ink-muted">Page {safeAccountsPage} of {accountsPages}</p>
                <button onClick={() => setAccountsPage(p => Math.min(accountsPages, p + 1))} disabled={safeAccountsPage >= accountsPages} className="min-h-9 rounded-full border border-line bg-surface-raised px-4 text-xs font-extrabold text-ink-muted disabled:opacity-40">Next →</button>
              </div>
            )}

            <div className="rounded-card border border-line bg-surface-raised p-4">
              <p className="text-sm font-extrabold">Restore a deactivated account</p>
              <p className="mt-1 text-xs text-ink-muted">Deactivated members cannot sign in until restored.</p>
              <div className="mt-2 flex gap-2">
                <input value={restoreName} onChange={e => setRestoreName(e.target.value)} placeholder="username" aria-label="Username to restore" className="input-base min-w-0 flex-1" />
                <button onClick={() => void restoreUser()} disabled={busy === 'restore'} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-50">{busy === 'restore' ? '…' : 'Restore'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Ministries ── */}
        {tab === 'ministries' && (
          <div className="space-y-3" data-testid="admin-ministries">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Ministry teams</h2>
              <p className="mt-1 text-xs text-ink-muted">Rename a ministry (for example to HYP), create a new one, or delete one. Members keep their place when a ministry is renamed.</p>
              <div className="mt-3 flex gap-2">
                <input value={newMinistry} onChange={e => setNewMinistry(e.target.value)} placeholder="New ministry name" aria-label="New ministry name" className="input-base min-w-0 flex-1" />
                <button onClick={() => void createMinistry()} disabled={busy === 'ministry-create' || !newMinistry.trim()} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-50">
                  {busy === 'ministry-create' ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>

            {loadingAccounts && !departments.length ? (
              <p className="py-10 text-center text-sm text-ink-muted">Loading ministries…</p>
            ) : !departments.length ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong"><Icon name="building" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">No ministries yet</p>
                <p className="mt-1 text-xs text-ink-muted">Create the first team above, then assign members from the Members tab.</p>
              </div>
            ) : departments.map((d: any) => (
              <div key={d.slug} className="rounded-card border border-line bg-surface-raised p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`ministry-rename-${d.slug}`} className="label-caps mb-1 block">Ministry name</label>
                    <input
                      id={`ministry-rename-${d.slug}`}
                      value={ministryNames[d.slug] ?? d.name ?? ''}
                      onChange={e => setMinistryNames(prev => ({ ...prev, [d.slug]: e.target.value }))}
                      className="input-base"
                    />
                    <p className="mt-1 text-[10px] text-ink-muted">{d.member_count} serving · {d.slug}</p>
                  </div>
                  <button
                    onClick={() => void renameMinistry(d)}
                    disabled={busy === `ministry-${d.slug}` || !String(ministryNames[d.slug] ?? d.name ?? '').trim() || (ministryNames[d.slug] ?? d.name) === d.name}
                    className="min-h-11 shrink-0 rounded-xl bg-ink px-3 text-xs font-extrabold text-white disabled:opacity-40"
                  >
                    {busy === `ministry-${d.slug}` ? 'Saving…' : 'Save name'}
                  </button>
                </div>
                <div className="mt-2 flex justify-end">
                  <button onClick={() => void deleteMinistry(d)} disabled={busy === `ministry-del-${d.slug}`} className="min-h-9 rounded-full border border-danger/30 bg-danger-soft px-3 text-[10px] font-extrabold text-danger disabled:opacity-50">
                    {busy === `ministry-del-${d.slug}` ? 'Deleting…' : 'Delete ministry'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Approvals ── */}
        {tab === 'moderation' && (
          <div className="space-y-3" data-testid="admin-moderation">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(['pending', 'transcoding', 'rejected'] as const).map(value => (
                <button key={value} onClick={() => setStatus(value)} className={`min-h-9 shrink-0 rounded-full px-3.5 text-2xs font-extrabold capitalize ${status === value ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted'}`}>{value}</button>
              ))}
              <button onClick={() => void cleanup()} disabled={cleanupBusy} className="ml-auto min-h-9 shrink-0 rounded-full border border-line bg-surface-sunken px-3 text-2xs font-extrabold text-ink-muted disabled:opacity-50">
                {cleanupBusy ? 'Cleaning…' : 'Clean uploads'}
              </button>
            </div>
            {pending.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-12 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success-soft text-success"><Icon name="check" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">Nothing {status}</p>
                <p className="mt-1 text-xs text-ink-muted">All caught up — new uploads appear here for review.</p>
              </div>
            ) : pending.map(item => (
              <div key={item.id} className="rounded-card border border-line bg-surface-raised p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="badge bg-accent-soft capitalize text-accent-strong">{item.type}</span>
                  <span className="text-[10px] text-ink-muted">{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm font-extrabold">{item.name || item.username || 'Harvest member'}</p>
                <p className="mt-1 text-sm text-ink-muted">{item.caption || 'No caption'}</p>
                {item.thumb_url && <img src={item.thumb_url} alt="Pending media" className="mt-3 max-h-72 w-full rounded-2xl bg-surface-sunken object-cover" />}
                {status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'approve')} className="min-h-11 flex-1 rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">{busy === String(item.id) ? 'Working…' : 'Approve & publish'}</button>
                    <button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'reject')} className="min-h-11 flex-1 rounded-xl border border-danger/30 bg-danger-soft text-sm font-extrabold text-danger disabled:opacity-50">Reject</button>
                  </div>
                )}
                {status === 'rejected' && item.reject_reason && <p className="mt-3 text-xs text-danger">Reason: {item.reject_reason}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── Announce ── */}
        {tab === 'announce' && (
          <div className="space-y-3" data-testid="admin-announce">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Announce to members</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Lands as a direct message in every member’s chat with an unread badge. Members can reply straight back to you.</p>
              </div>
              <div>
                <label htmlFor="ann-group" className="label-caps mb-1 block">Audience</label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button onClick={() => setAnnGroup('')} className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${annGroup === '' ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}>All members</button>
                  {GROUPS.map(g => (
                    <button key={g} onClick={() => setAnnGroup(g)} className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${annGroup === g ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="ann-body" className="label-caps mb-1 block">Announcement</label>
                <textarea
                  id="ann-body"
                  value={annText}
                  onChange={e => setAnnText(e.target.value.slice(0, 2000))}
                  rows={5}
                  placeholder="e.g. Sunday service starts 9:00 AM at Harvest Central. Come with a friend! 🙏"
                  className="input-base resize-y"
                />
                <p className="mt-1 text-right text-[10px] text-ink-muted">{annText.length}/2000</p>
              </div>
              {annText.trim().length >= 2 && (
                <div className="rounded-xl border border-line bg-surface-sunken p-3">
                  <p className="label-caps">Preview</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">📣 {annText.trim()}</p>
                </div>
              )}
              <button
                onClick={sendAnnounce}
                disabled={annBusy || annText.trim().length < 2}
                className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50"
              >
                {annBusy ? 'Sending…' : annGroup ? `Send to ${annGroup}` : 'Send to all members'}
              </button>
              {annCount !== null && <p className="text-center text-xs font-bold text-success">✓ Last announcement delivered to {annCount} members</p>}
              {annText.trim().length >= 2 && (
                <button onClick={() => shareAnnouncementToWhatsApp(annText.trim())} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-extrabold text-white">
                  Share this on WhatsApp
                </button>
              )}
              <p className="text-[10px] text-ink-muted">Every send is recorded in the Audit tab. This reaches the whole church — use responsibly.</p>
            </div>
          </div>
        )}

        {/* ── Chats ── */}
        {tab === 'chat' && (
          <div className="space-y-3" data-testid="admin-chat">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Chat moderation</h2>
              <p className="mt-1 text-xs text-ink-muted">Review and remove messages from church group and department conversations.</p>
              {loadingChats ? <p className="py-4 text-xs">Loading conversations…</p> : (
                <select value={selectedChat} onChange={e => setSelectedChat(e.target.value)} aria-label="Conversation to moderate" className="input-base mt-3">
                  <option value="">Choose a conversation</option>
                  {chatConversations.map((x: any) => <option key={x.key} value={x.key}>{x.name || x.key}</option>)}
                </select>
              )}
            </div>
            {selectedChat && (loadingChatMessages ? <p className="py-8 text-center text-xs">Loading messages…</p> : chatMessages.length === 0 ? <p className="py-8 text-center text-xs text-ink-muted">No messages in this conversation.</p> : (
              <div className="space-y-2">
                {chatMessages.map((m: any) => (
                  <div key={m.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-raised p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-ink-muted">@{m.from} · {m.at || ''}</p>
                      <p className={m.deleted_at ? 'text-xs italic text-ink-subtle' : 'text-sm'}>{m.text}</p>
                    </div>
                    {!m.deleted_at && <button disabled={busy === String(m.id)} onClick={() => void moderateChatMessage(m)} className="min-h-9 shrink-0 rounded-xl border border-danger/30 bg-danger-soft px-3 text-xs font-extrabold text-danger">Remove</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Audit ── */}
        {tab === 'audit' && (
          <div className="space-y-2" data-testid="admin-audit">
            {loadingAudit ? <p className="py-10 text-center text-sm text-ink-muted">Loading audit log…</p> : audit.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">No admin activity recorded yet.</p> : (
              <ol className="relative ml-3 border-l border-line pl-4">
                {audit.map(entry => (
                  <li key={entry.id} className="relative pb-4">
                    <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
                    <div className="rounded-xl border border-line bg-surface-raised px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-extrabold capitalize">{String(entry.action || '').replace(/_/g, ' ')}</p>
                        <span className="shrink-0 text-[10px] text-ink-muted">{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{entry.actor_username || 'system'} → {entry.target_type} {String(entry.target_id || '').slice(0, 8)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* ── Everything: every editable display string, one editor ── */}
        {tab === 'content' && (
          <div className="space-y-3" data-testid="admin-content">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Every word the church reads</h2>
              <p className="mt-1 text-2xs text-ink-muted">
                Home banner, giving copy, page titles, contact details, community rules — plus any new
                <b> copy_</b> or <b> app_</b> key you add below. One save publishes all of it.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5">
                <Icon name="search" size={16} className="text-ink-subtle" />
                <input value={contentQuery} onChange={e => setContentQuery(e.target.value)} placeholder="Find a setting…" aria-label="Find a content setting" className="min-h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle" />
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
                  className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-2xs font-extrabold text-white"
                >Add</button>
              </div>
              <p className="mt-1.5 text-[10px] text-ink-muted">Use this for new surfaces so no wording ever waits on a code change.</p>
            </div>

            <button onClick={() => void saveContent()} disabled={contentBusy} data-testid="admin-content-save" className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">
              {contentBusy ? 'Saving…' : 'Save every change — live for everyone'}
            </button>
          </div>
        )}

        {/* ── Home text ── */}
        {tab === 'home' && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Home screen text</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Edits what every member sees at the top of the Community screen — the banner and the weekly encouragement. Changes go live immediately.</p>
              </div>
              {CONTENT_FIELDS.map(f => (
                <div key={f.key}>
                  <label htmlFor={`ct-${f.key}`} className="label-caps mb-1 block">{f.label}</label>
                  {f.key === 'pastor_usernames' ? (
                    <div>
                      <textarea id={`ct-${f.key}`} value={contentValue(f.key) || content.pastor_username || ''}
                        onChange={e => setContentValue('pastor_usernames', e.target.value.slice(0, f.max))}
                        rows={3} placeholder={f.hint}
                        className="input-base resize-y" />
                      <p className="mt-1 text-[10px] text-ink-muted">Use real usernames, not display names. Multiple pastors are supported.</p>
                    </div>
                  ) : f.textarea ? (
                    <textarea id={`ct-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} rows={2} placeholder={f.hint} className="input-base resize-y" />
                  ) : (
                    <input id={`ct-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} placeholder={f.hint} className="input-base" />
                  )}
                  <p className="mt-0.5 text-right text-[10px] text-ink-muted">{contentValue(f.key).length}/{f.max}</p>
                </div>
              ))}
              <button onClick={() => void saveContent()} disabled={contentBusy} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
                {contentBusy ? 'Saving…' : 'Save home text — live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Clear a field to fall back to the shipped wording. Saved changes reach every open screen immediately.</p>
            </div>
          </div>
        )}

        {/* ── Giving copy ── */}
        {tab === 'give' && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Give screen</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Edit the giving headline, Paybill fallback details, giving funds and quick amounts. Saves go live for every member immediately.</p>
              </div>
              {GIVE_FIELDS.map(f => (
                <div key={f.key}>
                  <label htmlFor={`gv-${f.key}`} className="label-caps mb-1 block">{f.label}</label>
                  {f.textarea ? (
                    <textarea id={`gv-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} rows={2} placeholder={f.hint} className="input-base resize-y" />
                  ) : (
                    <input id={`gv-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} placeholder={f.hint} className="input-base" />
                  )}
                </div>
              ))}
              <GivingFundsEditor
                funds={adminFunds}
                quick={adminQuick}
                onChange={(nextFunds, nextQuick) => {
                  setContentValue('giving_funds', JSON.stringify(nextFunds))
                  setContentValue('giving_quick', JSON.stringify(nextQuick))
                }}
              />
              <button onClick={() => void saveContent()} disabled={contentBusy || !contentDraft} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
                {contentBusy ? 'Saving…' : 'Save giving changes — live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">These settings change what members see. The M-Pesa STK push itself is controlled by the server’s Daraja keys, not here.</p>
            </div>
          </div>
        )}

        {/* ── Adverts ── */}
        {tab === 'adverts' && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Sponsored adverts</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Third-party adverts shown inside the Community feed. Each member sees an advert at most “daily cap” times a day — counted on the server, so refreshing cannot show it more.</p>
              </div>
              <div>
                <label htmlFor="ad-settings" className="label-caps mb-1 block">Placement and limits</label>
                <textarea id="ad-settings" value={settingsDraft ?? settingsJson} onChange={e => setSettingsDraft(e.target.value)} rows={4} placeholder={ADVERT_SETTINGS_EXAMPLE} className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs outline-none focus:border-accent" />
                <p className="mt-0.5 text-[10px] text-ink-muted">placement: <b>feed</b> or <b>none</b> · interval: 3–20 posts between adverts · daily_cap: 1–10 appearances per member per day.</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-3" data-testid="advert-photo-composer">
                <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">New advert with a photo</p>
                <p className="mt-1 text-[10px] text-ink-muted">Upload a picture straight from your phone — no hosting or link needed. It is added to the list below for you to review.</p>
                <label htmlFor="ad-photo" className="mt-2 flex min-h-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-sunken">
                  {adPhoto
                    ? <img src={URL.createObjectURL(adPhoto)} alt="Selected advert" className="h-24 w-full object-cover" />
                    : <span className="flex items-center gap-2 text-2xs font-bold text-ink-muted"><Icon name="camera" size={18} /> Choose a photo</span>}
                  <input id="ad-photo" type="file" accept="image/*" className="hidden" onChange={e => { setAdPhoto(e.target.files?.[0] || null); e.target.value = '' }} />
                </label>
                <input value={adTitle} onChange={e => setAdTitle(e.target.value.slice(0, 80))} placeholder="Headline (e.g. Harvest Bookshop)" className="input-base mt-2" aria-label="Advert headline" />
                <textarea value={adBody} onChange={e => setAdBody(e.target.value.slice(0, 400))} rows={2} placeholder="One or two lines about the offer" className="input-base mt-2 resize-y" aria-label="Advert body" />
                <input value={adCta} onChange={e => setAdCta(e.target.value)} placeholder="Link (optional — defaults to the church site)" className="input-base mt-2" aria-label="Advert link" />
                <button type="button" onClick={() => void addAdvertWithPhoto()} disabled={adBusy || !adPhoto || !adTitle.trim()} className="mt-2 min-h-11 w-full rounded-xl bg-ink text-2xs font-extrabold text-white disabled:opacity-40">
                  {adBusy ? 'Uploading photo…' : 'Add this advert'}
                </button>
              </div>
              <div>
                <label htmlFor="ad-list" className="label-caps mb-1 block">Adverts (JSON array)</label>
                <textarea id="ad-list" value={advertsDraft ?? advertsJson} onChange={e => setAdvertsDraft(e.target.value)} rows={10} placeholder={ADVERT_EXAMPLE} className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs outline-none focus:border-accent" />
                <p className="mt-0.5 text-[10px] text-ink-muted">Max 20 adverts. Required: <b>id</b> (a–z, 0–9, - or _), <b>title</b> (80 chars) and <b>cta_url</b> (http/https). Optional: <b>body</b> (400), <b>image_key</b>, <b>image_url</b>, <b>enabled</b>, <b>audience</b>, <b>advertise_from</b> / <b>advertise_until</b>.</p>
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
                className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50"
              >
                {contentBusy ? 'Saving…' : '✓ Save — goes live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Leave the list as <b>[]</b> to switch sponsored adverts off. Adverts are always labelled Sponsored and never styled as church posts.</p>
            </div>
          </div>
        )}

        {/* ── Studio ── */}
        {tab === 'media' && <AdminMedia onBack={() => setTab('moderation')} />}
      </main>

      {/* Unsaved work stays visible wherever the admin has scrolled to. */}
      {contentDraft && Object.keys(contentDraft).length > 0 && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ink bg-ink px-3 py-1.5 text-white shadow-card">
            <span className="text-2xs font-extrabold">{Object.keys(contentDraft).length} unsaved change{Object.keys(contentDraft).length === 1 ? '' : 's'}</span>
            <button type="button" onClick={() => void saveContent()} disabled={contentBusy} className="min-h-9 rounded-full bg-gold px-3.5 text-2xs font-extrabold text-ink disabled:opacity-40">
              {contentBusy ? 'Saving…' : 'Save now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
