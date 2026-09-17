import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'

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
  if (!src) return <div className="w-56 h-40 rounded-xl bg-[#F5EEDF] animate-pulse" />
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

export default function Chat({ onBack, users }: { onBack: () => void; users: ChatUser[] }) {
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
  const [reactingFor, setReactingFor] = useState<string | null>(null)
  const [attach, setAttach] = useState<File | null>(null)
  const cursorRef = useRef<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const pressTimer = useRef<number | null>(null)
  const currentUser = authUsername || localStorage.getItem('harvest_username') || ''

  const conversationKey = active ? keyFor(currentUser, active.username) : ''
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
      setInbox(r.conversations || [])
    } catch { /* keep last inbox */ }
  }, [])

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
    void refreshInbox(); void syncPresence()
    const t = window.setInterval(() => { void refreshInbox(); void syncPresence() }, 30000)
    return () => window.clearInterval(t)
  }, [refreshInbox, syncPresence])

  const markSeen = useCallback(async () => {
    if (!active) return
    try { await api('/api/chat/seen', { method: 'POST', body: JSON.stringify({ peer: active.username }) }) } catch { /* non-fatal */ }
  }, [active])

  const loadConversation = useCallback(async () => {
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
  }, [active, currentUser, conversationKey, msgs, saveMessages, markSeen, refreshInbox])

  const refreshUpdates = useCallback(async () => {
    if (!active || !conversationKey || !localStorage.getItem('harvest_token')) return
    const after = cursorRef.current[conversationKey] || new Date(Date.now() - 5000).toISOString()
    try {
      const q = new URLSearchParams({ peer: active.username, after, limit: '50' })
      const result = await api<{ messages: any[]; conversation_key: string; server_time: string }>(`/api/chat/updates?${q.toString()}`)
      const k = result.conversation_key || conversationKey
      if ((result.messages || []).length) {
        saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages) }))
        void markSeen()
      }
      cursorRef.current[k] = result.server_time || cursorRef.current[k]
    } catch { /* polling failures stay silent */ }
  }, [active, conversationKey, saveMessages, markSeen])

  useEffect(() => {
    if (!active) return
    void loadConversation()
    const t = window.setInterval(() => void refreshUpdates(), 2500)
    return () => window.clearInterval(t)
  }, [active?.username, loadConversation, refreshUpdates])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread.length, active?.username])

  const send = async () => {
    const body = text.trim()
    if (!active || !currentUser || sending || (!body && !attach)) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }
    if (!localStorage.getItem('harvest_token')) { setError('Your session has expired. Please sign in again.'); return }

    const tempId = `tmp_${Date.now()}`
    const optimistic: any = {
      id: tempId, from: currentUser, to: active.username,
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
        body: JSON.stringify({ peer: active.username, body, media_key, media_type: media_key ? 'image' : undefined, reply_to_id: sentReply && !String(sentReply.id).startsWith('tmp_') ? sentReply.id : undefined }),
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
    if (section === 'groups') {
      const mine = users.find((u: any) => u.username === currentUser)
      return mine?.group ? list.filter((u: any) => u.group === mine.group) : list
    }
    if (section === 'ministry') return list.filter((u: any) => u.ministry || u.verified || /worship|pastor|ministry/i.test(`${u.name || ''} ${u.username || ''}`)).slice(0, 12)
    if (section === 'prayer') return list.filter((u: any) => u.verified).slice(0, 12)
    return list.slice(0, 12)
  }, [users, currentUser, section])

  if (active) {
    let lastDay = ''
    return (
      <main className="h-[100dvh] bg-[#FFFBF0] text-[#29251F] flex flex-col">
        <header className="h-16 shrink-0 border-b border-[#E8DEC9] bg-white/95 backdrop-blur flex items-center gap-3 px-3 z-20">
          <button type="button" onClick={() => { setActive(null); setReplyTo(null); setReactingFor(null) }} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
          <div className="relative w-10 h-10 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-bold shrink-0">
            {(active.username?.[0] || '?').toUpperCase()}
            {presence[active.username]?.online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[#15803D] border-2 border-white" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{active.name || active.username}{active.verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p>
            <p className="text-xs text-[#766E63]">{presence[active.username]?.online ? <span className="text-[#15803D] font-semibold">Active now</span> : 'Church family'}</p>
          </div>
          {syncing || sending ? <span className="text-[10px] text-[#766E63]">···</span> : null}
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {thread.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-white border border-[#E8DEC9] flex items-center justify-center text-2xl">💬</div>
              <h2 className="font-extrabold mt-4">Start the conversation</h2>
              <p className="text-sm text-[#766E63] mt-1">Send an encouragement, prayer, or simple hello.</p>
            </div>
          ) : thread.map((m: any) => {
            const mine = m.from === currentUser
            const day = dayLabel(m.created_at || m.at)
            const showDay = day !== lastDay; lastDay = day
            const isReactionOpen = reactingFor === String(m.id)
            return (
              <div key={m.id}>
                {showDay && <div className="text-center my-4"><span className="px-3 py-1 rounded-full bg-white border border-[#E8DEC9] text-[11px] font-bold text-[#766E63]">{day}</span></div>}
                <div className={`flex mb-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className="relative max-w-[80%]">
                    {m.reaction && <button type="button" onClick={() => react(m, '')} className={`absolute -bottom-3 ${mine ? 'left-2' : 'right-2'} z-10 px-1.5 py-0.5 rounded-full bg-white border border-[#E8DEC9] shadow text-xs`}>{m.reaction}</button>}
                    <div
                      onContextMenu={e => { e.preventDefault(); setReactingFor(isReactionOpen ? null : String(m.id)) }}
                      onTouchStart={() => startPress(m)} onTouchEnd={cancelPress} onTouchMove={cancelPress}
                      onClick={() => setReactingFor(isReactionOpen ? null : String(m.id))}
                      className={`px-3.5 py-2.5 rounded-2xl text-[15px] leading-snug shadow-sm cursor-pointer select-none ${mine ? 'bg-[#7C3AED] text-white rounded-br-md' : 'bg-white border border-[#E8DEC9] rounded-bl-md'}`}
                    >
                      {m.reply_preview && (
                        <div className={`mb-1.5 pl-2 border-l-2 rounded px-2 py-1 text-xs ${mine ? 'border-white/60 bg-white/10 text-white/85' : 'border-[#7C3AED] bg-[#F3E8FF]/60 text-[#5B21B6]'}`}>
                          {m.reply_preview}
                        </div>
                      )}
                      {m.media_type === 'image' && m.media_key && !String(m.id).startsWith('tmp_') && (
                        <ChatPhoto messageId={String(m.id)} />
                      )}
                      {m.media_type === 'image' && !m.media_key && <div className="text-3xl mb-1">📷</div>}
                      {m.text && m.text !== '📷' && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                      <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${mine ? 'text-white/70' : 'text-[#8A8176]'}`}>
                        {m.at || new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        <Ticks status={m.status} mine={mine} />
                      </div>
                    </div>
                    {isReactionOpen && (
                      <div className={`absolute -top-11 ${mine ? 'right-0' : 'left-0'} z-20 flex gap-1 bg-white border border-[#E8DEC9] shadow-lg rounded-full px-2 py-1.5`}>
                        {REACTIONS.map(r => (
                          <button key={r} type="button" onClick={e => { e.stopPropagation(); react(m, r) }} className="text-xl hover:scale-125 transition-transform">{r}</button>
                        ))}
                        <button type="button" onClick={e => { e.stopPropagation(); setReplyTo(m); setReactingFor(null) }} className="text-xs font-bold px-1 text-[#7C3AED]" title="Reply">↩</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {(notice || error) && <div className={`px-4 py-2 text-xs shrink-0 ${error ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{error || notice}</div>}

        <div className="border-t border-[#E8DEC9] bg-white px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
          {replyTo && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 pl-3 border-l-4 border-[#7C3AED] bg-[#F3E8FF]/50 rounded-r-xl py-1.5 pr-2">
              <div className="min-w-0 flex-1 text-xs text-[#5B21B6]">
                <p className="font-bold">Replying to {replyTo.from === currentUser ? 'yourself' : replyTo.from}</p>
                <p className="truncate">{replyTo.media_type && !replyTo.text ? '📷 Photo' : String(replyTo.text || '')}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="w-7 h-7 rounded-full bg-white border border-[#E8DEC9] text-sm" aria-label="Cancel reply">✕</button>
            </div>
          )}
          {attach && (
            <div className="max-w-3xl mx-auto flex items-center gap-2 mb-2 text-xs bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-2">
              <span>🖼 {attach.name.slice(0, 32)}</span>
              <button type="button" onClick={() => setAttach(null)} className="ml-auto text-[#766E63]" aria-label="Remove attachment">✕</button>
            </div>
          )}
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <label className="w-11 h-11 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center text-xl cursor-pointer shrink-0" title="Send a photo">
              📷
              <input type="file" accept="image/*" className="hidden" onChange={e => setAttach(e.target.files?.[0] || null)} />
            </label>
            <textarea aria-label="Message" value={text} maxLength={4000} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              rows={1} placeholder="Message…"
              className="flex-1 resize-none min-h-11 max-h-28 bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
            <button type="button" onClick={() => void send()} disabled={sending || (!text.trim() && !attach)}
              className="h-11 w-11 rounded-full bg-[#7C3AED] text-white text-lg font-bold disabled:opacity-40 shrink-0" aria-label="Send">
              {sending ? '…' : '➤'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F]">
      <header className="px-4 pt-5 pb-3 bg-white border-b border-[#E8DEC9] sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button type="button" onClick={onBack} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p>
            <h1 className="text-2xl font-extrabold">Chats</h1>
          </div>
        </div>
        <div className="max-w-3xl mx-auto mt-3 flex rounded-full bg-[#F5EEDF] p-1 text-sm font-bold">
          {(['inbox', 'people'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 py-2 rounded-full capitalize ${tab === t ? 'bg-white shadow text-[#7C3AED]' : 'text-[#766E63]'}`}>
              {t === 'inbox' ? `Inbox${inbox.some(c => c.unread > 0) ? ' ●' : ''}` : 'People'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'inbox' ? (
        <section className="max-w-3xl mx-auto px-4 py-4">
          {inbox.length === 0 ? (
            <div className="text-center py-14 text-sm text-[#766E63]">No conversations yet — open <button type="button" className="font-bold text-[#7C3AED]" onClick={() => setTab('people')}>People</button> to say hello.</div>
          ) : inbox.map(c => {
            const online = Boolean(presence[c.peer]?.online)
            return (
              <button type="button" key={c.conversation_key} onClick={() => { setError(''); setActive({ username: c.peer, name: c.peer_name, verified: c.peer_verified }) }}
                className="w-full flex items-center gap-3 p-3.5 text-left border-b last:border-0 border-[#F0E9DD] hover:bg-white transition">
                <div className="relative w-13 h-13 p-[2px] rounded-2xl bg-gradient-to-br from-[#F59E0B] via-[#EC4899] to-[#7C3AED] shrink-0">
                  <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center font-extrabold text-[#7C3AED]">{(c.peer?.[0] || '?').toUpperCase()}</div>
                  {online && <span className="absolute right-0 bottom-0 w-3.5 h-3.5 rounded-full bg-[#15803D] border-2 border-[#FFFBF0]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{c.peer_name}{c.peer_verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p>
                  <p className={`text-xs truncate mt-0.5 ${c.unread > 0 ? 'font-semibold text-[#29251F]' : 'text-[#766E63]'}`}>
                    {c.last_from === currentUser ? 'You: ' : ''}{c.last_text || 'Say hello'}
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-[10px] text-[#9A9186]">{c.last_at ? new Date(c.last_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
                  {c.unread > 0 && <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-[#7C3AED] text-white text-[11px] font-bold">{c.unread}</span>}
                </div>
              </button>
            )
          })}
        </section>
      ) : (
        <>
          <section className="max-w-3xl mx-auto px-4 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(sectionMeta) as Section[]).map(key => (
                <button type="button" key={key} onClick={() => setSection(key)}
                  className={`text-left p-3 rounded-2xl border transition ${section === key ? 'bg-[#F3E8FF] border-[#C4B5FD]' : 'bg-white border-[#E8DEC9]'}`}>
                  <span className="text-xl">{sectionMeta[key].icon}</span>
                  <p className="font-bold text-sm mt-1.5">{sectionMeta[key].label}</p>
                </button>
              ))}
            </div>
          </section>
          <section className="max-w-3xl mx-auto px-4 pb-8">
            <div className="bg-white rounded-3xl border border-[#E8DEC9] overflow-hidden shadow-sm">
              {usersForSection.length === 0 ? (
                <div className="p-10 text-center text-sm text-[#766E63]">No people in this section yet.</div>
              ) : usersForSection.map((u: any) => {
                const online = Boolean(presence[u.username]?.online)
                const inInbox = inbox.find(c => c.peer === u.username)
                return (
                  <button type="button" key={u.username} onClick={() => { setError(''); setActive(u) }}
                    className="w-full flex items-center gap-3 p-3.5 text-left border-b last:border-0 border-[#F0E9DD] hover:bg-[#FFFBF0] transition">
                    <div className="relative w-12 h-12 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-extrabold shrink-0">
                      {(u.username?.[0] || '?').toUpperCase()}
                      {online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[#15803D] border-2 border-white" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm">{u.name || u.username}{u.verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p>
                      <p className="text-xs text-[#766E63] truncate mt-0.5">{inInbox?.last_text || 'Start a conversation'}</p>
                    </div>
                    {inInbox && inInbox.unread > 0 && <span className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#7C3AED] text-white text-[11px] font-bold">{inInbox.unread}</span>}
                    <span className="text-[#7C3AED]" aria-hidden="true">›</span>
                  </button>
                )
              })}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
