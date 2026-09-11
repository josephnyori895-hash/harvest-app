import { useEffect, useMemo, useRef, useState } from 'react'

type Section = 'prayer' | 'personal' | 'groups' | 'ministry'
type ChatUser = any

type Presence = { online: boolean; lastSeen: string }

const API = import.meta.env.VITE_API_URL || ''

const sectionMeta: Record<Section, { label: string; icon: string; description: string }> = {
  prayer: { label: 'Prayer', icon: '🙏', description: 'Pray with and encourage one another' },
  personal: { label: 'Personal', icon: '💬', description: 'Private conversations with your church family' },
  groups: { label: 'Groups', icon: '👥', description: 'Stay connected with your small groups' },
  ministry: { label: 'Ministry', icon: '⛪', description: 'Worship and ministry communication' },
}

const keyFor = (a: string, b: string) => `harvest:chat:${[a, b].sort().join(':')}`
const groupKey = (slug: string) => `group:${slug}`

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('harvest_token') || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  Object.entries(authHeaders()).forEach(([key, value]) => headers.set(key, value))
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API}${path}`, { ...options, headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function mergeMessages(current: any[], incoming: any[]) {
  const byId = new Map(current.map(message => [String(message.id), message]))
  incoming.forEach(message => byId.set(String(message.id), message))
  return [...byId.values()].sort((a, b) => new Date(a.created_at || a.at).getTime() - new Date(b.created_at || b.at).getTime())
}

export default function Chat({ onBack, users }: { onBack: () => void; users: ChatUser[] }) {
  const [section, setSection] = useState<Section>('prayer')
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
  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('harvest_users')
      const u = raw ? JSON.parse(raw)[0]?.username : null
      return localStorage.getItem('harvest_username') || u || 'harvest-family'
    } catch { return 'harvest-family' }
  }, [])

  const isGroup = active?.username === 'youth_group'
  const conversationKey = active ? (isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)) : ''
  const thread = conversationKey ? (msgs[conversationKey] || []) : []

  const saveMessages = (next: Record<string, any[]>) => {
    setMsgs(next)
    localStorage.setItem('harvest_msgs', JSON.stringify(next))
  }

  const syncPresence = async () => {
    try {
      await api<{ ok: boolean; server_time: string }>('/api/presence/heartbeat', { method: 'POST', body: '{}' })
      const result = await api<{ users: Array<{ username: string; online: boolean; last_seen?: string }> }>('/api/presence')
      const next: Record<string, Presence> = {}
      result.users.forEach(user => { next[user.username] = { online: Boolean(user.online), lastSeen: user.last_seen || '' } })
      setPresence(next)
    } catch {
      // Keep the last known presence when the network briefly drops.
    }
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!localStorage.getItem('harvest_token')) return
      await syncPresence()
      if (cancelled) return
    }
    run()
    const timer = window.setInterval(syncPresence, 30000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const loadConversation = async (resetCursor = true) => {
    if (!active) return
    setError('')
    setSyncing(true)
    try {
      const query = isGroup ? `group=${encodeURIComponent('youth_group')}` : `peer=${encodeURIComponent(active.username)}`
      const result = await api<{ messages: any[]; conversation_key: string }>(`/api/chat/history?${query}`)
      const k = result.conversation_key || conversationKey
      const next = { ...msgs, [k]: mergeMessages(msgs[k] || [], result.messages || []) }
      saveMessages(next)
      if (resetCursor) {
        const latest = next[k]?.[next[k].length - 1]
        cursorRef.current[k] = latest?.created_at || new Date(Date.now() - 5000).toISOString()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load conversation')
    } finally {
      setSyncing(false)
    }
  }

  const refreshUpdates = async () => {
    if (!active || !conversationKey || !localStorage.getItem('harvest_token')) return
    const after = cursorRef.current[conversationKey] || new Date(Date.now() - 5000).toISOString()
    try {
      const query = new URLSearchParams({ after, limit: '50' })
      if (isGroup) query.set('group', 'youth_group')
      else query.set('peer', active.username)
      const result = await api<{ messages: any[]; conversation_key: string; server_time: string }>(`/api/chat/updates?${query.toString()}`)
      const k = result.conversation_key || conversationKey
      const existing = msgs[k] || []
      const merged = mergeMessages(existing, result.messages || [])
      if ((result.messages || []).length) saveMessages({ ...msgs, [k]: merged })
      cursorRef.current[k] = result.server_time || cursorRef.current[k]
    } catch (e) {
      // Polling failures are transient; don't interrupt an active conversation.
      console.warn('[chat] update failed', e)
    }
  }

  useEffect(() => {
    if (!active) return
    loadConversation(true)
    const timer = window.setInterval(refreshUpdates, 2500)
    return () => window.clearInterval(timer)
  }, [active?.username, isGroup, currentUser])

  const send = async () => {
    const body = text.trim()
    if (!active || !body || sending) return
    if (body.length > 4000) { setError('Message is limited to 4,000 characters.'); return }

    setSending(true)
    setError('')
    const tempId = `tmp_${Date.now()}`
    const optimistic = {
      id: tempId,
      from: currentUser,
      to: isGroup ? null : active.username,
      text: body,
      status: 'sent',
      created_at: new Date().toISOString(),
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    saveMessages({ ...msgs, [conversationKey]: [...(msgs[conversationKey] || []), optimistic] })
    setText('')

    try {
      const result = await api<{ message: any }>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(isGroup ? { group: 'youth_group', body } : { peer: active.username, body }),
      })
      const saved = result.message
      const current = (msgs[conversationKey] || []).filter(message => message.id !== tempId)
      saveMessages({ ...msgs, [conversationKey]: mergeMessages(current, [saved]) })
      cursorRef.current[conversationKey] = saved.created_at || cursorRef.current[conversationKey]
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message could not be sent')
      saveMessages({ ...msgs, [conversationKey]: (msgs[conversationKey] || []).filter(message => message.id !== tempId) })
      setText(body)
    } finally {
      setSending(false)
    }
  }

  const usersForSection = useMemo(() => {
    const list = users.filter((u: any) => u.username !== currentUser)
    if (section === 'groups') return [{ username: 'youth_group', name: 'Youth Group', verified: false, kind: 'group' }, ...list.slice(0, 3)]
    if (section === 'ministry') return list.filter((u: any) => u.ministry || u.verified || /worship|pastor|ministry/i.test(`${u.name || ''} ${u.username || ''}`)).slice(0, 8)
    return list.slice(0, 8)
  }, [users, currentUser, section])

  const lastMessage = (user: ChatUser) => {
    const k = user.username === 'youth_group' ? groupKey('youth_group') : keyFor(currentUser, user.username)
    const list = msgs[k] || []
    return list[list.length - 1]
  }

  if (active) {
    return (
      <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F] flex flex-col">
        <header className="h-16 shrink-0 border-b border-[#E8DEC9] bg-white/95 backdrop-blur flex items-center gap-3 px-4 sticky top-0 z-20">
          <button onClick={() => setActive(null)} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
          <div className="w-10 h-10 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-bold">{isGroup ? '👥' : active.username?.[0]?.toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{isGroup ? 'Youth Group' : active.name || active.username}</p>
            <p className="text-xs text-[#766E63]">{isGroup ? 'Group conversation' : presence[active.username]?.online ? 'Active now' : 'Church family'}</p>
          </div>
          {syncing && <span className="text-[10px] text-[#766E63]">Syncing…</span>}
        </header>

        <div className="flex-1 overflow-auto px-4 py-6 max-w-3xl w-full mx-auto">
          <div className="text-center mb-6"><span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F3E8FF] text-[#5B21B6] text-xs font-bold">{sectionMeta[section].icon} {sectionMeta[section].label}</span><p className="text-xs text-[#766E63] mt-2">Messages sync automatically while this conversation is open.</p></div>
          {error && <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
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

        <div className="border-t border-[#E8DEC9] bg-white px-3 py-3 shrink-0"><div className="max-w-3xl mx-auto flex items-end gap-2"><textarea value={text} maxLength={4000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} placeholder={section === 'prayer' ? 'Share a prayer or encouragement…' : 'Write a message…'} className="flex-1 resize-none min-h-11 max-h-28 bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" /><button onClick={send} disabled={!text.trim() || sending} className="h-11 px-4 rounded-2xl bg-[#7C3AED] text-white font-bold disabled:opacity-40">{sending ? 'Sending…' : 'Send'}</button></div><p className="max-w-3xl mx-auto text-[10px] text-[#9A9186] mt-1 text-right">{text.length}/4000</p></div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F]">
      <header className="px-4 pt-5 pb-4 bg-white border-b border-[#E8DEC9]"><div className="max-w-6xl mx-auto flex items-center gap-3"><button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button><div><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="text-2xl font-extrabold">Conversations</h1></div></div></header>
      <section className="max-w-6xl mx-auto px-4 py-5"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{(Object.keys(sectionMeta) as Section[]).map(key => <button key={key} onClick={() => setSection(key)} className={`text-left p-4 rounded-3xl border transition min-h-[116px] ${section === key ? 'bg-[#F3E8FF] border-[#C4B5FD] shadow-sm' : 'bg-white border-[#E8DEC9] hover:border-[#C4B5FD]'}`}><span className="text-2xl">{sectionMeta[key].icon}</span><p className="font-extrabold mt-3">{sectionMeta[key].label}</p><p className="text-[11px] text-[#766E63] mt-1 leading-snug">{sectionMeta[key].description}</p></button>)}</div></section>
      <section className="max-w-6xl mx-auto px-4 pb-8"><div className="flex items-center justify-between mb-3"><div><h2 className="font-extrabold text-lg">{sectionMeta[section].label}</h2><p className="text-xs text-[#766E63]">{sectionMeta[section].description}</p></div><span className="text-xs font-bold text-[#7C3AED]">{usersForSection.length} conversations</span></div>
        <div className="bg-white rounded-3xl border border-[#E8DEC9] overflow-hidden shadow-sm">{usersForSection.map((user: any) => { const last = lastMessage(user); const online = user.username !== 'youth_group' && presence[user.username]?.online; return <button key={user.username} onClick={() => setActive(user)} className="w-full flex items-center gap-3 p-4 text-left border-b last:border-0 border-[#F0E9DD] hover:bg-[#FFFBF0] transition"><div className="relative w-12 h-12 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-extrabold shrink-0">{user.username === 'youth_group' ? '👥' : (user.username?.[0] || '?').toUpperCase()}{online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[#15803D] border-2 border-white" />}</div><div className="min-w-0 flex-1"><p className="font-bold text-sm">{user.username === 'youth_group' ? 'Youth Group' : user.name || user.username}{user.verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p><p className="text-xs text-[#766E63] truncate mt-1">{last?.text || (user.username === 'youth_group' ? 'Group prayer and fellowship' : 'Start a conversation')}</p></div><div className="text-right shrink-0"><p className="text-[10px] text-[#9A9186]">{last?.at || ''}</p><span className="text-[#7C3AED]">›</span></div></button> })}</div>
      </section>
    </main>
  )
}
