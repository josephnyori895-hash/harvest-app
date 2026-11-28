import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent } from 'react'
import { useAuth } from '../state/auth'
import { useModalFocus } from '../lib/useModalFocus'
import { showMessageNotification, ensureNotificationChannel } from '../lib/notifications'
import { onSocket, emitSocket, connectSocket, realtimeEnabled } from '../lib/realtime'
import { Dialog, Icon, Spinner } from '../ui'

import ErrorMessage from './ErrorMessage'
import UnreadBadge from './UnreadBadge'
import { VerifiedBadge } from './VerifiedBadge'
type Section = 'personal' | 'groups' | 'ministry' | 'prayer'
type ChatUser = any
type Presence = { online: boolean; lastSeen: string }

const API = import.meta.env.VITE_API_URL || ''
const REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '🔥'] as const

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
  // Without a timeout a stalled socket leaves the thread on "Loading…"
  // forever; the poller then stacks more requests behind the dead one.
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${API}${path}`, { ...options, headers, signal: options.signal || controller.signal })
    const raw = await response.text()
    let data: any = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
    if (!response.ok) throw new Error(data.error || data.message || raw || `Request failed (${response.status})`)
    return data as T
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Request timed out — check your connection and try again')
    if (e instanceof TypeError) throw new Error('Could not reach the church server — check your connection and try again')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

// Returns the SAME array reference when nothing actually changed. Callers feed
// this into setState; without identity preservation every poll produced a new
// array, which re-rendered the screen and re-created the history-loading
// callback — the loop that refetched /api/chat/history continuously.
function mergeMessages(current: any[], incoming: any[]) {
  const byId = new Map(current.map(m => [String(m.id), m]))
  let changed = false
  incoming.forEach(m => {
    const id = String(m.id)
    const prev = byId.get(id)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(m)) changed = true
    byId.set(id, m)
  })
  if (!changed) return current
  return [...byId.values()].sort((a, b) => new Date(a.created_at || a.at).getTime() - new Date(b.created_at || b.at).getTime())
}

// localStorage holds roughly 5 MB. Keep only the freshest slice of each
// conversation so a busy church chat cannot blow the quota.
function trimMessagesForStorage(all: Record<string, any[]>, perConversation = 60) {
  const out: Record<string, any[]> = {}
  for (const [key, list] of Object.entries(all)) {
    out[key] = Array.isArray(list) ? list.slice(-perConversation) : []
  }
  return out
}

// Chat photos are served as HMAC-signed URLs minted by the server for participants.
// Those URLs EXPIRE, so caching one forever guarantees a broken image a few
// minutes into a conversation. Track age, refresh before it goes stale, and
// recover from a failed load instead of leaving a dead <img>.
const SIGNED_URL_TTL_MS = 8 * 60 * 1000
// A voice note is recorded in the container MediaRecorder supports on this
// device. Android WebView usually offers webm/opus; iOS Safari gives mp4.
const VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
const signedUrlCache: Record<string, { url: string; at: number }> = {}
function cachedSignedUrl(messageId: string): string | null {
  const hit = signedUrlCache[messageId]
  return hit && Date.now() - hit.at < SIGNED_URL_TTL_MS ? hit.url : null
}
function invalidateSignedUrl(messageId: string) { delete signedUrlCache[messageId] }
async function fetchSignedMediaUrl(messageId: string, force = false): Promise<string | null> {
  if (!force) { const hit = cachedSignedUrl(messageId); if (hit) return hit }
  try {
    const r = await api<{ url: string }>(`/api/chat/media/${encodeURIComponent(messageId)}`)
    if (!r?.url) return null
    signedUrlCache[messageId] = { url: r.url, at: Date.now() }
    return r.url
  } catch { return null }
}

function ChatPhoto({ messageId, onOpen }: { messageId: string; onOpen?: (src: string) => void }) {
  const [src, setSrc] = useState<string | null>(() => cachedSignedUrl(messageId))
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    const fresh = cachedSignedUrl(messageId)
    if (fresh) { setSrc(fresh); return () => { live = false } }
    setSrc(null)
    void fetchSignedMediaUrl(messageId, true).then(u => { if (live) setSrc(u) })
    return () => { live = false }
  }, [messageId])
  const retry = () => {
    invalidateSignedUrl(messageId)
    setFailed(false)
    setSrc(null)
    void fetchSignedMediaUrl(messageId, true).then(u => setSrc(u))
  }
  if (failed) return (
    <button type="button" onClick={retry} className="mb-1.5 flex h-32 w-52 items-center justify-center rounded-xl bg-surface-sunken px-3 text-center text-xs font-semibold text-ink-muted">
      Photo unavailable — tap to retry
    </button>
  )
  if (!src) return <div className="mb-1.5 h-40 w-56 animate-pulse rounded-xl bg-surface-sunken" />
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onOpen?.(src) }}
      className="mb-1.5 block max-w-full overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      aria-label="Open photo full screen"
    >
      <img
        src={src}
        alt="Shared photo"
        className="max-h-72 w-auto rounded-xl"
        loading="lazy"
        onError={() => { invalidateSignedUrl(messageId); setFailed(true) }}
      />
    </button>
  )
}

// Voice notes reuse the same signed-URL lifecycle as chat photos: the URL
// expires, so it is fetched when the bubble mounts and a failed tap retries.
function ChatAudio({ messageId }: { messageId: string }) {
  const [src, setSrc] = useState<string | null>(() => cachedSignedUrl(messageId))
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    const fresh = cachedSignedUrl(messageId)
    if (fresh) { setSrc(fresh); return () => { live = false } }
    setSrc(null)
    void fetchSignedMediaUrl(messageId, true).then(u => { if (live) setSrc(u) })
    return () => { live = false }
  }, [messageId])
  const retry = () => {
    invalidateSignedUrl(messageId)
    setFailed(false)
    void fetchSignedMediaUrl(messageId, true).then(u => setSrc(u))
  }
  if (failed) return (
    <button type="button" onClick={retry} className="mb-1 flex h-12 w-56 items-center justify-center rounded-xl bg-surface-sunken px-3 text-xs font-semibold text-ink-muted">
      Voice note unavailable — tap to retry
    </button>
  )
  if (!src) return <div className="mb-1 h-12 w-56 animate-pulse rounded-xl bg-surface-sunken" />
  return (
    <audio
      controls
      preload="metadata"
      src={src}
      aria-label="Voice message"
      onError={() => { invalidateSignedUrl(messageId); setFailed(true) }}
      className="mb-1 h-11 w-60 max-w-full rounded-full"
    />
  )
}

const formatSeconds = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`

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
  if (status === 'sending') return <Icon name="clock" size={12} strokeWidth={2} className="opacity-70" title="Sending" />
  if (status === 'failed') return <Icon name="alert" size={12} strokeWidth={2.2} className="text-danger" title="Failed to send" />
  const seen = status === 'seen'
  const label = seen ? 'Seen' : status === 'delivered' ? 'Delivered' : 'Sent'
  return (
    <span className={`inline-flex items-center gap-0.5 ${seen ? 'text-gold-soft' : 'opacity-70'}`} aria-label={label} title={label}>
      <Icon name="check" size={12} strokeWidth={2.6} />
      {(seen || status === 'delivered') && <Icon name="check" size={12} strokeWidth={2.6} className="-ml-2" />}
    </span>
  )
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

export type TeamChat = { kind: 'department' | 'group'; slug: string; name: string; unread?: number; avatar_url?: string | null; chat_background_url?: string | null }

export default function Chat({ onBack, users, teamChat, dmTarget, onDmOpened, onCloseTeam, onOpenGroups, onOpenDepartments, onOpenUser, onOpenProfile, onActiveChange, onMinimize, onExpand, compact = false }: {
  onBack: () => void
  users: ChatUser[]
  teamChat?: TeamChat | null
  dmTarget?: { id: string; username: string; name?: string } | null
  onDmOpened?: () => void
  onCloseTeam?: () => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenUser?: (user: any) => void
  /** Opens a member's profile from inside a conversation. Kept separate from
      onOpenUser so a DM can be restored when the member comes back. */
  onOpenProfile?: (user: any) => void
  /** Reports the open 1:1 peer so the mini panel can reopen it full-screen. */
  onActiveChange?: (user: ChatUser | null) => void
  /** Compact-panel-only window controls. */
  onMinimize?: () => void
  onExpand?: () => void
  /** Rendered inside the small floating DM card: drop the brand eyebrow and
      the community/avatar rails so the header does not eat the whole card. */
  compact?: boolean
}) {
  const { username: authUsername } = useAuth()
  const [tab, setTab] = useState<'inbox' | 'people'>('inbox')
  const [chatView, setChatView] = useState<'chats' | 'community'>('chats')
  const [section] = useState<Section>('personal')
  const [active, setActive] = useState<ChatUser | null>(null)
  useEffect(() => { onActiveChange?.(active) }, [active, onActiveChange])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [photoViewer, setPhotoViewer] = useState<{ src: string; id: string } | null>(null)
  const photoViewerRef = useRef<HTMLDivElement>(null)
  useModalFocus(Boolean(photoViewer), photoViewerRef, () => setPhotoViewer(null))
  const [inbox, setInbox] = useState<any[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxError, setInboxError] = useState('')
  const inboxLoadedRef = useRef(false)
  const totalUnread = useMemo(() => inbox.reduce((sum, c) => sum + (Number(c.unread) || 0), 0), [inbox])
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} }
  })
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [replyTo, setReplyTo] = useState<any | null>(null)
  // Team chat: departments AND small groups — both are server-enforced memberships.
  const [team, setTeam] = useState<TeamChat | null>(null)
  // The group/department photo and chat background are managed by its leaders.
  // Load them when a team conversation opens (the chat entry only carries slug).
  useEffect(() => {
    if (!team?.slug) return
    let alive = true
    const url = team.kind === 'group'
      ? `/api/groups/${encodeURIComponent(team.slug)}`
      : `/api/departments/${encodeURIComponent(team.slug)}`
    api<any>(url)
      .then(d => {
        if (!alive) return
        const t = d?.group || d?.department
        if (!t) return
        setTeam(prev => prev && prev.slug === team.slug
          ? { ...prev, avatar_url: t.avatar_url || null, chat_background_url: t.chat_background_url || null }
          : prev)
      })
      .catch(() => { /* art is supplemental */ })
    return () => { alive = false }
  }, [team?.kind, team?.slug])
  useEffect(() => {
    if (teamChat) {
      // A team route is authoritative: never leave a previous DM or Community
      // view mounted underneath it.
      setActive(null)
      setTeam(teamChat)
      setChatView('chats')
    } else {
      setTeam(null)
    }
  }, [teamChat])
  // 'Pray with Pastor' deep link: jump straight into the 1:1 DM.
  useEffect(() => {
    if (!dmTarget?.id || !dmTarget?.username) return
    const id = String(dmTarget.id)
    const u = String(dmTarget.username)
    // The database user ID is canonical. The username is retained only because
    // the existing chat API uses it as the peer address/conversation key.
    // The mini panel knows the peer by username; the database ID is canonical
    // for full-screen opens. Match either, but never open a mismatched account.
    const wanted = u.trim().toLowerCase().replace(/^@/, '')
    const dir = (users as any[]).find(x => String(x.id) === id)
      || (users as any[]).find(x => String(x.username || '').trim().toLowerCase().replace(/^@/, '') === wanted)
    if (!dir || String(dir.username || '').trim().toLowerCase().replace(/^@/, '') !== wanted) return
    setActive({
      ...dir,
      id: String(dir.id || id),
      username: String(dir.username),
      name: dir.name || dmTarget.name || u,
      verified: dir.verified,
      avatar_url: dir.avatar_url,
    })
    setTeam(null)
    setChatView('chats')
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
  // Photo or voice note — the server stores the kind so the bubble renders the
  // right player instead of guessing from the file extension.
  const [attachKind, setAttachKind] = useState<'image' | 'audio'>('image')
  // Mirror of `attach` for retry paths: retryMessage must be able to hand the
  // exact file back to send() even though setAttach setState is asynchronous.
  const attachRef = useRef<File | null>(null)
  const attachKindRef = useRef<'image' | 'audio'>('image')
  // Voice notes: MediaRecorder writes chunks while the mic is open, and the
  // finished blob becomes a normal chat attachment — the upload path is shared.
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunks = useRef<Blob[]>([])
  const recordSecondsRef = useRef(0)
  const recordTimer = useRef<number | null>(null)
  const recordCancelled = useRef(false)
  // Forward: pick another conversation and re-send the same message content.
  const [forwardFor, setForwardFor] = useState<any | null>(null)
  const [forwardTargets, setForwardTargets] = useState<any[]>([])
  const [forwardBusy, setForwardBusy] = useState<string | null>(null)
  // In-conversation search filters the loaded thread; no new endpoint needed.
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearch, setThreadSearch] = useState('')
  // File preserved from a failed send so Retry re-uploads the media instead
  // of silently converting an attachment into a plain-text message.
  const failedFileRef = useRef<{ tempId: string; file: File; kind: 'image' | 'audio' } | null>(null)
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
  // Derived in the component body (not a JSX inline IIFE): the search box filters the
  // inbox, then pinned conversations sort to the top.
  const inboxQuery = peopleQuery.trim().toLowerCase()
  const visibleInbox = inboxQuery
    ? inbox.filter(c => `${c.peer_name || ''} ${c.peer || ''} ${c.last_text || ''}`.toLowerCase().includes(inboxQuery))
    : inbox
  const sortedInbox = [...visibleInbox].sort((a, b) =>
    Number(pinnedChats.includes(b.conversation_key)) - Number(pinnedChats.includes(a.conversation_key)),
  )
  const cursorRef = useRef<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  // Wide layout: the conversation list stays docked beside the thread instead
  // of being covered by it. Tracked in JS (not only CSS) so the list pane is
  // not even mounted on a phone — it polls every 3s and must not double up
  // with the open conversation's polling.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setWide(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // Reading position: follow new messages only while the reader is at the
  // bottom. Scrolling up must never yank them back down.
  const [atBottom, setAtBottom] = useState(true)
  const [unseenBelow, setUnseenBelow] = useState(0)
  const prevThreadLen = useRef(0)
  const syncScrollState = () => {
    const el = messagesRef.current
    if (!el) return
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setAtBottom(atEnd)
    if (atEnd) setUnseenBelow(0)
  }
  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setUnseenBelow(0)
    setAtBottom(true)
  }
  // Android IME can resize the WebView viewport without reliably updating 100dvh.
  // Track the visual viewport so the composer remains inside the visible area,
  // but never let that height exceed the chat pane (see the style below).
  const [chatViewportHeight, setChatViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const syncViewport = () => setChatViewportHeight(Math.max(320, Math.round(viewport.height)))
    syncViewport()
    viewport.addEventListener('resize', syncViewport)
    viewport.addEventListener('scroll', syncViewport)
    return () => {
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
    }
  }, [])
  const pressTimer = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)
  const currentUser = authUsername || localStorage.getItem('harvest_username') || ''
  const currentProfile = users.find((u: any) => u.username === currentUser)
  // Tap a name or avatar to open that member's profile. Directory entry when we
  // have it, otherwise the conversation's own snapshot (ViewUser fetches by
  // username anyway).
  const openMemberProfile = (person: any) => {
    if (!onOpenProfile || !person?.username) return
    const dir = (users as any[]).find(u => String(u.username || '').toLowerCase() === String(person.username).toLowerCase())
    onOpenProfile(dir || person)
  }
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
  // In-conversation search over what this device has loaded. Instagram searches
  // the thread, not the whole inbox — the inbox already has its own box.
  const searchNeedle = threadSearch.trim().toLowerCase()
  const displayThread = searchNeedle
    ? thread.filter(m => `${m.text || ''} ${m.from || ''}`.toLowerCase().includes(searchNeedle))
    : thread

  // Typing indicator over the realtime socket. The server already validates
  // access per conversation kind (DM/group/department) and stops fanout after
  // 3s of silence — the client just mirrors it here.
  const [typingPeers, setTypingPeers] = useState<Record<string, Record<string, number>>>({})
  const typingSentRef = useRef<{ key: string; at: number } | null>(null)
  useEffect(() => {
    if (!realtimeEnabled()) return
    connectSocket()
    const off = onSocket('typing', (data: any) => {
      const ck = String(data?.conversation_key || '')
      const uname = String(data?.username || '')
      if (!ck || !uname) return
      setTypingPeers(c => {
        const row = { ...(c[ck] || {}) }
        if (data?.typing) row[uname] = Date.now()
        else delete row[uname]
        if (!Object.keys(row).length) { const n = { ...c }; delete n[ck]; return n }
        return { ...c, [ck]: row }
      })
    })
    const prune = window.setInterval(() => {
      setTypingPeers(c => {
        let changed = false
        const next: Record<string, Record<string, number>> = {}
        for (const [ck, row] of Object.entries(c)) {
          const nr: Record<string, number> = {}
          for (const [u, at] of Object.entries(row)) if (Date.now() - (Number(at) || 0) < 5500) nr[u] = Number(at); else changed = true
          if (Object.keys(nr).length) next[ck] = nr; else changed = true
        }
        return changed ? next : c
      })
    }, 3000)
    return () => { off(); clearInterval(prune) }
  }, [])
  const sendTyping = useCallback((typing: boolean) => {
    if (!conversationKey) return
    if (typing) {
      const now = Date.now()
      const last = typingSentRef.current
      if (last && last.key === conversationKey && now - last.at < 1800) return
      typingSentRef.current = { key: conversationKey, at: now }
      emitSocket('typing:start', { conversation_key: conversationKey })
    } else {
      if (typingSentRef.current?.key !== conversationKey) return
      typingSentRef.current = null
      emitSocket('typing:stop', { conversation_key: conversationKey })
    }
  }, [conversationKey])

  // Realtime delivery loop: join the conversation on open + render incoming
  // chat:message frames into the thread (polling stays as the fallback).
  useEffect(() => {
    if (!realtimeEnabled()) return
    connectSocket()
    const off = onSocket('chat:message', (data: any) => {
      const ck = String(data?.conversation_key || '')
      if (!conversationKey || ck !== conversationKey) return
      if (String(data?.from || '') === currentUser) return
      const incoming: any = {
        id: String(data.id ?? `rt_${Date.now()}`),
        kind: data.kind || (team ? 'group' : 'dm'),
        from: String(data.from || ''),
        to: team ? null : String(data.to || ''),
        text: String(data.text || ''),
        status: String(data.status || 'sent'),
        created_at: String(data.created_at || new Date().toISOString()),
        at: String(data.at || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        reply_to_id: data.reply_to_id || null,
        reply_preview: data.reply_preview || null,
        media_type: data.media_type || null,
        media_key: data.media_key || null,
      }
      setMsgs(c => {
        const list = c[conversationKey] || []
        if (list.some(m => String(m.id) === String(incoming.id))) return c
        return { ...c, [conversationKey]: [...list, incoming] }
      })
    })
    const join = () => {
      if (!conversationKey) return
      if (team) {
        if (team.kind === 'group') emitSocket('group:join', { slug: team.slug })
        return
      }
      const peer = team ? null : String((active as any)?.username || '')
      if (peer) emitSocket('chat:join', { peer })
    }
    join()
    return () => { off() }
  }, [conversationKey, team, active, currentUser, realtimeEnabled])

  // Mirror of the thread map so loaders can read the latest messages WITHOUT
  // taking `msgs` as a dependency (see mergeMessages).
  const msgsRef = useRef(msgs)
  useEffect(() => { msgsRef.current = msgs }, [msgs])

  const saveMessages = useCallback((updater: Record<string, any[]> | ((c: Record<string, any[]>) => Record<string, any[]>)) => {
    setMsgs(current => {
      const next = typeof updater === 'function' ? updater(current) : updater
      if (next === current) return current
      // Persistence is best-effort: a quota error used to escape the state
      // updater and take the whole screen down. Trim, retry once, then run
      // memory-only for the rest of the session.
      try {
        localStorage.setItem('harvest_msgs', JSON.stringify(trimMessagesForStorage(next)))
      } catch {
        try { localStorage.setItem('harvest_msgs', JSON.stringify(trimMessagesForStorage(next, 20))) }
        catch { /* memory-only this session */ }
      }
      return next
    })
  }, [])

  const clearRecorder = () => {
    const rec = recorderRef.current
    recorderRef.current = null
    if (recordTimer.current) { window.clearInterval(recordTimer.current); recordTimer.current = null }
    try { rec?.stream.getTracks().forEach(track => track.stop()) } catch { /* stream already gone */ }
  }

  const stopRecording = (cancel = false) => {
    recordCancelled.current = cancel
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') { setRecording(false); return }
    try { rec.stop() } catch { clearRecorder(); setRecording(false) }
  }

  // Hold-to-talk is optional; this records until the member taps stop, which is
  // the same gesture Instagram uses for a hands-free voice note.
  const startRecording = async () => {
    if (recording || sending || attach) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice notes are not supported on this device — you can still send a photo or text')
      return
    }
    try {
      setError('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = VOICE_MIME_TYPES.find(type => { try { return MediaRecorder.isTypeSupported(type) } catch { return false } })
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recordChunks.current = []
      recordCancelled.current = false
      recordSecondsRef.current = 0
      setRecSeconds(0)
      rec.ondataavailable = event => { if (event.data?.size) recordChunks.current.push(event.data) }
      rec.onstop = () => {
        const seconds = recordSecondsRef.current
        const cancelled = recordCancelled.current
        clearRecorder()
        setRecording(false)
        setRecSeconds(0)
        if (cancelled) return
        const type = String(rec.mimeType || recordChunks.current[0]?.type || 'audio/webm').split(';')[0]
        const blob = new Blob(recordChunks.current, { type })
        recordChunks.current = []
        if (!blob.size) { setError('Nothing was recorded — hold the mic and speak, then tap stop'); return }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type })
        setAttach(file)
        attachRef.current = file
        setAttachKind('audio')
        attachKindRef.current = 'audio'
        setNotice(`Voice note ready · ${formatSeconds(seconds)}`)
      }
      recorderRef.current = rec
      setRecording(true)
      rec.start()
      recordTimer.current = window.setInterval(() => {
        recordSecondsRef.current += 1
        setRecSeconds(recordSecondsRef.current)
        // Cap at two minutes: a chat voice note, not a voicemail box.
        if (recordSecondsRef.current >= 120) stopRecording(false)
      }, 1000)
    } catch {
      clearRecorder()
      setRecording(false)
      setError('Microphone access was blocked — allow it to send a voice note')
    }
  }

  // Leaving the conversation (or unmounting) must release the microphone; a
  // recorder left running silently keeps the device's mic indicator on.
  useEffect(() => () => {
    recordCancelled.current = true
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch { /* already stopped */ } }
    if (recordTimer.current) window.clearInterval(recordTimer.current)
  }, [])

  const refreshInbox = useCallback(async () => {
    if (!inboxLoadedRef.current) setInboxLoading(true)
    if (!localStorage.getItem('harvest_token')) { setInboxLoading(false); return }
    try {
      const r = await api<{ conversations: any[] }>('/api/chat/conversations')
      const next = r.conversations || []
      setInboxError('')
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
      inboxLoadedRef.current = true
      setInboxLoading(false)
    } catch {
      // Only surface an error when the first inbox load has no usable data yet.
      // Later polling stays silent and preserves the last-known inbox.
      if (!inboxLoadedRef.current) setInboxError('We couldn’t load your conversations. Check your connection and try again.')
      setInboxLoading(false)
    }
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
        const existing = mergeMessages(msgsRef.current[k] || [], result.messages || [])
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
      const existing = mergeMessages(msgsRef.current[k] || [], result.messages || [])
      cursorRef.current[k] = existing[existing.length - 1]?.created_at || new Date(Date.now() - 5000).toISOString()
      void markSeen()
      void refreshInbox()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversation')
    }
  }, [active, team, currentUser, conversationKey, saveMessages, markSeen, refreshInbox])

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

  useEffect(() => {
    const before = prevThreadLen.current
    prevThreadLen.current = thread.length
    if (thread.length <= before) return
    const added = thread.length - before
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    else setUnseenBelow(n => n + added)
  }, [thread.length, atBottom])
  // A different conversation starts at its newest message, not wherever the
  // previous one was scrolled to.
  useEffect(() => {
    prevThreadLen.current = 0
    setUnseenBelow(0)
    setAtBottom(true)
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversationKey])

  const send = async (bodyOverride?: string, fileOverride?: File | null, idempotencyKey?: string) => {
    const attach = fileOverride !== undefined ? fileOverride : attachRef.current
    const attachKind = attachKindRef.current
    const body = (bodyOverride ?? text).trim()
    if ((!active && !team) || !currentUser || sending || (!body && !attach)) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }
    if (!localStorage.getItem('harvest_token')) { setError('Your session has expired. Please sign in again.'); return }

    const tempId = `tmp_${Date.now()}`
    if (attach) failedFileRef.current = { tempId, file: attach, kind: attachKind }
    const optimistic: any = {
      id: tempId, from: currentUser, to: team ? null : active.username,
      text: attach && !body ? (attachKind === 'audio' ? '🎤 Voice message' : '📷') : body, status: 'sending',
      created_at: new Date().toISOString(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reply_to_id: replyTo?.id || null,
      reply_preview: replyTo ? `${replyTo.from === currentUser ? 'You' : replyTo.from}: ${replyTo.media_type && !replyTo.text ? '📷 Photo' : String(replyTo.text || '').slice(0, 80)}` : null,
      media_type: attach ? attachKind : null,
    }
    saveMessages(c => ({ ...c, [conversationKey]: [...(c[conversationKey] || []), optimistic] }))
    // RS-122: the attachment stays on the composer until the send is actually
    // confirmed. Clearing it here meant a failed upload silently ate the chip and
    // left only an in-memory copy for the retry, which a reload could not recover.
    const sentReply = replyTo; setText(''); setReplyTo(null); setSending(true); setError('')
    sendTyping(false)

    try {
      let media_key: string | undefined
      if (attach) {
        const pre = await api<any>('/api/media/presign', { method: 'POST', body: JSON.stringify({ type: 'chat', contentType: attach.type || 'image/jpeg', bytes: attach.size, ext: (attach.name.split('.').pop() || 'jpg').toLowerCase(), idempotencyKey: idempotencyKey || `chat_${tempId}` }) })
        const target = /^https?:\/\//.test(pre.url) ? pre.url : `${API}${pre.url}`
        const isDirectR2 = /^https?:\/\//.test(pre.url)
        let up
        // A photo send must end in success or a retryable failure — a dead
        // socket used to leave the bubble on "sending" forever.
        const uploadController = new AbortController()
        const uploadTimer = window.setTimeout(() => uploadController.abort(), 90_000)
        try {
          if (isDirectR2 && pre.method === 'PUT') {
            // Direct R2 uploads are presigned PUTs; send the signed headers exactly
            // as returned by the Worker and never attach the Harvest bearer token.
            up = await fetch(target, {
              method: 'PUT',
              body: attach,
              headers: { ...(pre.fields || {}) },
              signal: uploadController.signal,
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
              signal: uploadController.signal,
            })
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') throw new Error('Photo upload timed out — tap Retry to send it again')
          if (e instanceof TypeError) throw new Error('Could not reach media storage — check your connection and tap Retry')
          throw e
        } finally {
          window.clearTimeout(uploadTimer)
        }
        if (!up.ok) throw new Error('Media storage is not enabled yet — text messages still work')
        media_key = pre.key
      }
      let socketConfirmed: any = null
      if (!attach) {
        // Realtime send path (DO chat:send fan-out) with REST fallback.
        const socketPayload = team
          ? (team.kind === 'group' ? { kind: 'group', groupSlug: team.slug, body } : { kind: 'group', department: team.slug, body })
          : { kind: 'dm', to: String((active as any)?.username || ''), body }
        const ackRes = await new Promise<any>(resolve => emitSocket('chat:send', { ...socketPayload, tempId }, resolve))
        if (ackRes && ackRes.ok) {
          socketConfirmed = { ...optimistic, id: String(ackRes.id || ackRes.serverId || tempId), status: 'sent', created_at: new Date().toISOString(), at: ackRes.at || optimistic.at }
          saveMessages(c => ({ ...c, [conversationKey]: mergeMessages((c[conversationKey] || []).filter(m => String(m.id) !== tempId), [socketConfirmed]) }))
          cursorRef.current[conversationKey] = socketConfirmed.created_at || cursorRef.current[conversationKey]
          failedFileRef.current = null
          // Confirmed — the attachment has done its job.
          setAttach(null); attachRef.current = null
          setAttachKind('image'); attachKindRef.current = 'image'
          void refreshInbox()
          return
        }
      }
      const teamPayload = team ? (team.kind === 'group' ? { group: team.slug } : { department: team.slug }) : { peer: active.username }
      const result = await api<{ message: any }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          ...teamPayload,
          body, media_key, media_type: media_key ? attachKind : undefined,
          reply_to_id: sentReply && !String(sentReply.id).startsWith('tmp_') ? sentReply.id : undefined,
        }),
      })
      const confirmed = { ...result.message, status: result.message?.status === 'seen' ? 'seen' : 'sent' }
      saveMessages(c => ({ ...c, [conversationKey]: mergeMessages((c[conversationKey] || []).filter(m => String(m.id) !== tempId), [confirmed]) }))
      cursorRef.current[conversationKey] = confirmed.created_at || cursorRef.current[conversationKey]
      failedFileRef.current = null
      // Confirmed on the REST path too — release the chip only now.
      setAttach(null); attachRef.current = null
      setAttachKind('image'); attachKindRef.current = 'image'
      void refreshInbox()
    } catch (e) {
      const messageError = e instanceof Error ? e.message : 'Message could not be sent'
      setError(messageError)
      // Keep the failed bubble in place so the user can retry without losing text.
      saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).map(m => String(m.id) === tempId ? { ...m, status: 'failed', error: messageError } : m) }))
      setText(body)
    } finally { setSending(false) }
  }

  const retryMessage = async (message: any) => {
    if (sending || !message || String(message.id).startsWith('tmp_') === false) return
    const body = String(message.text || '').trim()
    const failed = failedFileRef.current
    const file = failed && String(failed.tempId) === String(message.id) ? failed.file : null
    const kind = failed && String(failed.tempId) === String(message.id) ? failed.kind : 'image'
    if (message.media_type && !file) {
      // Original attachment is gone (e.g. after reload) — cannot safely resend.
      if (!body || body === '📷' || body === '🎤 Voice message') {
        setError('The attachment was lost when the message failed — please attach it again.')
        saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).filter(m => String(m.id) !== String(message.id)) }))
        return
      }
    }
    // Reuse the normal send path so auth, limits, replies and server handling stay consistent.
    saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).filter(m => String(m.id) !== String(message.id)) }))
    setReplyTo(null)
    setError('')
    // A retried voice note must stay a voice note: send() reads the kind from
    // the ref, and a failed attachment no longer carries it in state.
    attachKindRef.current = kind
    setAttachKind(kind)
    void send(body, file, `chat_${String(message.id)}`)
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

  // Saving is a real download, not a link the browser might just open: a
  // signed URL is cross-origin, where the `download` attribute is ignored, so
  // fetch the bytes first and hand the browser a same-origin blob.
  const downloadPhoto = async () => {
    if (!photoViewer) return
    try {
      setNotice('Saving photo…')
      const response = await fetch(photoViewer.src)
      if (!response.ok) throw new Error('Could not download the photo')
      const blob = await response.blob()
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : blob.type.includes('heic') ? 'heic' : 'jpg'
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `harvest-photo-${photoViewer.id.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'photo'}.${ext}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 4000)
      setNotice('Photo saved to your downloads')
    } catch (e: any) {
      setError(e?.message || 'Unable to download photo')
    } finally {
      window.setTimeout(() => setNotice(''), 1800)
    }
  }

  const removeMessage = async (m: any, notice: string) => {
    const id = String(m?.id || '')
    if (!id || id.startsWith('tmp_')) return
    setActionFor(null)
    try {
      await api('/api/chat/messages/' + encodeURIComponent(id), { method: 'DELETE' })
      saveMessages(c => ({ ...c, [conversationKey]: (c[conversationKey] || []).map(x => String(x.id) === id ? { ...x, deleted_at: new Date().toISOString(), text: 'This message was deleted', media_key: null, media_type: null, reaction: null } : x) }))
      setNotice(notice)
      window.setTimeout(() => setNotice(''), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove message')
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

  // Forwarding re-sends the message content into another conversation through
  // the same POST the composer uses; the server re-authorizes the target.
  useEffect(() => {
    if (!forwardFor) return
    let live = true
    const load = async () => {
      try {
        const r = await api<{ conversations: any[]; team_conversations: any[] }>('/api/chat/conversations')
        if (!live) return
        const dm = (r.conversations || []).map(c => ({ key: `dm:${c.peer}`, kind: 'dm', peer: c.peer, name: c.peer_name || c.peer, avatar_url: c.avatar_url }))
        const team = (r.team_conversations || []).map(t => ({ key: String(t.conversation_key), kind: t.kind, slug: t.slug, name: t.name }))
        setForwardTargets([...team, ...dm])
      } catch {
        if (live) setForwardTargets([])
      }
    }
    void load()
    return () => { live = false }
  }, [forwardFor])

  const forwardMessage = async (target: any) => {
    const m = forwardFor
    if (!m || forwardBusy) return
    setForwardBusy(target.key)
    const raw = String(m.text || '')
    const placeholder = ['📷', '🎤 Voice message', '📎 Media'].includes(raw)
    const body = placeholder && m.media_type ? '' : raw
    const payload = target.kind === 'dm'
      ? { peer: target.peer }
      : target.kind === 'group' ? { group: target.slug } : { department: target.slug }
    try {
      await api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ ...payload, body, media_key: m.media_key || undefined, media_type: m.media_key ? m.media_type : undefined }),
      })
      setForwardFor(null)
      setNotice(`Forwarded to ${target.name}`)
      window.setTimeout(() => setNotice(''), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not forward this message')
    } finally {
      setForwardBusy(null)
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

  // Conversation list — one renderer serves the phone view and the desktop
  // master/detail left pane (no duplicated return branch).
  const inboxPane = (
    <>
      <header className={`sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-xl ${compact ? 'px-3 py-2.5' : 'pl-4 pr-14 pb-3 pt-4'}`}>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={onBack} className={`shrink-0 rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink ${compact ? 'grid h-8 w-8 place-items-center' : 'touch-target lg:hidden'}`} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
              <div className="min-w-0">
                {!compact && <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-accent">Harvest Family</p>}
                <h1 className={`truncate font-extrabold text-ink ${compact ? 'text-base' : 'text-xl'}`}>{chatView === 'community' ? 'Community' : 'Chats'}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {compact && onMinimize && (
                <button type="button" onClick={onMinimize} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink" aria-label="Minimise chat" title="Minimise"><Icon name="chevron-down" size={18} /></button>
              )}
              {compact && onExpand && (
                <button type="button" onClick={onExpand} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink" aria-label="Open full-screen chat" title="Open full-screen chat"><Icon name="arrow-right" size={18} /></button>
              )}
              {!compact && <button type="button" onClick={() => setTab(tab === 'people' ? 'inbox' : 'people')} className="touch-target shrink-0 rounded-full border border-line bg-surface-raised text-ink transition hover:bg-surface-sunken" aria-label={tab === 'people' ? 'Back to chats' : 'Find people'}>
                <Icon name={tab === 'people' ? 'arrow-left' : 'plus'} size={20} />
              </button>}
            </div>
          </div>
          {tab === 'inbox' && !compact && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-0.5">
              <button type="button" onClick={() => setChatView('chats')} className={`shrink-0 rounded-full px-4 py-2 text-2xs font-extrabold transition ${chatView === 'chats' ? 'bg-accent text-white shadow-card' : 'border border-line bg-surface-raised text-ink-muted hover:bg-surface-sunken'}`}>Chats{totalUnread > 0 && <UnreadBadge count={totalUnread} className="ml-1 align-middle" />}</button>
              <button type="button" onClick={() => onOpenGroups?.()} className="shrink-0 rounded-full border border-line bg-surface-raised px-4 py-2 text-2xs font-extrabold text-ink-muted transition hover:bg-surface-sunken">Groups</button>
              <button type="button" onClick={() => onOpenDepartments?.()} className="shrink-0 rounded-full border border-line bg-surface-raised px-4 py-2 text-2xs font-extrabold text-ink-muted transition hover:bg-surface-sunken">Departments</button>
              <button type="button" onClick={() => setChatView('community')} className={`shrink-0 rounded-full px-4 py-2 text-2xs font-extrabold transition ${chatView === 'community' ? 'bg-accent text-white shadow-card' : 'border border-line bg-surface-raised text-ink-muted hover:bg-surface-sunken'}`}>Community</button>
            </div>
          )}
        </div>
      </header>

      {tab === 'inbox' && chatView === 'community' ? (
        <CommunityHub
          onOpenTeam={(t) => { setError(''); setActive(null); setReplyTo(null); setReactingFor(null); setActionFor(null); setTeam(t); setChatView('chats') }}
          onOpenGroups={onOpenGroups}
          onOpenDepartments={onOpenDepartments}
        />
      ) : tab === 'inbox' ? (
        <>
          {/* Team chats: your departments + groups, always at the top of the inbox. */}
          {!compact && (
            <TeamChatsRail
              onOpen={(t) => { setError(''); setActive(null); setReplyTo(null); setReactingFor(null); setActionFor(null); setTeam(t); setChatView('chats') }}
            />
          )}
          {/* Instagram-style avatar rail — only when there is someone to show. */}
          {!compact && inbox.length > 0 && (
          <section className="border-b border-line px-4 pb-1 pt-4">
            <div className="flex gap-4 overflow-x-auto pb-3">
              {inbox.slice(0, 12).map(c => (
                <div key={`rail_${c.conversation_key}`} className="w-[68px] shrink-0 text-center">
                  {/* Avatar opens the member's profile; the name below still
                      opens the conversation. */}
                  <button
                    type="button"
                    onClick={() => onOpenUser?.({ id: c.peer_id, username: c.peer, name: c.peer_name, verified: c.peer_verified, avatar_url: c.avatar_url })}
                    className="mx-auto block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-95"
                    aria-label={`View ${c.peer_name || c.peer}'s profile`}
                  >
                    <div className={`relative mx-auto w-[62px] rounded-full p-[2.5px] ${c.unread > 0 ? 'bg-gradient-to-br from-gold to-accent' : 'border-2 border-line'}`}>
                      <div className="flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-accent-soft font-extrabold text-accent-strong">{c.avatar_url ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" /> : (c.peer?.[0] || '?').toUpperCase()}</div>
                      {presence[c.peer]?.online && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-success" />}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified, avatar_url: c.avatar_url }) }}
                    className="mt-1 block w-full truncate text-2xs text-ink-muted hover:text-ink"
                    aria-label={`Open chat with ${c.peer_name || c.peer}`}
                  >
                    {c.peer_name?.split(' ')[0] || c.peer}
                  </button>
                </div>
              ))}
            </div>
          </section>
          )}
          {/* Search + tab pill row — full Chats only. The mini card is for
              replying to one conversation, not for browsing the inbox. */}
          {!compact && <section className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5">
              <Icon name="search" size={17} className="text-ink-subtle" />
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search" className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="rounded-full bg-accent px-4 py-1.5 text-2xs font-bold text-white shadow-card">Inbox{totalUnread > 0 && <UnreadBadge count={totalUnread} className="ml-1 align-middle" />}</button>
              <button type="button" onClick={() => setTab('people')} className="rounded-full border border-line bg-surface-raised px-4 py-1.5 text-2xs font-bold text-ink-muted transition hover:bg-surface-sunken">People</button>
              <span className="ml-auto self-center text-2xs text-ink-subtle">{visibleInbox.length} chat{visibleInbox.length === 1 ? '' : 's'}</span>
            </div>
          </section>}
          <section className={`px-3 ${compact ? 'pb-3' : 'pb-7'}`}>
            {inboxLoading ? (
              <div role="status" aria-live="polite" className="mx-1 mt-4">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3.5" aria-hidden="true">
                    <div className="skeleton h-14 w-14 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1">
                      <div className="skeleton h-3.5 w-1/3 rounded-full" />
                      <div className="skeleton mt-2.5 h-3 w-2/3 rounded-full" />
                    </div>
                  </div>
                ))}
                <span className="sr-only">Loading conversations…</span>
              </div>
            ) : inboxError ? (
              <div className="mx-3 mt-6">
                <ErrorMessage
                  message={inboxError}
                  kind="network"
                  action={<button type="button" onClick={() => void refreshInbox()} className="rounded-full bg-accent px-3 py-1.5 text-2xs font-extrabold text-white">Retry</button>}
                />
              </div>
            ) : inbox.length === 0 ? (
              <div className={`mx-3 mt-4 rounded-3xl border border-line bg-surface-raised px-5 text-center ${compact ? 'py-6' : 'py-10'}`}>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true"><Icon name="chat" size={26} /></div>
                <h2 className="mt-4 text-sm font-extrabold text-ink">Your conversations</h2>
                <p className="mt-2 text-2xs leading-5 text-ink-muted">Private chats with your Harvest church family will appear here.</p>
                <button type="button" onClick={() => setTab('people')} className="mt-5 rounded-full bg-accent px-5 py-2.5 text-2xs font-extrabold text-white shadow-card">Find someone</button>
              </div>
            ) : visibleInbox.length === 0 ? (
              <div className="mx-3 mt-6 rounded-2xl border border-line bg-surface-raised p-6 text-center text-sm text-ink-muted">No conversations match “{peopleQuery}”.</div>
            ) : sortedInbox.map(c => {
              const online = Boolean(presence[c.peer]?.online)
              const unread = Number(c.unread) || 0
              const preview = c.last_text || 'Say hello'
              return (
                <div key={c.conversation_key} className={`mb-1 flex w-full items-center rounded-2xl transition ${compact ? 'gap-2.5 px-2 py-2.5' : 'gap-3 px-3 py-3.5'} ${unread > 0 ? 'bg-accent-wash' : 'hover:bg-surface-sunken'}`}>
                  <button
                    type="button"
                    onClick={() => onOpenUser?.({ id: c.peer_id, username: c.peer, name: c.peer_name, verified: c.peer_verified })}
                    className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label={`View ${c.peer_name || c.peer}'s profile`}
                  >
                    <div className={`flex items-center justify-center rounded-full font-extrabold ${compact ? 'h-11 w-11' : 'h-14 w-14'} ${unread > 0 ? 'bg-gradient-to-br from-gold to-accent p-[2px] text-white' : 'bg-accent-soft text-accent-strong'}`}>
                      <div className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full ${unread > 0 ? 'bg-surface-raised text-ink' : ''}`}>
                        {c.avatar_url
                          ? <img src={c.avatar_url} alt="" loading="lazy" className="h-full w-full rounded-full object-cover" />
                          : (c.peer?.[0] || '?').toUpperCase()}
                      </div>
                    </div>
                    {online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface bg-success" />}
                  </button>
                  <button type="button" onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified }) }} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className={`text-[15px] font-extrabold truncate ${unread > 0 ? 'text-ink' : 'text-ink'}`}>{c.peer_name}{c.peer_verified && <VerifiedBadge />}</p>
                      <span className={`ml-2 shrink-0 text-2xs font-medium ${unread > 0 ? 'text-accent-strong' : 'text-ink-subtle'}`}>{c.last_at ? chatListTime(c.last_at) : ''}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={`flex-1 truncate text-[13px] ${unread > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                        {c.last_from === currentUser ? 'You: ' : ''}{preview}
                      </p>
                      {unread > 0 && <UnreadBadge count={unread} />}
                    </div>
                  </button>
                  <button type="button" onClick={() => togglePinned(c.conversation_key)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-surface-raised ${pinnedChats.includes(c.conversation_key) ? 'text-gold-strong' : 'text-ink-subtle hover:text-gold-strong'}`} aria-label={`${pinnedChats.includes(c.conversation_key) ? 'Unpin' : 'Pin'} conversation`}><Icon name="star" size={16} strokeWidth={2} /></button>
                </div>
              )
            })}
          </section>
        </>
      ) : (
        <>
          <section className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5">
              <Icon name="search" size={17} className="text-ink-subtle" />
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search people" className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="rounded-full border border-line bg-surface-raised px-4 py-1.5 text-2xs font-bold text-ink-muted transition hover:bg-surface-sunken">Inbox</button>
              <button type="button" className="rounded-full bg-accent px-4 py-1.5 text-2xs font-bold text-white shadow-card">People</button>
              <span className="ml-auto self-center text-2xs text-ink-subtle">{usersForSection.length} member{usersForSection.length === 1 ? '' : 's'}</span>
            </div>
          </section>
          {/* Notes-style presence row */}
          <section className="border-b border-line px-4 py-4">
            <div className="flex gap-4 overflow-x-auto pb-1">
              <div className="w-[68px] shrink-0 text-center">
                <div className="mx-auto w-fit rounded-full border-2 border-dashed border-line-strong p-[2.5px]">
                  <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-accent-soft font-extrabold text-accent-strong">{(currentUser?.[0] || '?').toUpperCase()}</div>
                </div>
                <p className="mt-1 truncate text-2xs text-ink-muted">Your note</p>
              </div>
              {usersForSection.filter((u: any) => presence[u.username]?.online).slice(0, 12).map((u: any) => (
                <button key={`note_${u.username}`} type="button" onClick={() => onOpenUser?.(u)} className="w-[68px] shrink-0 rounded-xl text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label={`View ${u.name || u.username}'s profile`}>
                  <div className="rounded-full bg-gradient-to-tr from-gold to-accent p-[2.5px]">
                    <div className="flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-accent-soft font-extrabold text-accent-strong">
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : (u.username?.[0] || '?').toUpperCase()}
                    </div>
                  </div>
                  <p className="mt-1 truncate text-2xs text-ink-muted">{u.username}</p>
                </button>
              ))}
            </div>
          </section>
          <section className="pb-8">
            {usersForSection.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">No people in this section yet.</div>
            ) : usersForSection.map((u: any) => {
              const online = Boolean(presence[u.username]?.online)
              const inInbox = inbox.find(c => c.peer === u.username)
              return (
                <div key={u.username} className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-surface-sunken">
                  {/* The avatar is the profile affordance; the name area still
                      starts the conversation, matching the inbox rows. */}
                  <button type="button" onClick={() => onOpenUser?.(u)}
                    className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-95"
                    aria-label={`View ${u.name || u.username}'s profile`}>
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-extrabold text-accent-strong">
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : (u.username?.[0] || '?').toUpperCase()}
                    </div>
                    {online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface bg-success" />}
                  </button>
                  <button type="button" onClick={() => { setError(''); setActive(u) }} className="min-w-0 flex-1 text-left active:opacity-70">
                    <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink">
                      <span className="truncate">{u.name || u.username}</span>
                      {u.verified && <VerifiedBadge />}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">{online ? 'Active now' : inInbox?.last_text || 'Start a conversation'}</p>
                  </button>
                  {inInbox && inInbox.unread > 0 && <UnreadBadge count={Number(inInbox.unread)} className="h-2.5 min-w-2.5 w-2.5 border-0 bg-accent p-0" />}
                </div>
              )
            })}
          </section>
        </>
      )}
    </>
  )

  if (active || team) {
    let lastDay = ''
    let unreadDividerShown = false
    const firstUnreadIndex = thread.findIndex((m: any) => m.from !== currentUser && m.status === 'sent')
    const isTeam = Boolean(team)
    return (
      <main
        className="chat-screen flex min-h-0 w-full overflow-hidden bg-surface text-ink"
        // Fill the chat pane, never more. A raw 100dvh is taller than the pane
        // (the app column already reserves the status-bar inset), which let the
        // whole conversation scroll and pushed the header/composer off their
        // edges. maxHeight keeps the IME-tracking height inside the pane too.
        style={compact
          ? { height: '100%', maxHeight: '100%' }
          : { height: chatViewportHeight ? `${chatViewportHeight}px` : '100%', maxHeight: '100%' }}
      >
        {wide && (
          <aside className="w-[336px] shrink-0 overflow-hidden border-r border-line">
            <div className="h-full overflow-y-auto overflow-x-hidden">{inboxPane}</div>
          </aside>
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* pr-14 clears the floating notification bell that anchors to the
            top-right of the app column; without it the bell sat on the search
            control. */}
        <header className={`z-20 flex h-[68px] shrink-0 items-center gap-2 border-b border-line bg-surface/80 pl-3 backdrop-blur-xl ${compact ? 'pr-3' : 'pr-14'}`}>
          <button type="button" onClick={() => { if (isTeam) { setTeam(null); onCloseTeam?.() } else { setActive(null) } setReplyTo(null); setReactingFor(null) }} className={`touch-target shrink-0 rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink active:scale-95 ${compact ? '' : 'lg:hidden'}`} aria-label="Back"><Icon name="arrow-left" size={20} /></button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={() => { if (!isTeam) openMemberProfile(active) }}
              disabled={isTeam || !onOpenProfile}
              className={`relative h-11 w-11 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isTeam || !onOpenProfile ? '' : 'active:scale-95'}`}
              aria-label={isTeam ? undefined : `View ${active.name || active.username}'s profile`}
            >
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-accent-soft font-bold text-accent-strong">
                {isTeam
                  ? (team!.avatar_url
                      ? <img src={team!.avatar_url} alt="" className="h-full w-full object-cover" />
                      : <Icon name={team!.kind === 'department' ? 'building' : 'users'} size={20} />)
                  : active.avatar_url ? <img src={active.avatar_url} alt="" className="h-full w-full object-cover" /> : (active.username?.[0] || '?').toUpperCase()}
              </span>
              {!isTeam && presence[active.username]?.online && <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface-raised bg-success" />}
            </button>
            <button
              type="button"
              onClick={() => { if (!isTeam) openMemberProfile(active) }}
              disabled={isTeam || !onOpenProfile}
              className={`min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isTeam || !onOpenProfile ? '' : 'transition hover:bg-surface-sunken'}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 font-bold text-ink">
                <span className="truncate">{isTeam ? team!.name : active.name || active.username}</span>
                {!isTeam && active.verified && <VerifiedBadge />}
              </span>
              <span className="block truncate text-2xs text-ink-muted">{isTeam ? (team!.kind === 'group' ? 'Group conversation' : 'Department conversation') : presence[active.username]?.online ? <span className="font-semibold text-success">Active now</span> : 'Harvest church family'}</span>
            </button>
          </div>
          {isTeam && (team!.kind === 'department' ? onOpenDepartments : onOpenGroups) && (
            <button
              type="button"
              onClick={() => (team!.kind === 'department' ? onOpenDepartments?.() : onOpenGroups?.())}
              className="touch-target shrink-0 rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
              aria-label={team!.kind === 'department' ? 'Manage department' : 'Manage group'}
              title={team!.kind === 'department' ? 'Manage department' : 'Manage group'}
            >
              <Icon name="dots" size={20} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { setThreadSearchOpen(open => !open); setThreadSearch('') }}
            className="touch-target shrink-0 rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
            aria-label={threadSearchOpen ? 'Close search' : 'Search in conversation'}
            aria-pressed={threadSearchOpen}
            title="Search in conversation"
          >
            <Icon name="search" size={19} />
          </button>
          {sending ? <Spinner size={14} className="text-ink-subtle" /> : null}
          {compact && onMinimize && (
            <button type="button" onClick={onMinimize} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink" aria-label="Minimise chat" title="Minimise"><Icon name="chevron-down" size={18} /></button>
          )}
          {compact && onExpand && (
            <button type="button" onClick={onExpand} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink" aria-label="Open full-screen chat" title="Open full-screen chat"><Icon name="arrow-right" size={18} /></button>
          )}
        </header>

        {threadSearchOpen && (
          <div className="shrink-0 border-b border-line bg-surface-raised px-3 py-2">
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2">
              <Icon name="search" size={16} className="shrink-0 text-ink-subtle" />
              <input
                value={threadSearch}
                onChange={e => setThreadSearch(e.target.value)}
                placeholder="Search this conversation"
                aria-label="Search this conversation"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
              {searchNeedle && <span className="shrink-0 text-2xs font-bold text-ink-subtle">{displayThread.length} found</span>}
              <button type="button" onClick={() => { setThreadSearchOpen(false); setThreadSearch('') }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted" aria-label="Close search"><Icon name="close" size={14} /></button>
            </div>
          </div>
        )}

        <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={messagesRef}
          onScroll={syncScrollState}
          className="chat-messages h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-4"
          style={team?.chat_background_url ? {
            backgroundImage: `linear-gradient(rgb(var(--surface) / .90), rgb(var(--surface) / .95)), url("${team.chat_background_url}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          } : undefined}
        >
          {thread.length === 0 ? (
            <div className="flex min-h-full items-center justify-center py-12">
              <div className="w-full max-w-sm px-6 text-center">
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] border border-accent-soft bg-accent-wash text-accent"><Icon name="chat" size={34} /></div>
                <h2 className="mt-5 text-lg font-extrabold text-ink">{isTeam ? 'Start the team conversation' : 'Start a conversation'}</h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">Share an encouragement, prayer, or simple hello. Your conversation will appear here.</p>
              </div>
            </div>
          ) : displayThread.length === 0 ? (
            <div className="flex min-h-full items-center justify-center py-12 text-center text-sm text-ink-muted">
              No messages match “{threadSearch}”.
            </div>
          ) : displayThread.map((m: any, index: number) => {
            const mine = m.from === currentUser
            const day = dayLabel(m.created_at || m.at)
            const showDay = day !== lastDay; lastDay = day
            const isReactionOpen = reactingFor === String(m.id)
            // Run-grouping: consecutive messages from one sender inside five
            // minutes read as a single block — tight spacing, one timestamp,
            // one avatar, and the rounded "tail" only on the last bubble.
            const sameRun = (other: any) => {
              if (!other || other.from !== m.from) return false
              const a = new Date(other.created_at || other.at).getTime()
              const b = new Date(m.created_at || m.at).getTime()
              return Math.abs(b - a) < 5 * 60 * 1000
            }
            const groupStart = showDay || !sameRun(displayThread[index - 1])
            const groupEnd = !sameRun(displayThread[index + 1])
            const showMeta = groupEnd
            // Profile pictures on every incoming run — DMs included, the way
            // Instagram shows the other person beside their messages.
            const showAvatar = !mine && groupStart
            return (
              <div key={m.id}>
                {showDay && <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-line" /><span className="rounded-full border border-line bg-surface-raised px-3 py-1 text-2xs font-bold uppercase tracking-wider text-ink-subtle">{day}</span><div className="h-px flex-1 bg-line" /></div>}
                {!searchNeedle && firstUnreadIndex === index && !unreadDividerShown && !mine && (unreadDividerShown = true) && (
                  <div className="my-4 flex items-center gap-3" aria-label="Unread messages">
                    <div className="h-px flex-1 bg-accent/30" /><span className="rounded-full bg-accent-soft px-2.5 py-1 text-2xs font-extrabold uppercase tracking-wider text-accent-strong">New messages</span><div className="h-px flex-1 bg-accent/30" />
                  </div>
                )}
                {isTeam && !mine && groupStart && (
                  <button
                    type="button"
                    onClick={() => openMemberProfile({ username: m.from })}
                    className="mb-1 ml-1 rounded text-2xs font-bold text-ink-muted transition hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {m.from}
                  </button>
                )}
                <div className={`flex ${groupStart ? 'mt-3' : 'mt-[3px]'} ${mine ? 'justify-end' : 'justify-start'}`}>
                  {!mine && (
                    showAvatar
                      ? <button type="button" onClick={() => openMemberProfile({ username: m.from, avatar_url: m.avatar_url })} className="mr-1.5 mb-1 grid h-9 w-9 shrink-0 place-items-center self-end overflow-hidden rounded-full bg-accent-soft text-2xs font-bold text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label={`View ${m.from}'s profile`}>{m.avatar_url ? <img src={m.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : (m.from?.[0] || '?').toUpperCase()}</button>
                      : <div className="mr-1.5 w-9 shrink-0" aria-hidden="true" />
                  )}
                  <div className="group/msg relative max-w-[min(78%,34rem)]">
                    {m.reaction && <button type="button" onClick={() => react(m, '')} className={`absolute -bottom-3 ${mine ? 'left-2' : 'right-2'} z-10 inline-flex min-h-9 min-w-9 items-center justify-center rounded-full border border-line bg-surface-raised px-2 text-xs shadow-card`} aria-label="Remove reaction">{m.reaction}</button>}
                    <div
                      onContextMenu={e => { e.preventDefault(); setReactingFor(null); setActionFor(actionFor === String(m.id) ? null : String(m.id)) }}
                      onTouchStart={e => startSwipe(e, m)} onTouchEnd={e => endSwipe(e, m)} onTouchMove={e => moveSwipe(e, mine)}
                      style={{ transform: !mine && swipeOffset ? `translateX(${swipeOffset}px)` : undefined, transition: swipeOffset ? 'none' : 'transform 160ms ease-out' }}
                      className={`select-none rounded-[20px] px-3.5 py-2.5 text-[15px] leading-snug shadow-card ${mine
                        ? `bg-accent text-white ${groupEnd ? 'rounded-br-[6px]' : ''}`
                        : `border border-line bg-surface-raised text-ink ${groupEnd ? 'rounded-bl-[6px]' : ''}`}`}
                    >
                      {m.reply_preview && (
                        <div className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-2xs ${mine ? 'border-white/70 bg-white/15 text-white/90' : 'border-accent bg-accent-wash text-ink-muted'}`}>
                          {m.reply_preview}
                        </div>
                      )}
                      {m.media_type === 'image' && m.media_key && !String(m.id).startsWith('tmp_') && (
                        <ChatPhoto messageId={String(m.id)} onOpen={src => setPhotoViewer({ src, id: String(m.id) })} />
                      )}
                      {m.media_type === 'image' && !m.media_key && <div className="mb-1.5 grid h-28 w-40 place-items-center rounded-xl bg-surface-sunken text-ink-subtle"><Icon name="camera" size={26} /></div>}
                      {m.media_type === 'audio' && m.media_key && !String(m.id).startsWith('tmp_') && (
                        <ChatAudio messageId={String(m.id)} />
                      )}
                      {m.media_type === 'audio' && !m.media_key && <div className="mb-1 flex h-11 w-56 items-center gap-2 rounded-full bg-surface-sunken px-3 text-2xs text-ink-subtle"><Icon name="mic" size={16} /> Voice message</div>}
                      {m.text && m.text !== '📷' && m.text !== '🎤 Voice message' && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                      {(showMeta || (mine && (m.status === 'sending' || m.status === 'failed'))) && (
                      <div className={`mt-1 flex items-center justify-end gap-1 text-2xs ${mine ? 'text-white/75' : 'text-ink-subtle'}`}>
                        {showMeta && <time dateTime={m.created_at}>{m.at || new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
                        {mine && m.status === 'sending' && <span className="text-white/75">Sending…</span>}
                        {mine && m.status === 'failed' && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void retryMessage(m) }}
                            disabled={sending}
                            className="font-extrabold text-white underline underline-offset-2 disabled:opacity-50"
                            aria-label="Retry sending message"
                          >
                            Retry
                          </button>
                        )}
                        {showMeta && <Ticks status={m.status} mine={mine} />}
                      </div>
                      )}
                    </div>
                    <div className={`absolute top-1/2 z-20 hidden -translate-y-1/2 items-center gap-0.5 rounded-pill border border-line bg-surface-raised p-0.5 shadow-raised opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/msg:opacity-100 md:flex ${mine ? 'right-full mr-2' : 'left-full ml-2'}`}>
                      <button type="button" onClick={e => { e.stopPropagation(); react(m, '🙏') }} className="grid h-8 w-8 place-items-center rounded-full text-sm transition hover:bg-surface-sunken active:scale-90" aria-label="React with 🙏">🙏</button>
                      <button type="button" onClick={e => { e.stopPropagation(); react(m, '❤️') }} className="grid h-8 w-8 place-items-center rounded-full text-sm transition hover:bg-surface-sunken active:scale-90" aria-label="React with ❤️">❤️</button>
                      <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); setReactingFor(null); setReplyTo(m) }} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken" aria-label="Reply"><Icon name="reply" size={15} /></button>
                      <button type="button" onClick={e => { e.stopPropagation(); setReactingFor(null); setActionFor(String(m.id)) }} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken" aria-label="More actions"><Icon name="dots" size={15} /></button>
                    </div>
                    {(isReactionOpen || actionFor === String(m.id)) && (
                      <div className={`chat-message-actions absolute ${mine ? 'right-0' : 'left-0'} z-30 flex items-center gap-0.5 rounded-pill border border-line bg-surface-raised/95 p-1 shadow-raised backdrop-blur`}>
                        {REACTIONS.map(r => (
                          <button key={r} type="button" aria-label={`React ${r}`} onClick={e => { e.stopPropagation(); react(m, r); setActionFor(null) }} className="grid h-9 w-9 place-items-center rounded-full text-lg transition hover:bg-surface-sunken active:scale-90">{r}</button>
                        ))}
                        <span className="mx-0.5 h-6 w-px bg-line" />
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setReactingFor(null); setActionFor(null) }} className="grid h-9 w-9 place-items-center rounded-full text-accent transition hover:bg-accent-soft" aria-label="Reply"><Icon name="reply" size={17} /></button>
                        <button type="button" onClick={e => { e.stopPropagation(); void copyMessage(m) }} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken" aria-label="Copy message"><Icon name="copy" size={16} /></button>
                      </div>
                    )}
                    {actionFor === String(m.id) && (
                      <div className={`chat-message-menu absolute ${mine ? 'right-0' : 'left-0'} top-full z-30 mt-2 w-52 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface-raised p-1.5 shadow-raised`}>
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setActionFor(null) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="reply" size={16} className="text-ink-muted" /> Reply</button>
                        <button type="button" onClick={e => { e.stopPropagation(); setReactingFor(String(m.id)); setActionFor(null) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="smile" size={16} className="text-ink-muted" /> React</button>
                        <button type="button" onClick={e => { e.stopPropagation(); if (m.text) void navigator.clipboard?.writeText(String(m.text)); setNotice('Message copied'); setActionFor(null); window.setTimeout(() => setNotice(''), 1800) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="copy" size={16} className="text-ink-muted" /> Copy</button>
                        {!m.deleted_at && (
                          <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); setForwardFor(m) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="send" size={16} className="text-ink-muted" /> Forward</button>
                        )}
                        {mine && !m.deleted_at && (
                          <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); if (window.confirm('Unsend this message for everyone?')) void removeMessage(m, 'Message unsent') }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-danger transition hover:bg-danger-soft"><Icon name="trash" size={16} /> Unsend</button>
                        )}
                        {m.media_type === 'image' && m.media_key && <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); void shareMedia(m) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="share" size={16} className="text-ink-muted" /> Share photo</button>}
                        {m.media_type === 'image' && m.media_key && <button type="button" onClick={async e => { e.stopPropagation(); setActionFor(null); const url = await fetchSignedMediaUrl(String(m.id)); if (url) setPhotoViewer({ src: url, id: String(m.id) }) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-sunken"><Icon name="download" size={16} className="text-ink-muted" /> View &amp; download</button>}
                        {!mine && isTeam && canModerateChat && !m.deleted_at && <button type="button" onClick={e => { e.stopPropagation(); setActionFor(null); if (window.confirm('Remove this message for everyone?')) void moderateDelete(m) }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-danger transition hover:bg-danger-soft"><Icon name="trash" size={16} /> Remove for everyone</button>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
          {!atBottom && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-3.5 py-2 text-2xs font-bold text-ink shadow-raised transition hover:bg-surface-sunken"
            >
              <Icon name="chevron-down" size={14} strokeWidth={2.2} />
              {unseenBelow > 0 ? `${unseenBelow} new message${unseenBelow === 1 ? '' : 's'}` : 'Jump to latest'}
            </button>
          )}
        </div>

        {error ? <div className="shrink-0 px-4 py-2"><ErrorMessage message={error} /></div> : notice ? <div role="status" className="shrink-0 border-t border-line bg-gold-soft px-4 py-2 text-2xs font-semibold text-gold-strong">{notice}</div> : null}

        <div
          className="chat-composer relative z-40 shrink-0 border-t border-line bg-surface-raised/95 px-3 pt-2.5 backdrop-blur-xl"
          style={{ paddingBottom: `max(0.65rem, var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))` }}
        >
          {replyTo && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border-l-2 border-accent bg-accent-wash py-1.5 pl-3 pr-2">
              <div className="min-w-0 flex-1 text-2xs text-ink-muted">
                <p className="font-bold text-ink">Replying to {replyTo.from === currentUser ? 'yourself' : replyTo.from}</p>
                <p className="truncate">{replyTo.media_type && !replyTo.text ? 'Photo' : String(replyTo.text || '')}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-raised" aria-label="Cancel reply"><Icon name="close" size={15} /></button>
            </div>
          )}
          {attach && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-2xs text-ink-muted">
              <Icon name={attachKind === 'audio' ? 'mic' : 'camera'} size={15} />
              <span className="truncate">{attachKind === 'audio' ? 'Voice note ready' : attach.name.slice(0, 32)}</span>
              <button type="button" onClick={() => { setAttach(null); attachRef.current = null; setAttachKind('image'); attachKindRef.current = 'image'; setRecSeconds(0) }} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-muted" aria-label="Remove attachment"><Icon name="close" size={14} /></button>
            </div>
          )}
          {(() => {
            const typingRow = Object.keys(typingPeers[conversationKey] || {}).filter(u => u && u !== currentUser)
            if (!typingRow.length) return null
            const label = team
              ? `${typingRow.length === 1 ? typingRow[0] : `${typingRow.length} teammates are`} typing…`
              : `${(active?.name || active?.username || typingRow[0]).trim().split(/\s+/)[0]} is typing…`
            return (
              <div className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-2 pb-1 text-2xs text-ink-subtle" aria-live="polite">
                <span className="flex gap-0.5" aria-hidden>{[0, 1, 2].map(i => <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent/60" style={{ animation: 'harvest-typing 1.2s infinite', animationDelay: `${i * 0.18}s` }} />)}</span>
                <span>{label}</span>
              </div>
            )
          })()}
          <div className="mx-auto flex w-full min-w-0 max-w-3xl items-end gap-1.5 rounded-pill border border-line bg-surface-sunken p-1.5 transition focus-within:border-accent/50 focus-within:bg-surface-raised">
            <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-accent" title="Send a photo">
              <Icon name="camera" size={20} />
              <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0] || null; setAttach(f); attachRef.current = f; setAttachKind('image'); attachKindRef.current = 'image' }} />
            </label>
            <button
              type="button"
              onClick={() => (recording ? stopRecording(false) : void startRecording())}
              disabled={sending || Boolean(attach) || (!recording && text.trim().length > 0)}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-surface-sunken disabled:opacity-35 ${recording ? 'bg-danger-soft text-danger' : 'text-ink-muted hover:text-accent'}`}
              aria-label={recording ? 'Send voice note' : 'Record a voice note'}
              title={recording ? 'Send voice note' : 'Record a voice note'}
            >
              <Icon name={recording ? 'check' : 'mic'} size={20} />
            </button>
            {recording ? (
              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-3xl px-2 py-2 text-sm text-ink" role="status" aria-live="polite">
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
                <span className="shrink-0 font-extrabold tabular-nums">{formatSeconds(recSeconds)}</span>
                <span className="truncate text-2xs text-ink-muted">Recording…</span>
                <button type="button" onClick={() => stopRecording(true)} className="ml-auto shrink-0 rounded-full px-3 py-1.5 text-2xs font-extrabold text-danger transition hover:bg-danger-soft">Cancel</button>
              </div>
            ) : (
              <textarea aria-label="Message" value={text} maxLength={4000} onChange={e => { setText(e.target.value); sendTyping(e.target.value.trim().length > 0) }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                rows={1} placeholder={isTeam ? 'Message your team…' : 'Message…'}
                className="min-h-11 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto rounded-3xl bg-transparent px-2 py-3 text-sm text-ink outline-none placeholder:text-ink-subtle" />
            )}
            <button type="button" onClick={() => void send()} disabled={sending || recording || (!text.trim() && !attach)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white shadow-card transition hover:bg-accent-strong active:scale-95 disabled:opacity-35 disabled:shadow-none" aria-label="Send">
              {sending ? <Spinner size={16} /> : <Icon name="send" size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
        </section>

        <Dialog
          open={Boolean(forwardFor)}
          onClose={() => setForwardFor(null)}
          title="Forward to"
          description={forwardFor?.media_type === 'audio' ? 'Send this voice note to another conversation.' : forwardFor?.media_type === 'image' ? 'Send this photo to another conversation.' : 'Send this message to another conversation.'}
          size="sm"
        >
          <div className="max-h-[55vh] space-y-1 overflow-auto">
            {forwardTargets.length === 0 && (
              <p className="px-1 py-3 text-2xs text-ink-muted">No other conversations yet — start a chat from the inbox first.</p>
            )}
            {forwardTargets.map(target => (
              <button
                key={target.key}
                type="button"
                onClick={() => void forwardMessage(target)}
                disabled={Boolean(forwardBusy)}
                className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition hover:border-line hover:bg-surface-sunken disabled:opacity-50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-2xs font-extrabold text-accent-strong">
                  {target.avatar_url
                    ? <img src={target.avatar_url} alt="" className="h-full w-full object-cover" />
                    : target.name?.[0]?.toUpperCase() || '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs font-extrabold text-ink">{target.name}</span>
                  <span className="block truncate text-2xs text-ink-muted">{target.kind === 'dm' ? 'Direct message' : target.kind === 'group' ? 'Group chat' : 'Department chat'}</span>
                </span>
                {forwardBusy === target.key ? <Spinner size={14} /> : <Icon name="send" size={15} className="shrink-0 text-ink-subtle" />}
              </button>
            ))}
          </div>
        </Dialog>

        {photoViewer && (
          <div
            ref={photoViewerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
            tabIndex={-1}
            className="fixed inset-0 z-[95] flex flex-col bg-black/95 text-white outline-none"
            style={{
              paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))',
              paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5">
              <button type="button" onClick={() => setPhotoViewer(null)} className="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-bold text-white/85 active:bg-white/10" aria-label="Close photo">
                <Icon name="close" size={20} /> Close
              </button>
              <button type="button" onClick={() => void downloadPhoto()} className="flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm font-extrabold text-white active:bg-white/20" aria-label="Download photo">
                <Icon name="download" size={18} /> Download
              </button>
            </div>
            <button
              type="button"
              onClick={() => setPhotoViewer(null)}
              aria-label="Close photo"
              className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
            >
              <img src={photoViewer.src} alt="Shared photo" className="max-h-full max-w-full rounded-lg object-contain" />
            </button>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="flex h-full min-h-0 w-full overflow-hidden bg-surface text-ink">
      <div className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden overscroll-contain lg:w-[336px] lg:shrink-0 lg:border-r lg:border-line">
        {inboxPane}
      </div>
      <div className="hidden flex-1 items-center justify-center px-10 lg:flex">
        <div className="max-w-xs text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-accent-soft bg-accent-wash text-accent"><Icon name="chat" size={28} /></div>
          <h2 className="mt-5 text-lg font-extrabold text-ink">Select a conversation</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Pick a chat from the list, or start a new one with someone from your church family.</p>
        </div>
      </div>
    </main>
  )
}

function CommunityHub({ onOpenTeam, onOpenGroups, onOpenDepartments }: {
  onOpenTeam: (t: TeamChat) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
}) {
  const [teams, setTeams] = useState<TeamChat[]>([])
  const [hubError, setHubError] = useState('')
  const [hubRetry, setHubRetry] = useState(0)
  useEffect(() => {
    let live = true
    const load = async () => {
      const token = localStorage.getItem('harvest_token') || ''
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const out: TeamChat[] = []
      let failed = 0
      try {
        const r = await fetch(`${API}/api/departments`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.departments || []).filter((x: any) => x.joined || x.leader).forEach((x: any) => out.push({ kind: 'department', slug: x.slug, name: x.name }))
        } else failed++
      } catch { failed++ }
      try {
        const r = await fetch(`${API}/api/groups/mine`, { headers })
        if (r.ok) {
          const d = await r.json()
          ;(d.groups || []).forEach((x: any) => out.push({ kind: 'group', slug: x.slug, name: x.name }))
        } else failed++
      } catch { failed++ }
      if (live) {
        setTeams(out)
        // Empty is a real answer only when both lists actually loaded.
        setHubError(failed > 0 && out.length === 0 ? 'We couldn’t load your groups and departments. Check your connection and try again.' : '')
      }
    }
    void load()
    // Groups/departments can be created, joined or deleted in their own tabs —
    // reload this hub so "Your spaces" never goes stale.
    window.addEventListener('harvest:groups-changed', load)
    window.addEventListener('harvest:departments-updated', load)
    return () => {
      live = false
      window.removeEventListener('harvest:groups-changed', load)
      window.removeEventListener('harvest:departments-updated', load)
    }
  }, [hubRetry])

  return (
    <section className="min-h-[calc(100vh-150px)] bg-surface px-4 pb-10 pt-5">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[28px] border border-line bg-gradient-to-br from-accent-wash via-gold-soft to-surface-raised p-5 shadow-card">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-card"><Icon name="building" size={24} /></div>
            <div className="min-w-0">
              <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-accent">Harvest Family Community</p>
              <h2 className="mt-1 text-2xl font-extrabold text-ink">One church. One family.</h2>
              <p className="mt-2 text-sm leading-5 text-ink-muted">Stay connected through announcements, departments, groups, prayer and everyday conversations.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={onOpenGroups} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-2xs font-extrabold text-white shadow-card transition hover:bg-accent-strong"><Icon name="users" size={16} /> Explore groups</button>
            <button type="button" onClick={onOpenDepartments} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-surface-raised px-4 py-3 text-2xs font-extrabold text-ink transition hover:bg-surface-sunken"><Icon name="building" size={16} /> Departments</button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xs font-bold uppercase tracking-[0.16em] text-ink-subtle">Your spaces</p>
              <h3 className="truncate text-lg font-extrabold text-ink">Groups &amp; departments</h3>
            </div>
            <span className="shrink-0 text-2xs text-ink-subtle">{teams.length} spaces</span>
          </div>
          {hubError ? (
            <ErrorMessage
              message={hubError}
              kind="network"
              action={<button type="button" onClick={() => setHubRetry(n => n + 1)} className="rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-bold text-danger">Try again</button>}
            />
          ) : teams.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface-raised p-6 text-center text-sm text-ink-muted">Your joined groups and departments will appear here.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {teams.map(t => (
                <button type="button" key={`${t.kind}_${t.slug}`} onClick={() => onOpenTeam(t)} className="rounded-2xl border border-line bg-surface-raised p-4 text-left shadow-card transition hover:bg-surface-sunken active:scale-[.99]">
                  <div className={`grid h-11 w-11 place-items-center rounded-xl ${t.kind === 'department' ? 'bg-gold-soft text-gold-strong' : 'bg-accent-soft text-accent-strong'}`}>{t.kind === 'department' ? <Icon name="building" size={20} /> : <Icon name="users" size={20} />}</div>
                  <p className="mt-3 truncate text-sm font-extrabold text-ink">{t.name}</p>
                  <p className="mt-1 text-2xs uppercase tracking-wide text-ink-subtle">{t.kind}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-line bg-surface-raised p-4 shadow-card">
          <p className="text-2xs font-bold uppercase tracking-[0.16em] text-ink-subtle">Community feed</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-strong"><Icon name="bell" size={18} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Church announcements</p>
              <p className="truncate text-2xs text-ink-muted">Important updates from Harvest Family will appear here.</p>
            </div>
            <Icon name="chevron-right" size={16} className="shrink-0 text-ink-subtle" />
          </div>
        </div>
      </div>
    </section>
  )
}

// Team chats rail: every department + small group the viewer belongs to.
// Departments act like groups (client's request) — both get real chat rooms.
function TeamChatsRail({ onOpen }: {
  onOpen: (t: TeamChat) => void
}) {
  const [teams, setTeams] = useState<TeamChat[]>([])
  const [teamsLoaded, setTeamsLoaded] = useState(false)
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
      if (live) { setTeams(out); setTeamsLoaded(true) }
    }
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    refreshVisible()
    // D1 bills every row a poll scans. The rail only needs to notice a new
    // unread count, and realtime events already refresh it immediately, so a
    // 3 s timer multiplied into every open Chat screen was pure read waste.
    const timer = window.setInterval(refreshVisible, 20000)
    document.addEventListener('visibilitychange', refreshVisible)
    // Join/leave + create/delete in other tabs must update this rail too.
    window.addEventListener('harvest:groups-changed', refresh)
    window.addEventListener('harvest:departments-updated', refresh)
    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('harvest:groups-changed', refresh)
      window.removeEventListener('harvest:departments-updated', refresh)
    }
  }, [])
  return (
    <section className="border-b border-line px-4 pb-1 pt-4">
      <p className="mb-2 text-2xs font-bold uppercase tracking-[0.16em] text-ink-subtle">Your community</p>
      {teams.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-3">
          {teams.map(t => (
          <button type="button" key={`${t.kind}_${t.slug}`} onClick={() => onOpen(t)} className="w-[72px] shrink-0 text-center" aria-label={`Open ${t.name} chat`}>
            <div className="relative mx-auto h-[62px] w-[62px]">
              <div className={`grid h-full w-full place-items-center rounded-2xl text-white shadow-card ${t.kind === 'department' ? 'bg-gradient-to-br from-gold to-gold-strong' : 'bg-gradient-to-br from-accent to-accent-strong'}`}>{t.kind === 'department' ? <Icon name="building" size={24} /> : <Icon name="users" size={24} />}</div>
              {Number(t.unread) > 0 && <UnreadBadge count={Number(t.unread)} className="absolute -right-1.5 -top-1.5" />}
            </div>
            <p className="mt-1 truncate text-2xs font-semibold text-ink">{t.name}</p>
            <p className="text-2xs uppercase tracking-wide text-ink-subtle">{t.kind === 'department' ? 'Department' : 'Group'}</p>
          </button>
          ))}
        </div>
      )}
      {teamsLoaded && teams.length === 0 && (
        <p className="pb-3 text-2xs text-ink-muted">No groups or departments you belong to yet — browse Groups or Departments in the tabs above.</p>
      )}
    </section>
  )
}