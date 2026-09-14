import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../state/auth'

type Section = 'prayer' | 'personal' | 'groups' | 'ministry'
type ChatUser = any
type Presence = { online: boolean; lastSeen: string }

const API = import.meta.env.VITE_API_URL || ''
const sectionMeta: Record<Section, { label: string; icon: string; description: string }> = {
  prayer: { label: 'Prayer', icon: '🙏', description: 'Pray with and encourage one another' },
  personal: { label: 'Personal', icon: '💬', description: 'Private conversations with your church family' },
  groups: { label: 'Groups', icon: '👥', description: 'Chat with people in your Harvest group' },
  ministry: { label: 'Ministry', icon: '⛪', description: 'Connect with worship and ministry members' },
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
  const byId = new Map(current.map(message => [String(message.id), message]))
  incoming.forEach(message => byId.set(String(message.id), message))
  return [...byId.values()].sort((a, b) => new Date(a.created_at || a.at).getTime() - new Date(b.created_at || b.at).getTime())
}

export default function Chat({ onBack, users }: { onBack: () => void; users: ChatUser[] }) {
  const { username: authUsername } = useAuth()
  const [section, setSection] = useState<Section>('personal')
  const [active, setActive] = useState<ChatUser | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} }
  })
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const cursorRef = useRef<Record<string, string>>({})
  const currentUser = authUsername || localStorage.getItem('harvest_username') || ''

  const conversationKey = active ? keyFor(currentUser, active.username) : ''
  const thread = conversationKey ? (msgs[conversationKey] || []) : []

  const saveMessages = useCallback((updater: Record<string, any[]> | ((current: Record<string, any[]>) => Record<string, any[]>)) => {
    setMsgs(current => {
      const next = typeof updater === 'function' ? updater(current) : updater
      localStorage.setItem('harvest_msgs', JSON.stringify(next))
      return next
    })
  }, [])

  const syncPresence = useCallback(async () => {
    if (!localStorage.getItem('harvest_token')) return
    try {
      await api('/api/presence/heartbeat', { method: 'POST', body: '{}' })
      const result = await api<{ users: Array<{ username: string; online: boolean; last_seen?: string }> }>('/api/presence')
      const next: Record<string, Presence> = {}
      result.users.forEach(user => { next[user.username] = { online: Boolean(user.online), lastSeen: user.last_seen || '' } })
      setPresence(next)
    } catch {
      // Preserve the last known presence during a transient network failure.
    }
  }, [])

  useEffect(() => {
    void syncPresence()
    const timer = window.setInterval(() => void syncPresence(), 30000)
    return () => window.clearInterval(timer)
  }, [syncPresence, currentUser])

  const loadConversation = useCallback(async () => {
    if (!active || !currentUser) return
    setError('')
    setSyncing(true)
    try {
      const result = await api<{ messages: any[]; conversation_key: string }>(`/api/chat/history?peer=${encodeURIComponent(active.username)}`)
      const k = result.conversation_key || conversationKey
      saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages || []) }))
      const existing = mergeMessages(msgs[k] || [], result.messages || [])
      const latest = existing[existing.length - 1]
      cursorRef.current[k] = latest?.created_at || new Date(Date.now() - 5000).toISOString()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversation')
    } finally {
      setSyncing(false)
    }
  }, [active, currentUser, conversationKey, msgs, saveMessages])

  const refreshUpdates = useCallback(async () => {
    if (!active || !currentUser || !conversationKey || !localStorage.getItem('harvest_token')) return
    const after = cursorRef.current[conversationKey] || new Date(Date.now() - 5000).toISOString()
    try {
      const query = new URLSearchParams({ peer: active.username, after, limit: '50' })
      const result = await api<{ messages: any[]; conversation_key: string; server_time: string }>(`/api/chat/updates?${query.toString()}`)
      const k = result.conversation_key || conversationKey
      if ((result.messages || []).length) saveMessages(current => ({ ...current, [k]: mergeMessages(current[k] || [], result.messages) }))
      cursorRef.current[k] = result.server_time || cursorRef.current[k]
    } catch {
      // Polling failures should not interrupt typing or the open conversation.
    }
  }, [active, currentUser, conversationKey, saveMessages])

  useEffect(() => {
    if (!active) return
    void loadConversation()
    const timer = window.setInterval(() => void refreshUpdates(), 2500)
    return () => window.clearInterval(timer)
  }, [active?.username, currentUser, loadConversation, refreshUpdates])

  const send = async () => {
    const body = text.trim()
    if (!active || !currentUser || !body || sending) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }
    if (!localStorage.getItem('harvest_token')) { setError('Your session has expired. Please sign in again.'); return }

    const tempId = `tmp_${Date.now()}`
    const optimistic = {
      id: tempId,
      from: currentUser,
      to: active.username,
      text: body,
      status: 'sent',
      created_at: new Date().toISOString(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    saveMessages(current => ({ ...current, [conversationKey]: [...(current[conversationKey] || []), optimistic] }))
    setText('')
    setSending(true)
    setError('')

    try {
      const result = await api<{ message: any }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ peer: active.username, body }),
      })
      saveMessages(current => ({
        ...current,
        [conversationKey]: mergeMessages((current[conversationKey] || []).filter(message => String(message.id) !== tempId), [result.message]),
      }))
      cursorRef.current[conversationKey] = result.message.created_at || cursorRef.current[conversationKey]
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message could not be sent')
      saveMessages(current => ({ ...current, [conversationKey]: (current[conversationKey] || []).filter(message => String(message.id) !== tempId) }))
      setText(body)
    } finally {
      setSending(false)
    }
  }

  const usersForSection = useMemo(() => {
    const list = users.filter((u: any) => u.username && u.username !== currentUser)
    if (section === 'groups') {
      const mine = users.find((u: any) => u.username === currentUser)
      return mine?.group ? list.filter((u: any) => u.group === mine.group) : list
    }
    if (section === 'ministry') return list.filter((u: any) => u.ministry || u.verified || /worship|pastor|ministry/i.test(`${u.name || ''} ${u.username || ''}`)).slice(0, 12)
    return list.slice(0, 12)
  }, [users, currentUser, section])

  const lastMessage = (user: ChatUser) => {
    const list = msgs[keyFor(currentUser, user.username)] || []
    return list[list.length - 1]
  }

  if (active) {
    return (
      <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F] flex flex-col">
        <header className="h-16 shrink-0 border-b border-[#E8DEC9] bg-white/95 backdrop-blur flex items-center gap-3 px-4 sticky top-0 z-20">
          <button type="button" onClick={() => { setActive(null); setError('') }} className="touch-target w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back to conversations">‹</button>
          <div className="w-10 h-10 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-bold">{(active.username?.[0] || '?').toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{active.name || active.username}</p>
            <p className="text-xs text-[#766E63]">{presence[active.username]?.online ? 'Active now' : 'Church family'}</p>
          </div>
          {syncing && <span className="text-[10px] text-[#766E63]">Syncing…</span>}
        </header>

        <div className="flex-1 overflow-auto px-4 py-6 max-w-3xl w-full mx-auto">
          <div className="text-center mb-6"><span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F3E8FF] text-[#5B21B6] text-xs font-bold">{sectionMeta[section].icon} {sectionMeta[section].label}</span><p className="text-xs text-[#766E63] mt-2">Messages sync automatically while this conversation is open.</p></div>
          {error && <div role="alert" className="mb-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
          {thread.length === 0 ? (
            <div className="text-center py-16"><div className="w-16 h-16 mx-auto rounded-3xl bg-white border border-[#E8DEC9] flex items-center justify-center text-2xl">{sectionMeta[section].icon}</div><h2 className="font-extrabold mt-4">Start the conversation</h2><p className="text-sm text-[#766E63] mt-1">Send an encouragement, prayer, or simple hello.</p></div>
          ) : thread.map((message: any) => (
            <div key={message.id} className={`flex mb-3 ${message.from === currentUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm shadow-sm ${message.from === currentUser ? 'bg-[#7C3AED] text-white rounded-br-md' : 'bg-white border border-[#E8DEC9] rounded-bl-md'}`}>
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
                <div className={`text-[10px] mt-1.5 flex justify-end gap-1 ${message.from === currentUser ? 'text-white/70' : 'text-[#8A8176]'}`}>{message.at || new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{message.from === currentUser && <span>{message.status === 'seen' || message.status === 'delivered' ? '✓✓' : '✓'}</span>}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#E8DEC9] bg-white px-3 py-3 shrink-0"><div className="max-w-3xl mx-auto flex items-end gap-2"><textarea aria-label="Message" value={text} maxLength={4000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={1} placeholder={section === 'prayer' ? 'Share a prayer or encouragement…' : 'Write a message…'} className="flex-1 resize-none min-h-11 max-h-28 bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" /><button type="button" onClick={() => void send()} disabled={!text.trim() || sending} className="touch-target h-11 px-4 rounded-2xl bg-[#7C3AED] text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed">{sending ? 'Sending…' : 'Send'}</button></div><p className="max-w-3xl mx-auto text-[10px] text-[#9A9186] mt-1 text-right">{text.length}/4000</p></div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F]">
      <header className="px-4 pt-5 pb-4 bg-white border-b border-[#E8DEC9]"><div className="max-w-6xl mx-auto flex items-center gap-3"><button type="button" onClick={onBack} className="touch-target w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back to home">‹</button><div><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="text-2xl font-extrabold">Conversations</h1></div></div></header>
      <section className="max-w-6xl mx-auto px-4 py-5"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{(Object.keys(sectionMeta) as Section[]).map(key => <button type="button" key={key} onClick={() => setSection(key)} className={`text-left p-4 rounded-3xl border transition min-h-[116px] ${section === key ? 'bg-[#F3E8FF] border-[#C4B5FD] shadow-sm' : 'bg-white border-[#E8DEC9] hover:border-[#C4B5FD]'}`}><span className="text-2xl">{sectionMeta[key].icon}</span><p className="font-extrabold mt-3">{sectionMeta[key].label}</p><p className="text-[11px] text-[#766E63] mt-1 leading-snug">{sectionMeta[key].description}</p></button>)}</div></section>
      <section className="max-w-6xl mx-auto px-4 pb-8"><div className="flex items-center justify-between mb-3"><div><h2 className="font-extrabold text-lg">{sectionMeta[section].label}</h2><p className="text-xs text-[#766E63]">{sectionMeta[section].description}</p></div><span className="text-xs font-bold text-[#7C3AED]">{usersForSection.length} conversations</span></div>
        <div className="bg-white rounded-3xl border border-[#E8DEC9] overflow-hidden shadow-sm">{usersForSection.length === 0 ? <div className="p-10 text-center text-sm text-[#766E63]">No available conversations in this section yet.</div> : usersForSection.map((user: any) => { const last = lastMessage(user); const online = Boolean(presence[user.username]?.online); return <button type="button" key={user.username} onClick={() => { setError(''); setActive(user) }} className="w-full flex items-center gap-3 p-4 text-left border-b last:border-0 border-[#F0E9DD] hover:bg-[#FFFBF0] transition focus:outline-none focus:bg-[#FFFBF0]"><div className="relative w-12 h-12 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-extrabold shrink-0">{(user.username?.[0] || '?').toUpperCase()}{online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[#15803D] border-2 border-white" />}</div><div className="min-w-0 flex-1"><p className="font-bold text-sm">{user.name || user.username}{user.verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p><p className="text-xs text-[#766E63] truncate mt-1">{last?.text || 'Start a conversation'}</p></div><div className="text-right shrink-0"><p className="text-[10px] text-[#9A9186]">{last?.at || ''}</p><span className="text-[#7C3AED] text-lg" aria-hidden="true">›</span></div></button> })}</div>
      </section>
    </main>
  )
}
