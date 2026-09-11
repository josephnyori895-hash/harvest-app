import { useEffect, useMemo, useRef, useState } from 'react'
import CallScreen from './CallScreen'
import { connectSocket, getSocket, onSocket, emitSocket, keyFor, groupKey, fetchHistory } from '../lib/realtime'

type Section = 'prayer' | 'personal' | 'groups' | 'ministry'
type ChatUser = any

const sectionMeta: Record<Section, { label: string; icon: string; description: string }> = {
  prayer: { label: 'Prayer', icon: '🙏', description: 'Pray with and encourage one another' },
  personal: { label: 'Personal', icon: '💬', description: 'Private conversations with your church family' },
  groups: { label: 'Groups', icon: '👥', description: 'Stay connected with your small groups' },
  ministry: { label: 'Ministry', icon: '⛪', description: 'Worship and ministry communication' },
}

export default function Chat({ onBack, users }: { onBack: () => void; users: ChatUser[] }) {
  const [section, setSection] = useState<Section>('prayer')
  const [active, setActive] = useState<ChatUser | null>(null)
  const [text, setText] = useState('')
  const [call, setCall] = useState<{ peer: string; type: 'voice' | 'video' } | null>(null)
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} }
  })
  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('harvest_users')
      const u = raw ? JSON.parse(raw)[0]?.username : null
      return localStorage.getItem('harvest_username') || u || 'harvest-family'
    } catch { return 'harvest-family' }
  }, [])
  const [presence, setPresence] = useState<Record<string, { online: boolean; lastSeen: string }>>({})
  const [typingMap, setTypingMap] = useState<Record<string, string | null>>({})
  const typingTimeout = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [showAttach, setShowAttach] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    connectSocket()
    const offMsg = onSocket('chat:message', (m: any) => {
      const k = m.conversation_key || keyFor(m.from, m.to || currentUser)
      setMsgs(prev => {
        const existing = prev[k] || []
        if (existing.some(x => String(x.id) === String(m.id))) return prev
        const next = { ...prev, [k]: [...existing, m] }
        localStorage.setItem('harvest_msgs', JSON.stringify(next))
        return next
      })
      if (m.to === currentUser || m.kind === 'group') emitSocket('message:delivered', { id: m.id, conversation_key: k })
    })
    const offDelivered = onSocket('message:delivered', ({ id, conversation_key }: any) => {
      setMsgs(prev => {
        if (!conversation_key || !prev[conversation_key]) return prev
        const next = { ...prev, [conversation_key]: prev[conversation_key].map((x: any) => x.id === id ? { ...x, status: 'delivered' } : x) }
        localStorage.setItem('harvest_msgs', JSON.stringify(next))
        return next
      })
    })
    const offSeen = onSocket('message:seen', ({ conversation_key }: any) => {
      setMsgs(prev => {
        if (!conversation_key || !prev[conversation_key]) return prev
        const next = { ...prev, [conversation_key]: prev[conversation_key].map((x: any) => x.from === currentUser ? { ...x, status: 'seen' } : x) }
        localStorage.setItem('harvest_msgs', JSON.stringify(next))
        return next
      })
    })
    const offTyping = onSocket('typing', ({ conversation_key, username, typing }: any) => setTypingMap(prev => ({ ...prev, [conversation_key]: typing ? username : null })))
    const offPresence = onSocket('presence:update', ({ username, online, lastSeen }: any) => setPresence(prev => ({ ...prev, [username]: { online, lastSeen } })))
    const offSnapshot = onSocket('presence:snapshot', (snapshot: any) => setPresence(snapshot))
    return () => { offMsg(); offDelivered(); offSeen(); offTyping(); offPresence(); offSnapshot() }
  }, [currentUser])

  const openConversation = (user: ChatUser) => setActive(user)
  const isGroup = active?.username === 'youth_group'
  const conversationKey = active ? (isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)) : ''
  const thread = conversationKey ? (msgs[conversationKey] || []) : []

  useEffect(() => {
    if (!active) return
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const socket = getSocket()
    if (socket?.connected) {
      if (isGroup) socket.emit('group:join', { slug: 'youth_group' })
      else socket.emit('chat:join', { peer: active.username })
    }
    fetchHistory(isGroup ? undefined : active.username, isGroup ? 'youth_group' : undefined)
      .then(({ messages, conversation_key }) => {
        if (!messages?.length) return
        setMsgs(prev => {
          const existing = prev[conversation_key] || []
          const byId = new Map(existing.map((m: any) => [String(m.id), m]))
          messages.forEach((m: any) => byId.set(String(m.id), m))
          const merged = [...byId.values()].sort((a: any, b: any) => new Date(a.created_at || a.at).getTime() - new Date(b.created_at || b.at).getTime())
          const next = { ...prev, [conversation_key]: merged }
          localStorage.setItem('harvest_msgs', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
    const timer = setTimeout(() => emitSocket('message:seen', { conversation_key: k }), 350)
    return () => clearTimeout(timer)
  }, [active, currentUser, isGroup])

  useEffect(() => {
    if (!conversationKey || !active) return
    if (thread.some((m: any) => m.from !== currentUser && m.status !== 'seen')) emitSocket('message:seen', { conversation_key: conversationKey })
  }, [thread, conversationKey, active, currentUser])

  const send = () => {
    if (!active || (!text.trim() && !mediaPreview)) return
    const body = text.trim()
    const tempId = `tmp_${Date.now()}`
    const msg: any = {
      id: tempId, from: currentUser, to: isGroup ? null : active.username, text: body,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent', created_at: new Date().toISOString(),
      ...(mediaPreview ? { media: mediaPreview, mediaType } : {}),
    }
    setMsgs(prev => {
      const next = { ...prev, [conversationKey]: [...(prev[conversationKey] || []), msg] }
      localStorage.setItem('harvest_msgs', JSON.stringify(next))
      return next
    })
    setText(''); setMediaPreview(null); setMediaType(null); setShowAttach(false)
    emitSocket('typing:stop', { conversation_key: conversationKey })
    const socket = getSocket()
    if (socket?.connected) {
      const payload: any = isGroup
        ? { kind: 'group', groupSlug: 'youth_group', body, tempId }
        : { kind: 'dm', to: active.username, body, tempId }
      if (msg.media) payload.media = msg.media
      emitSocket('chat:send', payload, (res: any) => {
        if (res?.id) setMsgs(prev => ({ ...prev, [conversationKey]: (prev[conversationKey] || []).map((m: any) => m.id === tempId ? { ...m, id: res.id, status: res.status || 'sent' } : m) }))
      })
    }
  }

  const handleTyping = (value: string) => {
    setText(value)
    if (!active) return
    emitSocket('typing:start', { conversation_key: conversationKey })
    if (typingTimeout.current[conversationKey]) clearTimeout(typingTimeout.current[conversationKey])
    typingTimeout.current[conversationKey] = setTimeout(() => emitSocket('typing:stop', { conversation_key: conversationKey }), 3000)
  }

  const handleFileAttach = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setMediaPreview(String(reader.result)); setMediaType(file.type.startsWith('video/') ? 'video' : 'image') }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const usersForSection = useMemo(() => {
    const list = users.filter((u: any) => u.username !== currentUser)
    if (section === 'groups') return [{ username: 'youth_group', name: 'Youth Group', verified: false, kind: 'group' }, ...list.slice(0, 3)]
    if (section === 'ministry') return list.filter((u: any) => u.ministry || u.verified || /worship|pastor|ministry/i.test(`${u.name || ''} ${u.username || ''}`)).slice(0, 8)
    return list.slice(0, 8)
  }, [users, currentUser, section])

  const lastMessage = (u: ChatUser) => {
    const k = u.username === 'youth_group' ? groupKey('youth_group') : keyFor(currentUser, u.username)
    const t = msgs[k] || []
    return t[t.length - 1]
  }

  if (call) return <CallScreen peer={call.peer} type={call.type} onEnd={() => setCall(null)} />

  if (active) {
    const peerTyping = typingMap[conversationKey]
    return (
      <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F] flex flex-col">
        <header className="h-16 shrink-0 border-b border-[#E8DEC9] bg-white/95 backdrop-blur flex items-center gap-3 px-4 sticky top-0 z-20">
          <button onClick={() => setActive(null)} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button>
          <div className="w-10 h-10 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-bold">{isGroup ? '👥' : active.username?.[0]?.toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{isGroup ? 'Youth Group' : active.name || active.username}</p>
            <p className="text-xs text-[#766E63]">{isGroup ? 'Group conversation' : presence[active.username]?.online ? 'Active now' : 'Church family'}</p>
          </div>
          {!isGroup && <div className="flex gap-2"><button onClick={() => setCall({ peer: active.username, type: 'voice' })} className="w-10 h-10 rounded-full bg-[#F5EEDF]" aria-label="Voice call">☎</button><button onClick={() => setCall({ peer: active.username, type: 'video' })} className="w-10 h-10 rounded-full bg-[#F5EEDF]" aria-label="Video call">▣</button></div>}
        </header>

        <div className="flex-1 overflow-auto px-4 py-6 max-w-3xl w-full mx-auto">
          <div className="text-center mb-6"><span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F3E8FF] text-[#5B21B6] text-xs font-bold">{sectionMeta[section].icon} {sectionMeta[section].label}</span><p className="text-xs text-[#766E63] mt-2">A safe space for the Harvest family</p></div>
          {thread.length === 0 ? (
            <div className="text-center py-16"><div className="w-16 h-16 mx-auto rounded-3xl bg-white border border-[#E8DEC9] flex items-center justify-center text-2xl">{sectionMeta[section].icon}</div><h2 className="font-extrabold mt-4">Start the conversation</h2><p className="text-sm text-[#766E63] mt-1">Send an encouragement, prayer, or simple hello.</p></div>
          ) : thread.map((m: any) => (
            <div key={m.id} className={`flex mb-3 ${m.from === currentUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm shadow-sm ${m.from === currentUser ? 'bg-[#7C3AED] text-white rounded-br-md' : 'bg-white border border-[#E8DEC9] rounded-bl-md'}`}>
                {m.media && m.mediaType === 'image' && <img src={m.media} alt="Shared" className="max-w-full max-h-64 rounded-xl mb-2 object-cover" />}
                {m.media && m.mediaType === 'video' && <video src={m.media} controls className="max-w-full max-h-64 rounded-xl mb-2" />}
                {m.music && <div className="flex items-center gap-2 p-2 rounded-xl bg-black/10 mb-2"><img src={m.music.cover} alt="" className="w-10 h-10 rounded-lg" /><div className="min-w-0 flex-1"><p className="text-xs font-bold truncate">{m.music.title}</p><p className="text-[11px] opacity-70 truncate">{m.music.artist}</p></div></div>}
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                <div className={`text-[10px] mt-1.5 flex justify-end gap-1 ${m.from === currentUser ? 'text-white/70' : 'text-[#8A8176]'}`}>{m.at || ''}{m.from === currentUser && <span>{m.status === 'seen' || m.status === 'delivered' ? '✓✓' : '✓'}</span>}</div>
              </div>
            </div>
          ))}
          {peerTyping && <div className="text-xs text-[#766E63] py-2">{peerTyping} is typing…</div>}
        </div>

        {mediaPreview && <div className="px-4 py-2 border-t border-[#E8DEC9] bg-white"><div className="max-w-3xl mx-auto flex items-center gap-3"><div className="w-12 h-12 rounded-xl overflow-hidden bg-[#F5EEDF]">{mediaType === 'image' ? <img src={mediaPreview} alt="Preview" className="w-full h-full object-cover" /> : <video src={mediaPreview} className="w-full h-full object-cover" />}</div><span className="text-xs flex-1">{mediaType === 'image' ? 'Photo attached' : 'Video attached'}</span><button onClick={() => { setMediaPreview(null); setMediaType(null) }} className="text-[#BE185D] font-bold">Remove</button></div></div>}
        {showAttach && <div className="px-4 py-2 border-t border-[#E8DEC9] bg-white"><div className="max-w-3xl mx-auto flex gap-2"><button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded-full bg-[#F5EEDF] text-sm font-bold">📷 Photo / video</button></div></div>}
        <div className="border-t border-[#E8DEC9] bg-white px-3 py-3 shrink-0"><div className="max-w-3xl mx-auto flex items-end gap-2"><button onClick={() => setShowAttach(v => !v)} className="w-11 h-11 shrink-0 rounded-2xl bg-[#F5EEDF] text-lg" aria-label="Attach media">＋</button><input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFileAttach} className="hidden" /><textarea value={text} onChange={e => handleTyping(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} placeholder={section === 'prayer' ? 'Share a prayer or encouragement…' : 'Write a message…'} className="flex-1 resize-none min-h-11 max-h-28 bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" /><button onClick={send} disabled={!text.trim() && !mediaPreview} className="h-11 px-4 rounded-2xl bg-[#7C3AED] text-white font-bold disabled:opacity-40">Send</button></div></div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-72px)] bg-[#FFFBF0] text-[#29251F]">
      <header className="px-4 pt-5 pb-4 bg-white border-b border-[#E8DEC9]"><div className="max-w-6xl mx-auto flex items-center gap-3"><button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-[#F5EEDF] text-xl" aria-label="Back">‹</button><div><p className="text-[11px] uppercase tracking-[0.16em] text-[#766E63]">Harvest Family</p><h1 className="text-2xl font-extrabold">Conversations</h1></div><button className="ml-auto w-10 h-10 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] text-lg" aria-label="New conversation">＋</button></div></header>
      <section className="max-w-6xl mx-auto px-4 py-5"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(sectionMeta) as Section[]).map(key => <button key={key} onClick={() => setSection(key)} className={`text-left p-4 rounded-3xl border transition min-h-[116px] ${section === key ? 'bg-[#F3E8FF] border-[#C4B5FD] shadow-sm' : 'bg-white border-[#E8DEC9] hover:border-[#C4B5FD]'}`}><div className="flex items-center justify-between"><span className="text-2xl">{sectionMeta[key].icon}</span>{section === key && <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />}</div><p className="font-extrabold mt-3">{sectionMeta[key].label}</p><p className="text-[11px] text-[#766E63] mt-1 leading-snug">{sectionMeta[key].description}</p></button>)}
      </div></section>

      <section className="max-w-6xl mx-auto px-4 pb-8"><div className="flex items-center justify-between mb-3"><div><h2 className="font-extrabold text-lg">{sectionMeta[section].label}</h2><p className="text-xs text-[#766E63]">{sectionMeta[section].description}</p></div><span className="text-xs font-bold text-[#7C3AED]">{usersForSection.length} conversations</span></div>
        <div className="bg-white rounded-3xl border border-[#E8DEC9] overflow-hidden shadow-sm">
          {usersForSection.map((u: any) => {
            const last = lastMessage(u)
            const online = u.username !== 'youth_group' && presence[u.username]?.online
            return <button key={u.username} onClick={() => openConversation(u)} className="w-full flex items-center gap-3 p-4 text-left border-b last:border-0 border-[#F0E9DD] hover:bg-[#FFFBF0] transition"><div className="relative w-12 h-12 rounded-2xl bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center font-extrabold shrink-0">{u.username === 'youth_group' ? '👥' : (u.username?.[0] || '?').toUpperCase()}{online && <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-[#15803D] border-2 border-white" />}</div><div className="min-w-0 flex-1"><p className="font-bold text-sm">{u.username === 'youth_group' ? 'Youth Group' : u.name || u.username}{u.verified && <span className="ml-1 text-[#7C3AED]">✓</span>}</p><p className="text-xs text-[#766E63] truncate mt-1">{last?.text || (u.username === 'youth_group' ? 'Group prayer and fellowship' : 'Start a conversation')}</p></div><div className="text-right shrink-0"><p className="text-[10px] text-[#9A9186]">{last?.at || ''}</p><span className="text-[#7C3AED]">›</span></div></button>
          })}
          {usersForSection.length === 0 && <div className="p-10 text-center"><div className="text-3xl">⛪</div><p className="font-bold mt-2">No conversations here yet</p><p className="text-xs text-[#766E63] mt-1">Your ministry conversations will appear here.</p></div>}
        </div>
      </section>
    </main>
  )
}
