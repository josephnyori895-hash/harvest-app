import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  if (!src) return <div className="w-56 h-40 rounded-xl bg-zinc-800 animate-pulse" />
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

export default function Chat({ onBack, users, deptChat, onCloseDept }: { onBack: () => void; users: ChatUser[]; deptChat?: { slug: string; name: string } | null; onCloseDept?: () => void }) {
  const { username: authUsername } = useAuth()
  const [tab, setTab] = useState<'inbox' | 'people'>('inbox')
  const [section, setSection] = useState<Section>('personal')
  const [active, setActive] = useState<ChatUser | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inbox, setInbox] = useState<any[]>([])
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} }
  })
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [replyTo, setReplyTo] = useState<any | null>(null)
  // Department team chat: departments work like groups (server-enforced membership).
  const [dept, setDept] = useState<{ slug: string; name: string } | null>(null)
  useEffect(() => {
    if (deptChat) { setActive(null); setDept(deptChat) } else setDept(null)
  }, [deptChat])
  const [reactingFor, setReactingFor] = useState<string | null>(null)
  const [attach, setAttach] = useState<File | null>(null)
  // Instagram-style people search on the chats list.
  const [peopleQuery, setPeopleQuery] = useState('')
  const cursorRef = useRef<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pressTimer = useRef<number | null>(null)
  const currentUser = authUsername || localStorage.getItem('harvest_username') || ''
  // Last-seen unread counts (peer → count) + currently open conversation,
  // so the background poller can detect FRESH incoming messages.
  const inboxRef = useRef<Record<string, number> | null>(null)
  const activeRef = useRef<ChatUser | null>(null)
  useEffect(() => { activeRef.current = active }, [active])

  const conversationKey = dept ? `department:${dept.slug}` : active ? keyFor(currentUser, active.username) : ''
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
    void refreshInbox(); void syncPresence()
    const t = window.setInterval(() => { void refreshInbox(); void syncPresence() }, 30000)
    return () => window.clearInterval(t)
  }, [refreshInbox, syncPresence])

  const markSeen = useCallback(async () => {
    if (dept) { try { await api('/api/chat/seen', { method: 'POST', body: JSON.stringify({ department: dept.slug }) }) } catch { /* non-fatal */ } return }
    if (!active) return
    try { await api('/api/chat/seen', { method: 'POST', body: JSON.stringify({ peer: active.username }) }) } catch { /* non-fatal */ }
  }, [active, dept])

  const loadConversation = useCallback(async () => {
    if (dept) {
      setError('')
      try {
        const result = await api<{ messages: any[]; conversation_key: string }>(`/api/chat/history?department=${encodeURIComponent(dept.slug)}`)
        const k = result.conversation_key || `department:${dept.slug}`
        saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages || []) }))
        const existing = mergeMessages(msgs[k] || [], result.messages || [])
        cursorRef.current[k] = existing[existing.length - 1]?.created_at || new Date(Date.now() - 5000).toISOString()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load team chat')
      }
      void markSeen(); void refreshInbox()
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversation')
    }
    void markSeen(); void refreshInbox()
  }, [active, dept, currentUser, conversationKey, msgs, saveMessages, markSeen, refreshInbox])

  const refreshUpdates = useCallback(async () => {
    if (!active && !dept) return
    if (!conversationKey || !localStorage.getItem('harvest_token')) return
    const after = cursorRef.current[conversationKey] || new Date(Date.now() - 5000).toISOString()
    try {
      const q = new URLSearchParams(dept ? { department: dept.slug, after, limit: '50' } : { peer: String(active?.username || ''), after, limit: '50' })
      const result = await api<{ messages: any[]; conversation_key: string; server_time: string }>(`/api/chat/updates?${q.toString()}`)
      const k = result.conversation_key || conversationKey
      if ((result.messages || []).length) {
        saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages) }))
        void markSeen()
      }
      cursorRef.current[k] = result.server_time || cursorRef.current[k]
    } catch { /* polling failures stay silent */ }
  }, [active, dept, conversationKey, saveMessages, markSeen])

  useEffect(() => {
    if (!active && !dept) return
    void loadConversation()
    const t = window.setInterval(() => void refreshUpdates(), 2500)
    return () => window.clearInterval(t)
  }, [active?.username, dept?.slug, loadConversation, refreshUpdates])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length, active?.username])

  const send = async () => {
    const body = text.trim()
    if ((!active && !dept) || !currentUser || sending || (!body && !attach)) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }
    if (!localStorage.getItem('harvest_token')) { setError('Your session has expired. Please sign in again.'); return }

    const tempId = `tmp_${Date.now()}`
    const optimistic: any = {
      id: tempId, from: currentUser, to: dept ? null : active.username,
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
        const fd = new FormData(); Object.entries(pre.fields || {}).forEach(([k, v]) => fd.append(k, String(v))); fd.append('file', attach)
        const target = /^https?:\/\//.test(pre.url) ? pre.url : `${API}${pre.url}`
        const isDirectR2 = /^https?:\/\//.test(pre.url)
        const token = localStorage.getItem('harvest_token') || ''
        const up = await fetch(target, {
          method: 'POST',
          body: fd,
          headers: isDirectR2 ? undefined : { Authorization: `Bearer ${token}` },
        })
        if (!up.ok) throw new Error('Media storage is not enabled yet — text messages still work')
        media_key = pre.key
      }
      const result = await api<{ message: any }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(dept
          ? { department: dept.slug, body, media_key, media_type: media_key ? 'image' : undefined, reply_to_id: sentReply && !String(sentReply.id).startsWith('tmp_') ? sentReply.id : undefined }
          : { peer: active.username, body, media_key, media_type: media_key ? 'image' : undefined, reply_to_id: sentReply && !String(sentReply.id).startsWith('tmp_') ? sentReply.id : undefined }),
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

  if (active || dept) {
    let lastDay = ''
    const isDept = Boolean(dept)
    return (
      <main className="h-[100dvh] bg-black text-white flex flex-col">
        <header className="h-16 shrink-0 border-b border-zinc-800 bg-black/95 backdrop-blur flex items-center gap-3 px-3 z-20">
          <button type="button" onClick={() => { if (isDept) { setDept(null); onCloseDept?.() } else { setActive(null) } setReplyTo(null); setReactingFor(null) }} className="w-10 h-10 rounded-full hover:bg-zinc-900 text-xl text-white" aria-label="Back">‹</button>
          <div className="relative w-10 h-10 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center font-bold shrink-0">
            {isDept ? '🤝' : (active.username?.[0] || '?').toUpperCase()}
            {!isDept && presence[active.username]?.online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate text-white">{isDept ? dept!.name : active.name || active.username}{!isDept && active.verified && <span className="ml-1 text-blue-400">✓</span>}</p>
            <p className="text-xs text-zinc-400">{isDept ? 'Department team chat' : presence[active.username]?.online ? <span className="text-green-400 font-semibold">Active now</span> : 'Church family'}</p>
          </div>
          {sending ? <span className="text-[10px] text-zinc-400">···</span> : null}
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {thread.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-2xl">💬</div>
              <h2 className="font-extrabold mt-4 text-white">Start the conversation</h2>
              <p className="text-sm text-zinc-400 mt-1">Send an encouragement, prayer, or simple hello.</p>
            </div>
          ) : thread.map((m: any) => {
            const mine = m.from === currentUser
            const day = dayLabel(m.created_at || m.at)
            const showDay = day !== lastDay; lastDay = day
            const isReactionOpen = reactingFor === String(m.id)
            return (
              <div key={m.id}>
                {showDay && <div className="text-center my-4"><span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-bold text-zinc-400">{day}</span></div>}
                <div className={`flex mb-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="relative max-w-[80%]">
                    {m.reaction && <button type="button" onClick={() => react(m, '')} className={`absolute -bottom-3 ${mine ? 'left-2' : 'right-2'} z-10 px-1.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 shadow text-xs`}>{m.reaction}</button>}
                    <div
                      onContextMenu={e => { e.preventDefault(); setReactingFor(isReactionOpen ? null : String(m.id)) }}
                      onTouchStart={() => startPress(m)} onTouchEnd={cancelPress} onTouchMove={cancelPress}
                      onClick={() => setReactingFor(isReactionOpen ? null : String(m.id))}
                      className={`px-3.5 py-2.5 rounded-3xl text-[15px] leading-snug cursor-pointer select-none ${mine ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white rounded-br-md' : 'bg-zinc-800 text-zinc-100 rounded-bl-md'}`}
                    >
                      {m.reply_preview && (
                        <div className={`mb-1.5 pl-2 border-l-2 rounded px-2 py-1 text-xs ${mine ? 'border-white/60 bg-white/10 text-white/85' : 'border-blue-400 bg-zinc-700/60 text-zinc-200'}`}>
                          {m.reply_preview}
                        </div>
                      )}
                      {m.media_type === 'image' && m.media_key && !String(m.id).startsWith('tmp_') && (
                        <ChatPhoto messageId={String(m.id)} />
                      )}
                      {m.media_type === 'image' && !m.media_key && <div className="text-3xl mb-1">📷</div>}
                      {m.text && m.text !== '📷' && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                      <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${mine ? 'text-white/75' : 'text-zinc-400'}`}>
                        {m.at || new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        <Ticks status={m.status} mine={mine} />
                      </div>
                    </div>
                    {isReactionOpen && (
                      <div className={`absolute -top-11 ${mine ? 'right-0' : 'left-0'} z-20 flex gap-1 bg-zinc-800 border border-zinc-700 shadow-lg rounded-full px-2 py-1.5`}>
                        {REACTIONS.map(r => (
                          <button key={r} type="button" onClick={e => { e.stopPropagation(); react(m, r) }} className="text-xl hover:scale-125 transition-transform">{r}</button>
                        ))}
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setReactingFor(null) }} className="text-xs font-bold px-1 text-blue-400" title="Reply">↩</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {(notice || error) && <div className={`px-4 py-2 text-xs shrink-0 ${error ? 'bg-red-950 text-red-300' : 'bg-zinc-900 text-amber-300'}`}>{error || notice}</div>}

        <div className="border-t border-zinc-800 bg-black px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
          {replyTo && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 pl-3 border-l-4 border-blue-400 bg-zinc-900 rounded-r-xl py-1.5 pr-2">
              <div className="min-w-0 flex-1 text-xs text-zinc-300">
                <p className="font-bold">Replying to {replyTo.from === currentUser ? 'yourself' : replyTo.from}</p>
                <p className="truncate">{replyTo.media_type && !replyTo.text ? '📷 Photo' : String(replyTo.text || '')}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-sm" aria-label="Cancel reply">✕</button>
            </div>
          )}
          {attach && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
              <span>🖼 {attach.name.slice(0, 32)}</span>
              <button type="button" onClick={() => setAttach(null)} className="ml-auto text-zinc-400" aria-label="Remove attachment">✕</button>
            </div>
          )}
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <label className="w-11 h-11 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center text-xl cursor-pointer shrink-0" title="Send a photo">
              📷
              <input type="file" accept="image/*" className="hidden" onChange={e => setAttach(e.target.files?.[0] || null)} />
            </label>
            <textarea aria-label="Message" value={text} maxLength={4000} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              rows={1} placeholder="Message…"
              className="flex-1 resize-none min-h-11 max-h-28 bg-zinc-900 border border-zinc-700 rounded-3xl px-4 py-3 text-sm text-white outline-none focus:border-zinc-500 placeholder:text-zinc-500" />
            <button type="button" onClick={() => void send()} disabled={sending || (!text.trim() && !attach)}
              className="h-11 w-11 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 text-white text-lg font-bold disabled:opacity-40 shrink-0" aria-label="Send">
              {sending ? '…' : '➤'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-black text-white">
      <header className="px-4 pt-5 pb-3 bg-black border-b border-zinc-800 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button type="button" onClick={onBack} className="w-10 h-10 rounded-full hover:bg-zinc-900 text-xl text-white" aria-label="Back">‹</button>
          <h1 className="text-xl font-extrabold text-white">Chats</h1>
          <span className="w-10" />
        </div>
      </header>

      {tab === 'inbox' ? (
        <>
          {/* Instagram-style avatar rail */}
          <section className="px-4 pt-4 pb-1 border-b border-zinc-800">
            <div className="flex gap-4 overflow-x-auto pb-3">
              {inbox.slice(0, 12).map(c => (
                <button type="button" key={`rail_${c.conversation_key}`} onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified }) }} className="shrink-0 w-[68px] text-center" aria-label={`Open chat with ${c.peer_name}`}>
                  <div className="relative p-[2.5px] rounded-full" style={{ background: c.unread > 0 ? 'linear-gradient(45deg,#f59e0b,#ec4899,#7c3aed)' : 'transparent', border: c.unread > 0 ? 'none' : '2px solid #3f3f46' }}>
                    <div className="w-[58px] h-[58px] rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center font-extrabold text-lg text-zinc-300">{(c.peer?.[0] || '?').toUpperCase()}</div>
                    {presence[c.peer]?.online && <span className="absolute right-0.5 bottom-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 truncate">{c.peer_name?.split(' ')[0] || c.peer}</p>
                </button>
              ))}
            </div>
          </section>
          {/* Search + tab pill row */}
          <section className="px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 bg-zinc-900 rounded-xl px-3 py-2.5">
              <span className="text-zinc-500">⌕</span>
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-zinc-500" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-white text-black">Inbox{inbox.some(c => c.unread > 0) ? ` (${inbox.reduce((a, c) => a + (Number(c.unread) || 0), 0)})` : ''}</button>
              <button type="button" onClick={() => setTab('people')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-zinc-900 text-zinc-300 border border-zinc-700">Requests</button>
              <span className="ml-auto text-xs text-zinc-500 self-center">{inbox.length} chat{inbox.length === 1 ? '' : 's'}</span>
            </div>
          </section>
          <section className="pb-6">
            {inbox.length === 0 ? (
              <div className="text-center py-14 text-sm text-zinc-400">No conversations yet — open <button type="button" className="font-bold text-blue-400" onClick={() => setTab('people')}>Requests</button> to say hello.</div>
            ) : inbox.map(c => {
              const online = Boolean(presence[c.peer]?.online)
              const preview = c.last_text || 'Say hello'
              return (
                <button type="button" key={c.conversation_key} onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified }) }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/60 active:bg-zinc-900 transition">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center font-extrabold text-zinc-300">{(c.peer?.[0] || '?').toUpperCase()}</div>
                    {online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[15px] text-white truncate">{c.peer_name}{c.peer_verified && <span className="ml-1 text-blue-400">✓</span>}</p>
                    <p className={`text-[13px] truncate mt-0.5 ${c.unread > 0 ? 'text-white font-medium' : 'text-zinc-400'}`}>
                      {c.last_from === currentUser ? 'You: ' : ''}{preview} · {c.last_at ? chatListTime(c.last_at) : ''}
                    </p>
                  </div>
                  {c.unread > 0 && <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" aria-label={`${c.unread} unread`} />}
                </button>
              )
            })}
          </section>
        </>
      ) : (
        <>
          <section className="px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 bg-zinc-900 rounded-xl px-3 py-2.5">
              <span className="text-zinc-500">⌕</span>
              <input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder="Search people" className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-zinc-500" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setTab('inbox')} className="px-4 py-1.5 rounded-full text-xs font-bold bg-zinc-900 text-zinc-300 border border-zinc-700">Inbox</button>
              <button type="button" className="px-4 py-1.5 rounded-full text-xs font-bold bg-white text-black">People</button>
              <span className="ml-auto text-xs text-zinc-500 self-center">{usersForSection.length} member{usersForSection.length === 1 ? '' : 's'}</span>
            </div>
          </section>
          {/* Notes-style presence row */}
          <section className="px-4 py-4 border-b border-zinc-800">
            <div className="flex gap-4 overflow-x-auto pb-1">
              <div className="shrink-0 w-[68px] text-center">
                <div className="p-[2.5px] rounded-full border-2 border-dashed border-zinc-600 w-fit mx-auto">
                  <div className="w-[58px] h-[58px] rounded-full bg-zinc-800 flex items-center justify-center font-extrabold text-lg text-zinc-300">{(currentUser?.[0] || '?').toUpperCase()}</div>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 truncate">Your note</p>
              </div>
              {usersForSection.filter((u: any) => presence[u.username]?.online).slice(0, 12).map((u: any) => (
                <div key={`note_${u.username}`} className="shrink-0 w-[68px] text-center">
                  <div className="p-[2.5px] rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                    <div className="w-[58px] h-[58px] rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center font-extrabold text-lg text-zinc-300">{(u.username?.[0] || '?').toUpperCase()}</div>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1 truncate">{u.username}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="pb-8">
            {usersForSection.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-400">No people in this section yet.</div>
            ) : usersForSection.map((u: any) => {
              const online = Boolean(presence[u.username]?.online)
              const inInbox = inbox.find(c => c.peer === u.username)
              return (
                <button type="button" key={u.username} onClick={() => { setError(''); setActive(u) }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900/60 active:bg-zinc-900 transition">
                  <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center font-extrabold text-zinc-300">{(u.username?.[0] || '?').toUpperCase()}</div>
                    {online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[15px] text-white">{u.name || u.username}{u.verified && <span className="ml-1 text-blue-400">✓</span>}</p>
                    <p className="text-[13px] text-zinc-400 truncate mt-0.5">{online ? 'Active now' : inInbox?.last_text || 'Start a conversation'}</p>
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
