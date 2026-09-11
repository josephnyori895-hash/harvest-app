import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import CallScreen from './CallScreen'
import { connectSocket, getSocket, onSocket, emitSocket, keyFor, groupKey, fetchHistory } from '../lib/realtime'

type User = { username: string; name?: string; verified?: boolean; role?: string }
type Message = { id: string | number; from: string; to?: string | null; text?: string; at?: string; created_at?: string; status?: string; media?: string; mediaType?: 'image' | 'video'; music?: any }
const GROUP = { username: 'youth_group', name: 'Youth Group', verified: false }
const EMOJIS = ['😀','😂','❤️','🙏','🔥','💜','😊','🎉','👏','😍','🤗','✨','🙌','💪','😇','🥰','😎','🤩','💯']

function avatar(u: Partial<User>) { return (u.name || u.username || '?').slice(0, 1).toUpperCase() }
function preview(m?: Message) { if (!m) return 'Tap to chat'; if (m.mediaType === 'image') return '📷 Photo'; if (m.mediaType === 'video') return '🎥 Video'; if (m.music) return `🎵 ${m.music.title}`; return m.text || 'Message' }
function createMessageMeta() { const now = new Date(); return { id: `tmp_${now.getTime()}`, created_at: now.toISOString(), at: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } }

export default function Chat({ onBack, users = [] }: { onBack: () => void; users: User[] }) {
  const [active, setActive] = useState<User | typeof GROUP | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'chats' | 'groups'>('chats')
  const [text, setText] = useState('')
  const [msgs, setMsgs] = useState<Record<string, Message[]>>(() => { try { return JSON.parse(localStorage.getItem('harvest_msgs') || '{}') } catch { return {} } })
  const [presence, setPresence] = useState<Record<string, { online: boolean; lastSeen?: string }>>({})
  const [typing, setTyping] = useState<Record<string, string | null>>({})
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [musicQuery, setMusicQuery] = useState('')
  const [musicResults, setMusicResults] = useState<any[]>([])
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null)
  const [mediaCaption, setMediaCaption] = useState('')
  const [groupInfo, setGroupInfo] = useState(false)
  const [inviteTarget, setInviteTarget] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [call, setCall] = useState<{ peer: string; type: 'voice' | 'video' } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const currentUser = useMemo(() => { try { const raw = localStorage.getItem('harvest_users'); const first = raw ? JSON.parse(raw)[0]?.username : null; return localStorage.getItem('harvest_username') || first || 'allan' } catch { return 'allan' } }, [])

  const persist = (fn: (p: Record<string, Message[]>) => Record<string, Message[]>) => setMsgs(prev => { const next = fn(prev); localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })

  useEffect(() => {
    connectSocket()
    const offMessage = onSocket('chat:message', (m: any) => {
      const k = m.conversation_key || keyFor(m.from, m.to || currentUser)
      persist(prev => { const existing = prev[k] || []; if (existing.some(x => String(x.id) === String(m.id))) return prev; return { ...prev, [k]: [...existing, m] } })
      if (m.to === currentUser) emitSocket('message:delivered', { id: Number(m.id), conversation_key: k })
    })
    const offDelivered = onSocket('message:delivered', ({ id, conversation_key }: any) => persist(prev => ({ ...prev, [conversation_key]: (prev[conversation_key] || []).map(m => String(m.id) === String(id) ? { ...m, status: 'delivered' } : m) })))
    const offSeen = onSocket('message:seen', ({ conversation_key }: any) => persist(prev => ({ ...prev, [conversation_key]: (prev[conversation_key] || []).map(m => m.from === currentUser ? { ...m, status: 'seen' } : m) })))
    const offTyping = onSocket('typing', ({ conversation_key, username, typing: value }: any) => setTyping(prev => ({ ...prev, [conversation_key]: value ? username : null })))
    const offPresence = onSocket('presence:update', ({ username, online, lastSeen }: any) => setPresence(prev => ({ ...prev, [username]: { online, lastSeen } })))
    const offSnapshot = onSocket('presence:snapshot', (snapshot: any) => setPresence(snapshot || {}))
    return () => { offMessage(); offDelivered(); offSeen(); offTyping(); offPresence(); offSnapshot() }
  }, [currentUser])

  useEffect(() => {
    if (!active) return
    const isGroup = active.username === GROUP.username
    const key = isGroup ? groupKey(GROUP.username) : keyFor(currentUser, active.username)
    const socket = getSocket()
    if (socket?.connected) socket.emit(isGroup ? 'group:join' : 'chat:join', isGroup ? { slug: GROUP.username } : { peer: active.username })
    fetchHistory(isGroup ? undefined : active.username, isGroup ? GROUP.username : undefined).then(({ messages, conversation_key }) => {
      setMsgs(prev => { const map = new Map((prev[conversation_key] || []).map(m => [String(m.id), m])); for (const m of messages || []) map.set(String(m.id), m); const next = { ...prev, [conversation_key]: [...map.values()].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()) }; localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })
    }).catch(() => {})
    emitSocket('message:seen', { conversation_key: key })
  }, [active, currentUser])

  const conversationKey = active ? (active.username === GROUP.username ? groupKey(GROUP.username) : keyFor(currentUser, active.username)) : ''
  const thread = conversationKey ? (msgs[conversationKey] || []) : []
  const people = users.filter(u => u.username !== currentUser && (!query || `${u.username} ${u.name || ''}`.toLowerCase().includes(query.toLowerCase())))
  const groupThread = msgs[groupKey(GROUP.username)] || []

  const send = (messageText = text, extra: Partial<Message> = {}) => {
    if (!active) return
    const isGroup = active.username === GROUP.username
    const body = messageText.trim()
    if (!body && !mediaPreview && !extra.music) return
    const key = conversationKey
    const media = mediaPreview
    const type = mediaType
    const meta = createMessageMeta()
    const local: Message = { ...meta, from: currentUser, to: isGroup ? null : active.username, text: body || mediaCaption || 'Shared media', media: media || undefined, mediaType: type || undefined, status: 'sent', ...extra }
    persist(prev => ({ ...prev, [key]: [...(prev[key] || []), local] }))
    setText(''); setMediaPreview(null); setMediaType(null); setMediaCaption(''); setEmojiOpen(false); setAttachOpen(false); setMusicOpen(false)
    emitSocket('typing:stop', { conversation_key: key })
    const payload: any = isGroup ? { kind: 'group', groupSlug: GROUP.username, body: body || mediaCaption || 'Shared media', tempId: meta.id } : { kind: 'dm', to: active.username, body: body || mediaCaption || 'Shared media', tempId: meta.id }
    if (extra.music) payload.music = extra.music
    if (media) { payload.media = media; payload.mediaType = type }
    emitSocket('chat:send', payload, (res: any) => { if (res?.id) persist(prev => ({ ...prev, [key]: (prev[key] || []).map(m => String(m.id) === String(meta.id) ? { ...m, id: res.id, status: res.status || 'sent' } : m) })) })
  }

  const handleTyping = (value: string) => {
    setText(value)
    if (!active) return
    emitSocket('typing:start', { conversation_key: conversationKey })
    if (typingTimers.current[conversationKey]) clearTimeout(typingTimers.current[conversationKey])
    typingTimers.current[conversationKey] = setTimeout(() => emitSocket('typing:stop', { conversation_key: conversationKey }), 3000)
  }

  const chooseMedia = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
    if (!kind) return
    const reader = new FileReader(); reader.onload = () => { setMediaPreview(String(reader.result)); setMediaType(kind); setMediaCaption(''); setAttachOpen(false) }; reader.readAsDataURL(file); e.target.value = ''
  }

  const searchMusic = async (value: string) => {
    setMusicQuery(value); if (!value.trim()) { setMusicResults([]); return }
    try { const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(value)}&media=music&limit=6`); const j = await r.json(); setMusicResults((j.results || []).map((x: any) => ({ id: x.trackId, title: x.trackName, artist: x.artistName, cover: x.artworkUrl100?.replace('100x100', '200x200'), url: x.previewUrl }))) } catch { setMusicResults([]) }
  }

  const invite = () => { if (!inviteTarget.trim()) return; emitSocket('group:invite', { slug: GROUP.username, targetUsername: inviteTarget.trim() }, (res: any) => { setInviteStatus(res?.error || 'Invite sent — awaiting admin approval'); setInviteTarget(''); setTimeout(() => setInviteStatus(''), 3000) }) }

  if (call && active) return <CallScreen peer={call.peer} type={call.type} onEnd={() => setCall(null)} />

  if (active) return <div className="bg-black text-white min-h-[70vh] flex flex-col">
    <header className="h-16 px-4 border-b border-zinc-800 flex items-center gap-3 sticky top-0 bg-black/95 backdrop-blur z-10">
      <button aria-label="Back" onClick={() => setActive(null)} className="text-2xl w-8">‹</button>
      <div className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center font-semibold">{active.username === GROUP.username ? '👥' : avatar(active)}</div>{active.username !== GROUP.username && presence[active.username]?.online && <span className="absolute right-0 bottom-0 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />}</div>
      <button onClick={() => setGroupInfo(v => !v)} className="flex-1 min-w-0 text-left"><p className="font-semibold truncate">{active.username === GROUP.username ? 'Youth Group' : `@${active.username}`} {active.verified && <span className="text-blue-400">✓</span>}</p><p className="text-xs text-zinc-400 truncate">{active.username === GROUP.username ? '12 members • invite-only' : presence[active.username]?.online ? 'Active now' : 'Message'}</p></button>
      <button aria-label="Voice call" onClick={() => setCall({ peer: active.username, type: 'voice' })} className="text-xl px-2">☎</button><button aria-label="Video call" onClick={() => setCall({ peer: active.username, type: 'video' })} className="text-xl px-2">▣</button><button aria-label="Info" onClick={() => setGroupInfo(v => !v)} className="text-xl px-2">ⓘ</button>
    </header>
    {groupInfo && active.username === GROUP.username && <section className="border-b border-zinc-800 bg-zinc-950 p-4 space-y-3"><div className="flex items-center gap-3"><div className="w-14 h-14 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-600 flex items-center justify-center text-xl">👥</div><div><p className="font-bold">Youth Group</p><p className="text-xs text-zinc-500">12 members • invite-only</p></div></div><div className="flex gap-2"><input value={inviteTarget} onChange={e => setInviteTarget(e.target.value)} placeholder="Username to invite" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 text-sm"/><button onClick={invite} className="px-4 rounded-full bg-white text-black text-sm font-semibold">Invite</button></div>{inviteStatus && <p className="text-xs text-zinc-400">{inviteStatus}</p>}</section>}
    <main className="flex-1 overflow-auto px-3 sm:px-5 py-5 space-y-3">
      {thread.length === 0 && <div className="text-center py-16"><div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[3px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-2xl">{active.username === GROUP.username ? '👥' : avatar(active)}</div></div><p className="font-semibold mt-3">{active.username === GROUP.username ? 'Youth Group' : active.username}</p><p className="text-sm text-zinc-500 mt-1">Start the conversation.</p></div>}
      {thread.map(m => <div key={m.id} className={`flex ${m.from === currentUser ? 'justify-end' : 'justify-start'}`}><div className="max-w-[78%] flex flex-col">
        {active.username === GROUP.username && m.from !== currentUser && <span className="text-[11px] text-zinc-500 px-2 mb-1">@{m.from}</span>}
        <div className={`overflow-hidden rounded-[22px] ${m.from === currentUser ? 'bg-[#3797f0]' : 'bg-zinc-800'}`}>
          {m.media && m.mediaType === 'image' && <img src={m.media} alt="Shared photo" className="max-h-80 w-auto max-w-full object-cover" />}
          {m.media && m.mediaType === 'video' && <video src={m.media} controls className="max-h-80 max-w-full" />}
          {m.music && <div className="m-1 p-2 rounded-[18px] bg-black/30 flex gap-2 items-center min-w-56"><img src={m.music.cover} alt="" className="w-11 h-11 rounded-lg"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">🎵 {m.music.title}</p><p className="text-[11px] opacity-70 truncate">{m.music.artist}</p></div>{m.music.url && <a href={m.music.url} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center">▶</a>}</div>}
          {m.text && <p className="px-4 py-2 text-sm whitespace-pre-wrap break-words">{m.text}</p>}
        </div><span className="px-2 mt-1 text-[10px] text-zinc-500">{m.at || ''}{m.from === currentUser && ` • ${m.status === 'seen' ? 'Seen' : m.status === 'delivered' ? 'Delivered' : 'Sent'}`}</span>
      </div></div>)}
      {typing[conversationKey] && <p className="text-xs text-zinc-500 px-3">{typing[conversationKey]} is typing…</p>}
    </main>
    {musicOpen && <section className="border-t border-zinc-800 bg-zinc-950 p-3"><div className="flex gap-2"><input autoFocus value={musicQuery} onChange={e => searchMusic(e.target.value)} placeholder="Search music" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 text-sm"/><button onClick={() => setMusicOpen(false)}>✕</button></div><div className="mt-2 space-y-1 max-h-36 overflow-auto">{musicResults.map(m => <button key={m.id} onClick={() => send(`🎵 ${m.title} • ${m.artist}`, { music: m })} className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-zinc-900 text-left"><img src={m.cover} alt="" className="w-9 h-9 rounded"/><span className="flex-1 min-w-0"><b className="block text-xs truncate">{m.title}</b><small className="text-zinc-500 truncate block">{m.artist}</small></span><span className="text-xs text-blue-400">Send</span></button>)}</div></section>}
    {attachOpen && <section className="border-t border-zinc-800 bg-zinc-950 p-3 flex justify-center gap-3"><button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-full bg-zinc-900 text-sm">📷 Photo</button><button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-full bg-zinc-900 text-sm">🎥 Video</button><input ref={fileRef} type="file" accept="image/*,video/*" onChange={chooseMedia} className="hidden" /></section>}
    {mediaPreview && <section className="border-t border-zinc-800 bg-zinc-950 p-3"><div className="flex items-end gap-3"><div className="relative">{mediaType === 'image' ? <img src={mediaPreview} alt="Preview" className="w-24 h-24 object-cover rounded-xl" /> : <video src={mediaPreview} controls className="w-24 h-24 object-cover rounded-xl" />}<button onClick={() => { setMediaPreview(null); setMediaType(null) }} className="absolute -right-2 -top-2 w-6 h-6 rounded-full bg-white text-black">×</button></div><input value={mediaCaption} onChange={e => setMediaCaption(e.target.value)} placeholder="Add a caption…" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2.5 text-sm"/><button onClick={() => send(mediaCaption)} className="w-10 h-10 rounded-full bg-[#3797f0]">➤</button></div></section>}
    {emojiOpen && <section className="border-t border-zinc-800 bg-zinc-950 p-3 grid grid-cols-10 gap-1">{EMOJIS.map(e => <button key={e} onClick={() => setText(v => v + e)} className="text-xl p-1">{e}</button>)}</section>}
    <footer className="border-t border-zinc-800 bg-black p-3"><div className="flex items-center gap-2"><button aria-label="Emoji" onClick={() => setEmojiOpen(v => !v)} className="text-xl">☺</button><button aria-label="Add media" onClick={() => setAttachOpen(v => !v)} className="text-2xl">＋</button><button aria-label="Share music" onClick={() => setMusicOpen(v => !v)} className="text-xl">♫</button><input value={text} onChange={e => handleTyping(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Message…" className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2.5 text-sm outline-none"/><button onClick={() => send()} className="text-[#3797f0] font-semibold px-2">Send</button></div></footer>
  </div>

  return <div className="bg-black text-white min-h-[70vh]">
    <header className="h-16 px-4 border-b border-zinc-800 flex items-center gap-3"><button aria-label="Back" onClick={onBack} className="text-2xl">‹</button><h1 className="text-xl font-bold flex-1">Messages</h1><button aria-label="New message" className="text-2xl">✎</button></header>
    <div className="px-4 pt-3"><div className="bg-zinc-900 rounded-xl px-3 py-2 flex items-center gap-2"><span className="text-zinc-500">⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="bg-transparent outline-none text-sm flex-1" /></div></div>
    <div className="px-4 py-3 flex gap-2"><button onClick={() => setTab('chats')} className={`px-4 py-1.5 rounded-full text-sm ${tab === 'chats' ? 'bg-white text-black font-semibold' : 'bg-zinc-900 text-zinc-400'}`}>Chats</button><button onClick={() => setTab('groups')} className={`px-4 py-1.5 rounded-full text-sm ${tab === 'groups' ? 'bg-white text-black font-semibold' : 'bg-zinc-900 text-zinc-400'}`}>Groups</button></div>
    <div className="px-4 pb-3 flex gap-4 overflow-x-auto"><div className="min-w-[64px] text-center"><div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-xl">✎</div><p className="text-[11px] text-zinc-400 mt-1">Your note</p></div>{people.slice(0, 8).map(u => <button key={u.username} onClick={() => setActive(u)} className="min-w-[64px] text-center"><div className="w-16 h-16 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center font-semibold">{avatar(u)}</div></div><p className="text-[11px] mt-1 truncate">{u.username}</p></button>)}</div>
    {tab === 'chats' ? <div>{people.map(u => { const ms = msgs[keyFor(currentUser, u.username)] || []; const last = ms[ms.length - 1]; return <button key={u.username} onClick={() => setActive(u)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-950 text-left"><div className="relative w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center font-semibold">{avatar(u)}{presence[u.username]?.online && <span className="absolute right-0 bottom-0 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />}</div><div className="min-w-0 flex-1"><p className="font-semibold text-sm">{u.username} {u.verified && <span className="text-blue-400">✓</span>}</p><p className="text-sm text-zinc-500 truncate">{preview(last)}{last?.from === currentUser ? ` • ${last.status === 'seen' ? 'Seen' : 'Sent'}` : ''}</p></div><span className="text-[11px] text-zinc-600">{last?.at || ''}</span></button> })}</div> : <div><button onClick={() => setActive(GROUP)} className="w-full flex items-center gap-3 px-4 py-4 hover:bg-zinc-950 text-left"><div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-600 flex items-center justify-center">👥</div><div className="flex-1 min-w-0"><p className="font-semibold">Youth Group</p><p className="text-sm text-zinc-500 truncate">{preview(groupThread[groupThread.length - 1])}</p><p className="text-[11px] text-zinc-600">12 members • Invite-only • Admin approval</p></div><span className="text-zinc-500">›</span></button></div>}
  </div>
}
