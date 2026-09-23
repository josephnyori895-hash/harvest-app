import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent } from 'react'
import { useAuth } from '../state/auth'
import { showMessageNotification, ensureNotificationChannel } from '../lib/notifications'

type Section = 'personal' | 'groups' | 'ministry' | 'prayer'
type ChatUser = any
type Presence = { online: boolean; lastSeen: string }

const API = import.meta.env.VITE_API_URL || ''
const REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '🔥'] as const

const sectionMeta: Record<Section, { label: string; icon: string; description: string }> = {
  personal: { label: 'Personal', icon: '💬', description: 'Private conversations with your church family' },
  groups: { label: 'Groups', icon: '👥', description: 'Chat with people in your Harvest group' },
  ministry: { label: 'Ministry', icon: '⛪', description: 'Worship and ministry connections' },
  prayer: { label: 'Prayer', icon: '🙏', description: 'Pray with and encourage one another' },
}

const keyFor = (a: string, b: string) => `harvest:chat:${[a, b].sort().join(':')}`

// Stable positive int from a string — notification IDs must be ints.
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0 }
  return h
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('harvest_token') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  Object.entries(authHeaders()).forEach(([key, value]) => headers.set(key, value))
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...options, headers })
  const raw = await response.text()
  let data: any = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
  if (!response.ok) throw new Error(data.error || data.message || raw || `Request failed (${response.status})`)
  return data as T
}

function mergeMessages(current: any[], incoming: any[]) {
  const byId = new Map(current.map(m => [String(m.id), m]))
  incoming.forEach(m => byId.set(String(m.id), m))
  return [...byId.values()].sort((a, b) => new Date(a.created_at || a.at).getTime() - new Date(b.created_at || b.at).getTime())
}

// Chat photos are served as HMAC-signed URLs minted by the server for participants.
const signedUrlCache: Record<string, string> = {}
async function fetchSignedMediaUrl(messageId: string): Promise<string | null> {
  if (signedUrlCache[messageId]) return signedUrlCache[messageId]
  try {
    const r = await api<{ url: string }>(`/api/chat/media/${encodeURIComponent(messageId)}`)
    signedUrlCache[messageId] = r.url
    return r.url
  } catch { return null }
}

function ChatPhoto({ messageId }: { messageId: string }) {
  const [src, setSrc] = useState<string | null>(signedUrlCache[messageId] || null)
  useEffect(() => { let live = true; if (!src) void fetchSignedMediaUrl(messageId).then(u => { if (live && u) setSrc(u) }); return () => { live = false } }, [messageId, src])
  if (!src) return <div className="w-56 h-40 rounded-xl bg-stone-800 animate-pulse" />
  return <img src={src} alt="photo" className="rounded-xl max-h-72 w-auto mb-1.5" loading="lazy" />
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date(); const yest = new Date(Date.now() - 86400000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

function Ticks({ status, mine }: { status: string; mine: boolean }) {
  if (!mine) return null
  const seen = status === 'seen'
  return <span className={seen ? 'text-sky-300' : 'text-white/70'}>{seen || status === 'delivered' ? '✓✓' : '✓'}</span>
}

// Instagram-style compact list timestamps: h:mm / weekday / date.
function chatListTime(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export type TeamChat = { kind: 'department' | 'group'; slug: string; name: string; unread?: number }

export default function Chat({ onBack, users, teamChat, dmTarget, onDmOpened, onCloseTeam, onOpenGroups, onOpenDepartments }: {
  onBack: () => void
  users: ChatUser[]
  teamChat?: TeamChat | null
  dmTarget?: { username: string; name?: string } | null
  onDmOpened?: () => void
  onCloseTeam?: () => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
}) {
  const { username: authUsername } = useAuth()
  const [tab, setTab] = useState<'inbox' | 'people'>('inbox')
  const [chatView, setChatView] = useState<'chats' | 'community'>('chats')
  const [section, setSection] = useState<Section>('personal')
  const [active, setActive] = useState<ChatUser | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inbox, setInbox] = useState<any[]>([])
  const totalUnread = useMemo(() => inbox.reduce((sum, c) => sum + (Number(c.unread) || 0), 0), [inbox])
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} }
  })
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [replyTo, setReplyTo] = useState<any | null>(null)
  // Team chat: departments AND small groups — both are server-enforced memberships.
  const [team, setTeam] = useState<TeamChat | null>(null)
  useEffect(() => {
    if (teamChat) { setActive(null); setTeam(teamChat) } else setTeam(null)
  }, [teamChat])
  // 'Pray with Pastor' deep link: jump straight into the 1:1 DM.
  useEffect(() => {
    if (!dmTarget?.username) return
    const u = String(dmTarget.username)
    const dir = (users as any[]).find(x => x.username === u)
    setActive({ username: u, name: dmTarget.name || dir?.name || u, verified: dir?.verified, avatar_url: dir?.avatar_url })
    setTeam(null)
    onDmOpened?.()
  }, [dmTarget, users, onDmOpened])

  // Android hardware back closes a team conversation before leaving Chat.
  useEffect(() => {
    const onNestedBack = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail
      if (!team || !detail) return
      detail.handled = true
      onCloseTeam?.()
    }
    window.addEventListener('harvest:nested-back', onNestedBack)
    return () => window.removeEventListener('harvest:nested-back', onNestedBack)
  }, [team, onCloseTeam])
  const [reactingFor, setReactingFor] = useState<string | null>(null)
  const [actionFor, setActionFor] = useState<string | null>(null)
  const swipeStartX = useRef<number | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [attach, setAttach] = useState<File | null>(null)
  // Instagram-style people search on the chats list.
  const [peopleQuery, setPeopleQuery] = useState('')
  const [pinnedChats, setPinnedChats] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_pinned_chats') || '[]') } catch { return [] }
  })
  const togglePinned = (key: string) => {
    setPinnedChats(current => {
      const next = current.includes(key) ? current.filter(k => k !== key) : [key, ...current]
      localStorage.setItem('harvest_pinned_chats', JSON.stringify(next))
      return next
    })
  }
  const cursorRef = useRef<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pressTimer = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)
  const currentUser = authUsername || localStorage.getItem('harvest_username') || ''
  const currentProfile = users.find((u: any) => u.username === currentUser)
  const canModerateChat = currentProfile?.role === 'admin' || String(currentProfile?.grants || '').split(',').map((x: string) => x.trim()).includes('moderate_chat')
  // Last-seen unread counts (peer → count) + currently open conversation,
  // so the background poller can detect FRESH incoming messages.
  const inboxRef = useRef<Record<string, number> | null>(null)
  const activeRef = useRef<ChatUser | null>(null)
  useEffect(() => { activeRef.current = active }, [active])

  const conversationKey = team
    ? (team.kind === 'group' ? `group:${team.slug}` : `department:${team.slug}`)
    : active ? keyFor(currentUser, active.username) : ''
  const thread = conversationKey ? (msgs[conversationKey] || []) : []

  const saveMessages = useCallback((updater: Record<string, any[]> | ((c: Record<string, any[]>) => Record<string, any[]>)) => {
    setMsgs(current => {
      const next = typeof updater === 'function' ? updater(current) : updater
      localStorage.setItem('harvest_msgs', JSON.stringify(next))
      return next
    })
  }, [])

  const refreshInbox = useCallback(async () => {
    if (!localStorage.getItem('harvest_token')) return
    try {
      const r = await api<{ conversations: any[] }>('/api/chat/conversations')
      const next = r.conversations || []
      // Background alerts: notify about unread messages that arrived since the last
      // poll while the user is NOT inside this conversation. Skips the very first
      // load (no baseline yet) so reopening the app doesn't replay old messages.
      if (inboxRef.current) {
        const prevUnread = inboxRef.current
        for (const c of next) {
          const before = prevUnread[c.peer] ?? 0
          if (c.unread > before && c.last_from !== currentUser && activeRef.current?.username !== c.peer) {
            void showMessageNotification(c.peer_name || c.peer, c.last_text || 'New message', Math.abs(hashCode(c.conversation_key)) % 2000000000)
          }
        }
      }
      inboxRef.current = Object.fromEntries(next.map(c => [c.peer, c.unread || 0]))
      setInbox(next)
    } catch { /* keep last inbox */ }
  }, [currentUser])

  const syncPresence = useCallback(async () => {
    if (!localStorage.getItem('harvest_token')) return
    try {
      await api('/api/presence/heartbeat', { method: 'POST', body: '{}' })
      const result = await api<{ users: Array<{ username: string; online: boolean; last_seen?: string }> }>('/api/presence')
      const next: Record<string, Presence> = {}
      result.users.forEach(u => { next[u.username] = { online: Boolean(u.online), lastSeen: u.last_seen || '' } })
      setPresence(next)
    } catch { /* keep last known presence */ }
  }, [])

  useEffect(() => {
    void ensureNotificationChannel()
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshInbox()
        void syncPresence()
      }
    }
    refreshVisible()
    const t = window.setInterval(refreshVisible, 30000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [refreshInbox, syncPresence])

  const markSeen = useCallback(async () => {
    if (team) { try { await api('/api/chat/seen', { method: 'POST', body: JSON.stringify(team.kind === 'group' ? { group: team.slug } : { department: team.slug }) }) } catch { /* non-fatal */ } return }
    if (!active) return
    try { await api('/api/chat/seen', { method: 'POST', body: JSON.stringify({ peer: active.username }) }) } catch { /* non-fatal */ }
  }, [active, team])

  const loadConversation = useCallback(async () => {
    if (team) {
      setError('')
      try {
        const q = team.kind === 'group' ? `group=${encodeURIComponent(team.slug)}` : `department=${encodeURIComponent(team.slug)}`
        const result = await api<{ messages: any[]; conversation_key: string }>(`/api/chat/history?${q}`)
        const k = result.conversation_key || (team.kind === 'group' ? `group:${team.slug}` : `department:${team.slug}`)
        saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages || []) }))
        const existing = mergeMessages(msgs[k] || [], result.messages || [])
        cursorRef.current[k] = existing[existing.length - 1]?.created_at || new Date(Date.now() - 5000).toISOString()
        void markSeen()
        void refreshInbox()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load team chat')
      }
      return
    }
    if (!active || !currentUser) return
    setError('')
    try {
      const result = await api<{ messages: any[]; conversation_key: string }>(`/api/chat/history?peer=${encodeURIComponent(active.username)}`)
      const k = result.conversation_key || conversationKey
      saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages || []) }))
      const existing = mergeMessages(msgs[k] || [], result.messages || [])
      cursorRef.current[k] = existing[existing.length - 1]?.created_at || new Date(Date.now() - 5000).toISOString()
      void markSeen()
      void refreshInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversation')
    }
  }, [active, team, currentUser, conversationKey, msgs, saveMessages, markSeen, refreshInbox])

  const refreshUpdates = useCallback(async () => {
    if (!active && !team) return
    if (!conversationKey || !localStorage.getItem('harvest_token')) return
    const after = cursorRef.current[conversationKey] || new Date(Date.now() - 5000).toISOString()
    try {
      const base = team ? (team.kind === 'group' ? { group: team.slug } : { department: team.slug }) : { peer: String(active?.username || '') }
      const q = new URLSearchParams({ ...base, after, limit: '50' })
      const result = await api<{ messages: any[]; conversation_key: string; server_time: string }>(`/api/chat/updates?${q.toString()}`)
      const k = result.conversation_key || conversationKey
      if ((result.messages || []).length) {
        saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages) }))
        void markSeen()
      }
      cursorRef.current[k] = result.server_time || cursorRef.current[k]
    } catch { /* polling failures stay silent */ }
  }, [active, team, conversationKey, saveMessages, markSeen])

  useEffect(() => {
    if (!active && !team) return
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refreshUpdates()
    }
    if (document.visibilityState === 'visible') void loadConversation()
    const t = window.setInterval(refreshVisible, 2500)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [active?.username, team?.kind, team?.slug, loadConversation, refreshUpdates])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length, active?.username])

  const send = async () => {
    const body = text.trim()
    if ((!active && !team) || !currentUser || sending || (!body && !attach)) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }
    if (!localStorage.getItem('harvest_token')) { setError('Your session has expired. Please sign in again.'); return }

    const tempId = `tmp_${Date.now()}`
    const optimistic: any = {
      id: tempId, from: currentUser, to: team ? null : active.username,
      text: attach && !body ? '📷' : body, status: 'sent',
      created_at: new Date().toISOString(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reply_to_id: replyTo?.id || null,
      reply_preview: replyTo ? `${replyTo.from === currentUser ? 'You' : replyTo.from}: ${replyTo.media_type && !replyTo.text ? '📷 Photo' : String(replyTo.text || '').slice(0, 80)}` : null,
      media_type: attach ? 'image' : null,
    }
    saveMessages(c => ({ ...c, [conversationKey]: [...(c[conversationKey] || []), optimistic] }))
    const sentReply = replyTo; setText(''); setReplyTo(null); setAttach(null); setSending(true); setError('')

    try {
      let media_key: string | undefined
      if (attach) {
        const pre = await api<any>('/api/media/presign', { method: 'POST', body: JSON.stringify({ type: 'story', contentType: attach.type || 'image/jpeg', bytes: attach.size }) })
        const target = /^https?:\/\//.test(pre.url) ? pre.url : `${API}${pre.url}`
        const isDirectR2 = /^https?:\/\//.test(pre.url)
        let up
        if (isDirectR2 && pre.method === 'PUT') {
          // Direct R2 uploads are presigned PUTs; send the signed headers exactly
          // as returned by the Worker and never attach the Harvest bearer token.
          up = await fetch(target, {
            method: 'PUT',
            body: attach,
            headers: { ...(pre.fields || {}) },
          })
        } else {
          const fd = new FormData()
          Object.entries(pre.fields || {}).forEach(([k, v]) => fd.append(k, String(v)))
          fd.append('file', attach)
          const token = localStorage.getItem('harvest_token') || ''
          up = await fetch(target, {
            method: 'POST',
            body: fd,
            headers: { Authorization: `Bearer ${token}` },
          })
        }
        if (!up.ok) throw new Error('Media storage is not enabled yet — text messages still work')
        media_key = pre.key
      }
      const teamPayload = team ? (team.kind === 'group' ? { group: team.slug } : { department: team.slug }) : { peer: active.username }
      const result = await api<{ message: any }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          ...teamPayload,
          body, media_key, media_type: media_key ? 'image' : undefined,
          reply_to_id: sentReply && !String(sentReply.id).startsWith('tmp_') ? sentReply.id : undefined,
        }),
      })
      saveMessages(c => ({ ...c, [conversationKey]: mergeMessages((c[conversationKey] || []).filter(m => String(m.id) !== tempId), [result.message]) }))
      cursorRef.current[conversationKey] = result.message.created_at || cursorRef.current[conversationKey]
      void refreshInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message could not be sent')
      saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).filter(m => String(m.id) !== tempId) }))
      setText(body)
    } finally { setSending(false) }
  }

  const react = async (msg: any, emoji: string) => {
    setReactingFor(null)
    const id = String(msg.id); if (id.startsWith('tmp_')) return
    saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).map(m => String(m.id) === id ? { ...m, reaction: emoji } : m) }))
    try {
      await api(`/api/chat/messages/${id}/react`, { method: 'POST', body: JSON.stringify({ reaction: emoji }) })
    } catch { setNotice('Could not save reaction'); window.setTimeout(() => setNotice(''), 2000) }
  }

  const startPress = (m: any) => {
    pressTimer.current = window.setTimeout(() => setReactingFor(String(m.id)), 450)
  }
  const cancelPress = () => { if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null } }
  const startSwipe = (e: TouchEvent, m: any) => {
    swipeStartX.current = e.touches[0]?.clientX ?? null
    swipeStartY.current = e.touches[0]?.clientY ?? null
    setSwipeOffset(0)
    startPress(m)
  }
  const moveSwipe = (e: TouchEvent, mine: boolean) => {
    const sx = swipeStartX.current
    const sy = swipeStartY.current
    if (sx == null || sy == null || mine) return
    const dx = e.touches[0]?.clientX - sx
    const dy = e.touches[0]?.clientY - sy
    if (dx > 6 && dx > Math.abs(dy) * 1.15) {
      e.preventDefault()
      setSwipeOffset(Math.min(76, dx))
    }
  }
  const endSwipe = (e: TouchEvent, m: any) => {
    cancelPress()
    const sx = swipeStartX.current
    const sy = swipeStartY.current
    swipeStartX.current = null
    swipeStartY.current = null
    const dx = sx == null ? 0 : e.changedTouches[0]?.clientX - sx
    const dy = sy == null ? 0 : e.changedTouches[0]?.clientY - sy
    setSwipeOffset(0)
    if (dx > 70 && dx > Math.abs(dy) * 1.15) {
      setReplyTo(m)
      setReactingFor(null)
      setActionFor(null)
    }
  }
  const shareMedia = async (m: any) => {
    if (!m?.media_key || !m?.id) return
    try {
      setNotice('Preparing photo…')
      const url = await fetchSignedMediaUrl(String(m.id))
      if (!url) throw new Error('Could not load the photo')
      const response = await fetch(url)
      if (!response.ok) throw new Error('Could not download the photo')
      const blob = await response.blob()
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'
      const file = new File([blob], `harvest-photo-${String(m.id).slice(0, 8)}.${ext}`, { type: blob.type || 'image/jpeg' })
      const text = m.text && m.text !== '📷' ? String(m.text) : 'Shared from Harvest'
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], text })
      } else if (navigator.share) {
        await navigator.share({ text: `${text}\n${url}` })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener,noreferrer')
      }
      setNotice('Share sheet opened')
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Unable to share photo')
    } finally {
      window.setTimeout(() => setNotice(''), 1800)
    }
  }

  const moderateDelete = async (m: any) => {
    const id = String(m?.id || '')
    if (!id || id.startsWith('tmp_')) return
    try {
      await api('/api/chat/messages/' + encodeURIComponent(id), { method: 'DELETE' })
      saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).map(x => String(x.id) === id ? { ...x, deleted_at: new Date().toISOString(), text: 'This message was deleted', media_key: null, media_type: null, reaction: null } : x) }))
      setNotice('Message removed for everyone')
      window.setTimeout(() => setNotice(''), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove message')
    }
  }

  const copyMessage = async (m: any) => {
    const value = String(m.text || '')
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Message copied')
    } catch {
      setNotice('Copy is not available on this device')
    }
    window.setTimeout(() => setNotice(''), 1800)
    setActionFor(null)
  }

  const usersForSection = useMemo(() => {
    const list = users.filter((u: any) => u.username && u.username !== currentUser)
    const needle = peopleQuery.trim().toLowerCase()
    const searched = needle
      ? list.filter((u: any) => `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(needle))
      : list
    if (section === 'groups') {
      const mine = users.find((u: any) => u.username === currentUser)
      const base = mine?.group ? searched.filter((u: any) => u.group === mine.group) : searched
      return needle ? base : base.slice(0, 12)
    }
    if (section === 'ministry') {
      const base = searched.filter((u: any) => u.ministry || u.verified || /worship|pastor|ministry/i.test(`${u.name || ''} ${u.username || ''}`))
      return needle ? base : base.slice(0, 12)
    }
    if (section === 'prayer') {
      const base = searched.filter((u: any) => u.verified)
      return needle ? base : base.slice(0, 12)
    }
    return searched
  }, [users, currentUser, section, peopleQuery])

  if (active || team) {
    let lastDay = ''
    let unreadDividerShown = false
    const firstUnreadIndex = thread.findIndex((m: any) => m.from !== currentUser && m.status === 'sent')
    const isTeam = Boolean(team)
    return (
      <main className="h-[100dvh] bg-[#1C1917] text-white flex flex-col">
        <header className="h-[72px] shrink-0 border-b border-stone-800/80 bg-[#1C1917]/95 backdrop-blur-xl flex items-center gap-3 px-3 z-20 shadow-lg shadow-stone-950/20">
          <button type="button" onClick={() => { if (isTeam) { setTeam(null); onCloseTeam?.() } else { setActive(null) } setReplyTo(null); setReactingFor(null) }} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 transition text-xl text-white shrink-0" aria-label="Back">‹</button>
          <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7C3AED]/90 to-[#A855F7]/90 text-white flex items-center justify-center font-bold shrink-0 shadow-lg">
            <div className="w-full h-full rounded-full bg-stone-900 border-2 border-stone-950 flex items-center justify-center font-bold text-white overflow-hidden">
              {isTeam ? (team!.kind === 'department' ? '🤝' : '👥') : active.avatar_url ? <img src={active.avatar_url} alt="" className="w-full h-full object-cover" /> : (active.username?.[0] || '?').toUpperCase()}
            </div>
            {!isTeam && presence[active.username]?.online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[3px] border-stone-950" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate text-white">{isTeam ? team!.name : active.name || active.username}{!isTeam && active.verified && <span className="ml-1 text-blue-400">✓</span>}</p>
            <p className="text-xs text-stone-400">{isTeam ? (team!.kind === 'group' ? 'Group conversation' : 'Department conversation') : presence[active.username]?.online ? <span className="text-green-400 font-semibold">Active now</span> : 'Harvest church family'}</p>
          </div>
          {sending ? <span className="text-[10px] text-stone-400">···</span> : null}
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {thread.length === 0 ? (
            <div className="min-h-full flex items-center justify-center py-12">
              <div className="w-full max-w-sm text-center px-6">
                <div className="mx-auto w-20 h-20 rounded-[28px] bg-gradient-to-br from-[#7C3AED]/20 to-[#A855F7]/20 border border-white/10 flex items-center justify-center text-3xl shadow-xl">💬</div>
                <h2 className="font-extrabold mt-5 text-lg text-white">{isTeam ? 'Start the team conversation' : 'Start a conversation'}</h2>
                <p className="text-sm leading-6 text-stone-400 mt-2">Share an encouragement, prayer, or simple hello. Your conversation will appear here.</p>
              </div>
            </div>
          ) : thread.map((m: any, index: number) => {
            const mine = m.from === currentUser
            const day = dayLabel(m.created_at || m.at)
            const showDay = day !== lastDay; lastDay = day
            const isReactionOpen = reactingFor === String(m.id)
            return (
              <div key={m.id}>
                {showDay && <div className="flex items-center gap-3 my-5"><div className="h-px flex-1 bg-stone-800" /><span className="px-3 py-1 rounded-full bg-stone-900/90 border border-stone-800 text-[10px] uppercase tracking-wider font-bold text-stone-500">{day}</span><div className="h-px flex-1 bg-stone-800" /></div>}
                {firstUnreadIndex === index && !unreadDividerShown && !mine && (unreadDividerShown = true) && (
                  <div className="flex items-center gap-3 my-4" aria-label="Unread messages">
                    <div className="h-px flex-1 bg-blue-500/40" /><span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-[10px] uppercase tracking-wider font-extrabold text-blue-400">New messages</span><div className="h-px flex-1 bg-blue-500/40" />
                  </div>
                )}
                {isTeam && !mine && <p className="text-[11px] font-bold text-stone-400 mb-1 ml-1">{m.from}</p>}
                <div className={`flex mb-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="relative max-w-[80%]">
                    {m.reaction && <button type="button" onClick={() => react(m, '')} className={`absolute -bottom-3 ${mine ? 'left-2' : 'right-2'} z-10 px-1.5 py-0.5 rounded-full bg-stone-800 border border-stone-700 shadow text-xs`}>{m.reaction}</button>}
                    <div
                      onContextMenu={e => { e.preventDefault(); setReactingFor(null); setActionFor(actionFor === String(m.id) ? null : String(m.id)) }}
                      onTouchStart={e => startSwipe(e, m)} onTouchEnd={e => endSwipe(e, m)} onTouchMove={e => moveSwipe(e, mine)}
                      onClick={() => setActionFor(actionFor === String(m.id) ? null : String(m.id))}
                      style={{ transform: !mine && swipeOffset ? `translateX(${swipeOffset}px)` : undefined, transition: swipeOffset ? 'none' : 'transform 160ms ease-out' }}
                      className={`px-3.5 py-2.5 rounded-3xl text-[15px] leading-snug cursor-pointer select-none shadow-sm ${mine ? 'bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white rounded-br-md shadow-purple-950/30' : 'bg-stone-800/95 text-stone-100 rounded-bl-md border border-stone-700/50'}`}
                    >
                      {m.reply_preview && (
                        <div className={`mb-1.5 pl-2 border-l-2 rounded px-2 py-1 text-xs ${mine ? 'border-white/60 bg-white/10 text-white/85' : 'border-blue-400 bg-stone-700/60 text-stone-200'}`}>
                          {m.reply_preview}
                        </div>
                      )}
                      {m.media_type === 'image' && m.media_key && !String(m.id).startsWith('tmp_') && (
                        <ChatPhoto messageId={String(m.id)} />
                      )}
                      {m.media_type === 'image' && !m.media_key && <div className="text-3xl mb-1">📷</div>}
                      {m.text && m.text !== '📷' && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                      <div className={`text-[10px] mt-1.5 flex items-center justify-end gap-1 ${mine ? 'text-white/65' : 'text-stone-500'}`}>
                        <time dateTime={m.created_at}>{m.at || new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                        <Ticks status={m.status} mine={mine} />
                      </div>
                    </div>
                    {(isReactionOpen || actionFor === String(m.id)) && (
                      <div className={`absolute -top-14 ${mine ? 'right-0' : 'left-0'} z-30 flex items-center gap-1 bg-stone-900/95 backdrop-blur border border-stone-700 shadow-2xl rounded-2xl px-2 py-1.5`}>
                        {REACTIONS.map(r => (
                          <button key={r} type="button" aria-label={`React ${r}`} onClick={e => { e.stopPropagation(); react(m, r); setActionFor(null) }} className="w-8 h-8 rounded-full text-lg hover:bg-stone-800 active:scale-90 transition">{r}</button>
                        ))}
                        <span className="h-6 w-px bg-stone-700 mx-0.5" />
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setReactingFor(null); setActionFor(null) }} className="w-8 h-8 rounded-full hover:bg-stone-800 text-blue-400 font-bold" aria-label="Reply">↩</button>
                        <button type="button" onClick={e => { e.stopPropagation(); void copyMessage(m) }} className="w-8 h-8 rounded-full hover:bg-stone-800 text-stone-300 font-bold" aria-label="Copy message">⧉</button>
                      </div>
                    )}
                    {actionFor === String(m.id) && (
                      <div className={`absolute ${mine ? 'right-0' : 'left-0'} top-full mt-2 z-30 w-48 rounded-2xl bg-stone-900/98 border border-stone-700 shadow-2xl p-1.5 backdrop-blur`}>
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setActionFor(null) }} className="w-full min-h-11 text-left px-3 py-2.5 rounded-xl hover:bg-stone-800 active:bg-stone-700 text-sm flex items-center gap-3">↩ Reply</button>
                        <button type="button" onClick={e => { e.stopPropagation(); setReactingFor(String(m.id)); setActionFor(null) }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-800 text-sm">😊 React</button>
                        <button type="button" onClick={e => { e.stopPropagation(); if (m.text) void navigator.clipboard?.writeText(String(m.text)); setNotice('Message copied'); setActionFor(null); window.setTimeout(() => setNotice(''), 1800) }} className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-stone-800 text-sm">⧉ Copy</button>
                        {m.media_type === 'image' && m.media_key && <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); void shareMedia(m) }} className="w-full min-h-11 text-left px-3 py-2.5 rounded-xl hover:bg-stone-800 active:bg-stone-700 text-sm flex items-center gap-3">↗ Share photo</button>}
                        {isTeam && canModerateChat && !m.deleted_at && <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); if (window.confirm('Remove this message for everyone?')) void moderateDelete(m) }} className="w-full min-h-11 text-left px-3 py-2.5 rounded-xl hover:bg-rose-950/60 active:bg-rose-950 text-sm text-rose-300 flex items-center gap-3">🗑 Remove for everyone</button>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {(notice || error) && <div className={`px-4 py-2 text-xs shrink-0 ${error ? 'bg-red-950 text-red-300' : 'bg-stone-900 text-amber-300'}`}>{error || notice}</div>}

        <div className="border-t border-stone-800/80 bg-[#1C1917]/95 backdrop-blur-xl px-3 pt-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.25)]">
          {replyTo && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 pl-3 border-l-4 border-blue-400 bg-stone-900 rounded-r-xl py-1.5 pr-2">
              <div className="min-w-0 flex-1 text-xs text-stone-300">
                <p className="font-bold">Replying to {replyTo.from === currentUser ? 'yourself' : replyTo.from}</p>
                <p className="truncate">{replyTo.media_type && !replyTo.text ? '📷 Photo' : String(replyTo.text || '')}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="w-7 h-7 rounded-full bg-stone-800 border border-stone-700 text-sm" aria-label="Cancel reply">✕</button>
            </div>
          )}
          {attach && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 text-xs bg-stone-900 border border-stone-800 rounded-xl px-3 py-2">
              <span>🖼 {attach.name.slice(0, 32)}</span>
              <button type="button" onClick={() => setAttach(null)} className="ml-auto text-stone-400" aria-label="Remove attachment">✕</button>
            </div>
          )}
          <div className="max-w-3xl mx-auto flex items-end gap-2 rounded-[28px] bg-white/[0.055] border border-white/10 p-1.5 focus-within:border-white/20 focus-within:bg-white/[0.07] transition">
            <label className="w-10 h-10 rounded-full text-stone-300 hover:text-white hover:bg-white/10 flex items-center justify-center text-lg cursor-pointer shrink-0" title="Send a photo">
              📷
              <input type="file" accept="image/*" className="hidden" onChange={e => setAttach(e.target.files?.[0] || null)} />
            </label>
            <textarea aria-label="Message" value={text} maxLength={4000} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              rows={1} placeholder={isTeam ? 'Message your team…' : 'Message…'}
              className="flex-1 resize-none min-h-11 max-h-28 bg-stone-900/90 border border-stone-700/80 rounded-3xl px-4 py-3 text-sm text-white outline-none focus:border-purple-500/70 focus:ring-1 focus:ring-purple-500/20 placeholder:text-stone-500 transition" />
            <button type="button" onClick={() => void send()} disabled={sending || (!text.trim() && !attach)}
              className="h-10 w-10 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-fuchsia-500 text-white text-base font-bold shadow-lg shadow-purple-900/30 disabled:opacity-30 disabled:shadow-none active:scale-95 transition shrink-0" aria-label="Send">
              {sending ? '…' : '↑'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#1C1917] text-white">
      <header className="px-4 pt-4 pb-3 bg-[#1C1917]/95 backdrop-blur-xl border-b border-stone-800/80 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button type="button" onClick={onBack} className="w-10 h-10 shrink-0 rounded-full bg-stone-900 border border-stone-800 hover:bg-stone-800 text-xl text-white" aria-label="Back">‹</button>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-extrabold">Harvest Family</p>
                <h1 className="text-xl font-extrabold text-white truncate">{chatView === 'community' ? 'Community' : 'Chats'}</h1>
              </div>
            </div>
            <button type="button" onClick={() => setTab(tab === 'people' ? 'inbox' : 'people')} className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 text-lg" aria-label={tab === 'people' ? 'Back to chats' : 'Find people'}>{tab === 'people' ? '←' : '＋'}</button>
          </div>
          {tab === 'inbox' && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
              <button type="button" onClick={() => setChatView('chats')} className={`px-4 py-2 rounded-full text-xs font-extrabold shrink-0 ${chatView === 'chats' ? 'bg-white text-black shadow-sm' : 'bg-stone-900 text-stone-400 border border-stone-800'}`}>Chats{totalUnread > 0 ? ` · ${totalUnread > 99 ? '99+' : totalUnread}` : ''}</button>
              <button type="button" onClick={() => onOpenGroups?.()} className="px-4 py-2 rounded-full text-xs font-extrabold shrink-0 bg-stone-900 text-stone-300 border border-stone-800">Groups</button>
              <button type="button" onClick={() => onOpenDepartments?.()} className="px-4 py-2 rounded-full text-xs font-extrabold shrink-0 bg-stone-900 text-stone-300 border border-stone-800">Departments</button>
              <button type="button" onClick={() => setChatView('community')} className={`px-4 py-2 rounded-full text-xs font-extrabold shrink-0 ${chatView === 'community' ? 'bg-amber-400 text-black' : 'bg-stone-900 text-stone-300 border border-stone-800'}`}>Community</button>
            </div>
          )}
        </div>
      </header>

      {tab === 'inbox' && chatView === 'community' ? (
        <CommunityHub
          onOpenTeam={(t) => { setError(''); setTeam(t); setChatView('chats') }}
          onOpenGroups={onOpenGroups}
          onOpenDepartments={onOpenDepartments}
        />
      ) : tab === 'inbox' ? (
        <>
          {/* Team chats: your departments + groups, always at the top of the inbox. */}
          <TeamChatsRail
            onOpen={(t) => { setError(''); setTeam(t) }}
            onOpenGroups={onOpenGroups}
            onOpenDepartments={onOpenDepartments}
          />
          {/* Instagram-style avatar rail */}
          <section className="px-4 pt-4 pb-1 border-b border-stone-800">
            <div className="flex gap-4 overflow-x-auto pb-3">
              {inbox.slice(0, 12).map(c => (
                <button type="button" key={`rail_${c.conversation_key}`} onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified, avatar_url: c.avatar_url }) }} className="shrink-0 w-[68px] text-center" aria-label={`Open chat with ${c.peer_name}`}>
                  <div className="relative p-[2.5px] rounded-full" style={{ background: c.unread > 0 ? 'linear-gradient(45deg,#f59e0b,#ec4899,#7c3aed)' : 'transparent', border: c.unread > 0 ? 'none' : '2px solid #3f3f46' }}>
                    <div className="w-[58px] h-[58px] rounded-full bg-stone-800 border-2 border-black overflow-hidden flex items-center justify-center font-extrabold text-lg text-stone-300">{c.avatar_url ? <img src={c.avatar_url} alt="" className="w-full h-full object-cover" /> : (c.peer?.[0] || '?').toUpperCase()}</div>
                    {presence[c.peer]?.online && <span className="absolute right-0.5 bottom-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1 truncate">{c.peer_name?.split(' ')[0] || c.peer}</p>
                </button>
              ))}
            </div>
          </section>
          {/* Search + tab pill row */}
          <section className="px-4 py-3 border-b border-stone-800">
            <div className="flex items-center gap-2 bg-stone-900 rounded-xl px-3 py-2.5">
              <span className="text-stone-500">⌕</span>
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-stone-500" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-white text-black">Inbox{totalUnread > 0 ? ` (${totalUnread > 99 ? '99+' : totalUnread})` : ''}</button>
              <button type="button" onClick={() => setTab('people')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-stone-900 text-stone-300 border border-stone-700">Requests</button>
              <span className="ml-auto text-xs text-stone-500 self-center">{inbox.length} chat{inbox.length === 1 ? '' : 's'}</span>
            </div>
          </section>
          <section className="px-3 pb-7">
            {inbox.length === 0 ? (
              <div className="mx-3 mt-6 rounded-3xl border border-stone-800 bg-stone-950 px-6 py-14 text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7C3AED]/20 to-[#A855F7]/20 flex items-center justify-center text-2xl">💬</div>
                <h2 className="mt-4 text-base font-extrabold text-white">Your conversations</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">Private chats with your Harvest church family will appear here.</p>
                <button type="button" onClick={() => setTab('people')} className="mt-5 rounded-full bg-white px-5 py-2 text-xs font-extrabold text-black">Find someone</button>
              </div>
            ) : [...inbox].sort((a, b) => Number(pinnedChats.includes(b.conversation_key)) - Number(pinnedChats.includes(a.conversation_key))).map(c => {
              const online = Boolean(presence[c.peer]?.online)
              const unread = Number(c.unread) || 0
              const preview = c.last_text || 'Say hello'
              return (
                <div key={c.conversation_key} className={`w-full flex items-center gap-3 rounded-2xl px-3 py-3.5 mb-1 transition ${unread > 0 ? 'bg-stone-900/80' : 'hover:bg-stone-900/50'}`}>
                  <div className="relative shrink-0">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center font-extrabold text-stone-300 ${unread > 0 ? 'bg-gradient-to-br from-purple-600 to-fuchsia-600 p-[2px]' : 'bg-stone-800'}`}>
                      <div className={`w-full h-full rounded-full flex items-center justify-center ${unread > 0 ? 'bg-stone-900' : 'bg-stone-800'}`}>{(c.peer?.[0] || '?').toUpperCase()}</div>
                    </div>
                    {online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <button type="button" onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified }) }} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className={`font-extrabold text-[15px] truncate ${unread > 0 ? 'text-white' : 'text-stone-200'}`}>{c.peer_name}{c.peer_verified && <span className="ml-1 text-blue-400">✓</span>}</p>
                      <span className={`ml-auto shrink-0 text-[10px] font-medium ${unread > 0 ? 'text-fuchsia-300' : 'text-stone-500'}`}>{c.last_at ? chatListTime(c.last_at) : ''}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={`text-[13px] truncate flex-1 ${unread > 0 ? 'text-stone-100 font-semibold' : 'text-stone-400'}`}>
                        {c.last_from === currentUser ? 'You: ' : ''}{preview}
                      </p>
                      {unread > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-[#ff3040] text-white text-[9px] font-extrabold flex items-center justify-center shadow-sm" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
                    </div>
                  </button>
                  <button type="button" onClick={() => togglePinned(c.conversation_key)} className="shrink-0 w-9 h-9 rounded-full text-xs text-stone-500 hover:text-amber-300 hover:bg-stone-800/70" aria-label={`${pinnedChats.includes(c.conversation_key) ? 'Unpin' : 'Pin'} conversation`}>{pinnedChats.includes(c.conversation_key) ? '★' : '☆'}</button>
                </div>
              )
            })}
          </section>
        </>
      ) : (
        <>
          <section className="px-4 py-3 border-b border-stone-800">
            <div className="flex items-center gap-2 bg-stone-900 rounded-xl px-3 py-2.5">
              <span className="text-stone-500">⌕</span>
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search people" className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-stone-500" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-stone-900 text-stone-300 border border-stone-700">Inbox</button>
              <button type="button" className="px-4 py-1.5 rounded-full text-xs font-bold bg-white text-black">People</button>
              <span className="ml-auto text-xs text-stone-500 self-center">{usersForSection.length} member{usersForSection.length === 1 ? '' : 's'}</span>
            </div>
          </section>
          {/* Notes-style presence row */}
          <section className="px-4 py-4 border-b border-stone-800">
            <div className="flex gap-4 overflow-x-auto pb-1">
              <div className="shrink-0 w-[68px] text-center">
                <div className="p-[2.5px] rounded-full border-2 border-dashed border-stone-600 w-fit mx-auto">
                  <div className="w-[58px] h-[58px] rounded-full bg-stone-800 flex items-center justify-center font-extrabold text-lg text-stone-300">{(currentUser?.[0] || '?').toUpperCase()}</div>
                </div>
                <p className="text-[11px] text-stone-400 mt-1 truncate">Your note</p>
              </div>
              {usersForSection.filter((u: any) => presence[u.username]?.online).slice(0, 12).map((u: any) => (
                <div key={`note_${u.username}`} className="shrink-0 w-[68px] text-center">
                  <div className="p-[2.5px] rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                    <div className="w-[58px] h-[58px] rounded-full bg-stone-800 border-2 border-black flex items-center justify-center font-extrabold text-lg text-stone-300">{(u.username?.[0] || '?').toUpperCase()}</div>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1 truncate">{u.username}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="pb-8">
            {usersForSection.length === 0 ? (
              <div className="p-10 text-center text-sm text-stone-400">No people in this section yet.</div>
            ) : usersForSection.map((u: any) => {
              const online = Boolean(presence[u.username]?.online)
              const inInbox = inbox.find(c => c.peer === u.username)
              return (
                <button type="button" key={u.username} onClick={() => { setError(''); setActive(u) }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-900/60 active:bg-stone-900 transition">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-full bg-stone-800 flex items-center justify-center font-extrabold text-stone-300">{(u.username?.[0] || '?').toUpperCase()}</div>
                    {online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[15px] text-white">{u.name || u.username}{u.verified && <span className="ml-1 text-blue-400">✓</span>}</p>
                    <p className="text-[13px] text-stone-400 truncate mt-0.5">{online ? 'Active now' : inInbox?.last_text || 'Start a conversation'}</p>
                  </div>
                  {inInbox && inInbox.unread > 0 && <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" aria-label={`${inInbox.unread} unread`} />}
                </button>
              )
            })}
          </section>
        </>
      )}
    </main>
  )
}

function CommunityHub({ onOpenTeam, onOpenGroups, onOpenDepartments }: {
  onOpenTeam: (t: TeamChat) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
}) {
  const [teams, setTeams] = useState<TeamChat[]>([])
  useEffect(() => {
    let live = true
    const load = async () => {
      const token = localStorage.getItem('harvest_token') || ''
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const out: TeamChat[] = []
      try {
        const r = await fetch(`${API}/api/departments`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.departments || []).filter((x: any) => x.joined || x.leader).forEach((x: any) => out.push({ kind: 'department', slug: x.slug, name: x.name }))
        }
      } catch {}
      try {
        const r = await fetch(`${API}/api/groups/mine`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.groups || []).forEach((x: any) => out.push({ kind: 'group', slug: x.slug, name: x.name }))
        }
      } catch {}
      if (live) setTeams(out)
    }
    void load()
    const refresh = () => void load()
    window.addEventListener('harvest:groups-changed', refresh)
    return () => { live = false; window.removeEventListener('harvest:groups-changed', refresh) }
  }, [])

  return (
    <section className="px-4 pt-5 pb-10 bg-gradient-to-b from-stone-950 via-black to-black min-h-[calc(100vh-150px)]">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-[28px] p-5 border border-amber-400/20 bg-gradient-to-br from-amber-400/15 via-purple-500/10 to-fuchsia-500/10 shadow-xl shadow-purple-950/20">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-2xl shadow-lg">⛪</div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-300 font-extrabold">Harvest Family Community</p>
              <h2 className="mt-1 text-2xl font-extrabold text-white">One church. One family.</h2>
              <p className="mt-2 text-sm leading-5 text-stone-300">Stay connected through announcements, departments, groups, prayer and everyday conversations.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={onOpenGroups} className="rounded-2xl bg-white text-black py-3 text-xs font-extrabold">👥 Explore groups</button>
            <button type="button" onClick={onOpenDepartments} className="rounded-2xl bg-stone-900/80 border border-stone-700 text-white py-3 text-xs font-extrabold">🏛 Departments</button>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-stone-500 font-bold">Your spaces</p>
              <h3 className="text-lg font-extrabold text-white">Groups & departments</h3>
            </div>
            <span className="text-xs text-stone-500">{teams.length} spaces</span>
          </div>
          {teams.length === 0 ? (
            <div className="rounded-2xl border border-stone-800 bg-stone-950 p-6 text-center text-sm text-stone-500">Your joined groups and departments will appear here.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {teams.map(t => (
                <button type="button" key={`${t.kind}_${t.slug}`} onClick={() => onOpenTeam(t)} className="text-left rounded-2xl border border-stone-800 bg-stone-950 p-4 hover:bg-stone-900 active:scale-[.99] transition">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl ${t.kind === 'department' ? 'bg-amber-400/15' : 'bg-purple-500/15'}`}>{t.kind === 'department' ? '🏛️' : '👥'}</div>
                  <p className="mt-3 text-sm font-extrabold text-white truncate">{t.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-stone-500">{t.kind}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-stone-800 bg-stone-950 p-4">
          <p className="text-[10px] uppercase tracking-[0.16em] text-stone-500 font-bold">Community feed</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-400/15 flex items-center justify-center">📢</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Church announcements</p>
              <p className="text-xs text-stone-500 truncate">Important updates from Harvest Family will appear here.</p>
            </div>
            <span className="text-stone-600">›</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// Team chats rail: every department + small group the viewer belongs to.
// Departments act like groups (client's request) — both get real chat rooms.
function TeamChatsRail({ onOpen, onOpenGroups, onOpenDepartments }: {
  onOpen: (t: TeamChat) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
}) {
  const [teams, setTeams] = useState<TeamChat[]>([])
  useEffect(() => {
    let live = true
    const refresh = async () => {
      const token = localStorage.getItem('harvest_token') || ''
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const out: TeamChat[] = []
      const counts = new Map<string, number>()
      try {
        const r = await fetch(`${API}/api/chat/conversations`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.team_conversations || []).forEach((x: any) => counts.set(String(x.conversation_key), Number(x.unread) || 0))
        }
      } catch { /* offline */ }
      try {
        const r = await fetch(`${API}/api/departments`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.departments || []).filter((x: any) => x.joined || x.leader).forEach((x: any) => out.push({
            kind: 'department', slug: x.slug, name: x.name,
            unread: counts.get(`department:${x.slug}`) || 0,
          }))
        }
      } catch { /* offline */ }
      try {
        const r = await fetch(`${API}/api/groups/mine`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.groups || []).forEach((x: any) => out.push({
            kind: 'group', slug: x.slug, name: x.name,
            unread: counts.get(`group:${x.slug}`) || 0,
          }))
        }
      } catch { /* offline */ }
      if (live) setTeams(out)
    }
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    refreshVisible()
    const timer = window.setInterval(refreshVisible, 3000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [])
  return (
    <section className="px-4 pt-4 pb-1 border-b border-stone-800">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-stone-500 font-bold">Your community</p>
        <div className="flex items-center gap-1.5">
          {onOpenGroups && (
            <button type="button" onClick={onOpenGroups} className="px-2.5 py-1.5 rounded-full bg-stone-900 border border-stone-700 text-[10px] font-bold text-stone-200 active:bg-stone-800">
              Groups
            </button>
          )}
          {onOpenDepartments && (
            <button type="button" onClick={onOpenDepartments} className="px-2.5 py-1.5 rounded-full bg-stone-900 border border-stone-700 text-[10px] font-bold text-stone-200 active:bg-stone-800">
              Departments
            </button>
          )}
        </div>
      </div>
      {teams.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-3">
          {teams.map(t => (
          <button type="button" key={`${t.kind}_${t.slug}`} onClick={() => onOpen(t)} className="shrink-0 w-[68px] text-center" aria-label={`Open ${t.name} chat`}>
            <div className="relative w-[62px] h-[62px] mx-auto">
              <div className="w-full h-full rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center text-2xl shadow-lg">{t.kind === 'department' ? '🤝' : '👥'}</div>
              {Number(t.unread) > 0 && <span className="absolute -right-1.5 -top-1.5 w-[18px] h-[18px] rounded-full bg-[#ff3040] text-white text-[9px] leading-none font-bold flex items-center justify-center border-2 border-black shadow-sm">{Number(t.unread) > 99 ? '99+' : t.unread}</span>}
            </div>
            <p className="text-[11px] text-stone-200 mt-1 truncate">{t.name}</p>
            <p className="text-[9px] uppercase tracking-wide text-stone-600">{t.kind === 'department' ? 'Department' : 'Group'}</p>
          </button>
          ))}
        </div>
      )}
      {teams.length === 0 && (
        <p className="text-[11px] text-stone-500 pb-3">No groups or departments yet. Use the buttons above to browse them.</p>
      )}
    </section>
  )
}