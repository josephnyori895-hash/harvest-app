import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import CallScreen from './CallScreen'
import { IgIcon, VerifiedBadge } from './Icons'
import { connectSocket, getSocket, onSocket, emitSocket, keyFor, groupKey, fetchHistory } from '../lib/realtime'

type User = { username: string; name?: string; verified?: boolean; role?: string }
type Message = { id: string | number; from: string; to?: string | null; text?: string; at?: string; created_at?: string; status?: string; media?: string; mediaType?: 'image' | 'video'; music?: any }
const GROUP = { username: 'youth_group', name: 'Youth Group', verified: false }
const EMOJIS = ['😀','😂','❤️','🙏','🔥','💜','😊','🎉','👏','😍','🤗','✨','🙌','💪','😇','🥰','😎','🤩','💯']

function avatar(u: Partial<User>) { return (u.name || u.username || '?').slice(0, 1).toUpperCase() }
function preview(m?: Message) { if (!m) return 'Tap to chat'; if (m.mediaType === 'image') return '📷 Photo'; if (m.mediaType === 'video') return '🎥 Video'; if (m.music) return `🎵 ${m.music.title}`; return m.text || 'Message' }
function createMessageMeta() { const now = new Date(); return { id: `tmp_${now.getTime()}`, created_at: now.toISOString(), at: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } }

function Avatar({ user, group = false, online = false, size = 'md' }: { user: Partial<User>; group?: boolean; online?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-11 w-11 text-sm', md: 'h-14 w-14 text-base', lg: 'h-20 w-20 text-2xl' }
  return <div className="relative shrink-0">
    <div className={`${sizes[size]} rounded-[20px] bg-gradient-to-br from-amber-400 via-purple-500 to-teal-500 p-[2px] shadow-md`}>
      <div className="flex h-full w-full items-center justify-center rounded-[18px] bg-white text-purple-700 font-bold">
        {group ? 'Y' : avatar(user)}
      </div>
    </div>
    {online && <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" />}
  </div>
}

function ActionButton({ label, name, onClick }: { label: string; name: string; onClick: () => void }) {
  return <button aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 transition hover:bg-purple-100 active:scale-95">
    <IgIcon name={name} size={20} />
  </button>
}

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
  const hasConversation = Object.values(msgs).some(messages => messages.length > 0)
  const hasPeople = users.some(u => u.username !== currentUser)

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

  if (active) return <div className="min-h-[70vh] overflow-hidden rounded-[28px] bg-[#FFFBF0] text-neutral-900 shadow-xl ring-1 ring-purple-100 sm:min-h-[76vh] lg:min-h-[78vh]">
    <header className="sticky top-0 z-20 flex min-h-[76px] items-center gap-3 border-b border-purple-100 bg-[#FFFBF0]/95 px-3 py-3 backdrop-blur-xl sm:px-5">
      <button aria-label="Back" onClick={() => { setActive(null); setGroupInfo(false) }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-purple-100 transition hover:bg-purple-50 active:scale-95"><IgIcon name="back" size={21} /></button>
      <Avatar user={active} group={active.username === GROUP.username} online={active.username !== GROUP.username && !!presence[active.username]?.online} />
      <button onClick={() => setGroupInfo(v => !v)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5"><p className="truncate font-bold text-[15px] sm:text-base">{active.username === GROUP.username ? 'Youth Group' : `@${active.username}`}</p>{active.verified && <VerifiedBadge size={15} />}</div>
        <p className="truncate text-xs text-stone-500">{active.username === GROUP.username ? '12 members • invite-only' : presence[active.username]?.online ? 'Active now' : 'Community chat'}</p>
      </button>
      <div className="hidden items-center gap-1 sm:flex"><ActionButton label="Voice call" name="activity" onClick={() => setCall({ peer: active.username, type: 'voice' })} /><ActionButton label="Video call" name="video" onClick={() => setCall({ peer: active.username, type: 'video' })} /></div>
      <button aria-label="Conversation info" onClick={() => setGroupInfo(v => !v)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white ring-1 ring-purple-100"><IgIcon name="settings" size={19} /></button>
    </header>

    {groupInfo && active.username === GROUP.username && <section className="border-b border-purple-100 bg-gradient-to-r from-purple-50 via-white to-amber-50 px-4 py-4 sm:px-6"><div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-center"><div className="flex flex-1 items-center gap-3"><Avatar user={GROUP} group size="md" /><div><p className="font-bold">Youth Group</p><p className="text-xs text-stone-500">12 members • invite-only</p></div></div><div className="flex w-full gap-2 sm:max-w-sm"><input value={inviteTarget} onChange={e => setInviteTarget(e.target.value)} placeholder="Username to invite" className="min-w-0 flex-1 rounded-2xl border border-purple-100 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-purple-400 focus:ring-4 focus:ring-purple-100"/><button onClick={invite} className="rounded-2xl bg-gradient-to-r from-purple-600 to-amber-500 px-4 text-sm font-semibold text-white shadow-md transition hover:shadow-lg active:scale-95">Invite</button></div></div>{inviteStatus && <p className="mx-auto mt-2 max-w-3xl text-xs text-stone-500">{inviteStatus}</p>}</section>}

    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-auto px-3 py-5 sm:px-6 sm:py-7">
      {thread.length === 0 && <div className="flex flex-1 flex-col items-center justify-center py-12 text-center"><div className="rounded-[28px] bg-gradient-to-br from-purple-100 via-amber-50 to-teal-50 p-3"><Avatar user={active} group={active.username === GROUP.username} size="lg" /></div><p className="mt-4 font-bold">{active.username === GROUP.username ? 'Youth Group' : `@${active.username}`}</p><p className="mt-1 max-w-xs text-sm leading-6 text-stone-500">Start a meaningful conversation and keep the community connected. 🙏</p></div>}
      <div className="space-y-3">
        {thread.map(m => { const mine = m.from === currentUser; return <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className="flex max-w-[88%] flex-col sm:max-w-[74%]">{active.username === GROUP.username && !mine && <span className="mb-1 px-2 text-[11px] font-semibold text-purple-600">@{m.from}</span>}
          <div className={`overflow-hidden rounded-[22px] shadow-sm ${mine ? 'rounded-br-md bg-gradient-to-br from-purple-600 to-purple-500 text-white' : 'rounded-bl-md bg-white text-neutral-800 ring-1 ring-purple-100'}`}>
            {m.media && m.mediaType === 'image' && <img src={m.media} alt="Shared photo" className="max-h-80 w-full object-cover" />}
            {m.media && m.mediaType === 'video' && <video src={m.media} controls className="max-h-80 max-w-full" />}
            {m.music && <div className={`m-1.5 flex min-w-0 items-center gap-2 rounded-[18px] p-2 ${mine ? 'bg-black/15' : 'bg-purple-50'}`}><img src={m.music.cover} alt="" className="h-11 w-11 rounded-xl object-cover"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">🎵 {m.music.title}</p><p className="truncate text-[11px] opacity-70">{m.music.artist}</p></div>{m.music.url && <a href={m.music.url} target="_blank" rel="noreferrer" aria-label="Preview music" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-white text-purple-700' : 'bg-purple-600 text-white'}`}><IgIcon name="music" size={15} active={mine} /></a>}</div>}
            {m.text && <p className="whitespace-pre-wrap break-words px-4 py-2.5 text-sm leading-6">{m.text}</p>}
          </div><span className={`mt-1 px-2 text-[10px] text-stone-400 ${mine ? 'text-right' : ''}`}>{m.at || ''}{mine && ` • ${m.status === 'seen' ? 'Seen' : m.status === 'delivered' ? 'Delivered' : 'Sent'}`}</span>
        </div></div> })}
      </div>
      {typing[conversationKey] && <p className="mt-2 px-3 text-xs font-medium text-purple-500">{typing[conversationKey]} is typing…</p>}
    </main>

    {musicOpen && <section className="border-t border-purple-100 bg-white/95 p-3 backdrop-blur-xl sm:px-5"><div className="mx-auto max-w-4xl"><div className="flex gap-2"><div className="flex flex-1 items-center gap-2 rounded-2xl bg-purple-50 px-3 ring-1 ring-purple-100"><IgIcon name="search" size={18}/><input autoFocus value={musicQuery} onChange={e => searchMusic(e.target.value)} placeholder="Find a worship song…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"/></div><button aria-label="Close music" onClick={() => setMusicOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100"><IgIcon name="close" size={18}/></button></div><div className="mt-2 max-h-40 space-y-1 overflow-auto">{musicResults.map(m => <button key={m.id} onClick={() => send(`🎵 ${m.title} • ${m.artist}`, { music: m })} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-purple-50"><img src={m.cover} alt="" className="h-10 w-10 rounded-xl object-cover"/><span className="min-w-0 flex-1"><b className="block truncate text-xs">{m.title}</b><small className="block truncate text-stone-500">{m.artist}</small></span><span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">Send</span></button>)}</div></div></section>}
    {attachOpen && <section className="border-t border-purple-100 bg-white p-3"><div className="mx-auto flex max-w-4xl justify-center gap-2"><button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700"><IgIcon name="image" size={18}/> Photo</button><button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 rounded-2xl bg-purple-50 px-4 py-2.5 text-sm font-semibold text-purple-700"><IgIcon name="video" size={18}/> Video</button><input ref={fileRef} type="file" accept="image/*,video/*" onChange={chooseMedia} className="hidden" /></div></section>}
    {mediaPreview && <section className="border-t border-purple-100 bg-white p-3"><div className="mx-auto flex max-w-4xl items-end gap-3"><div className="relative shrink-0">{mediaType === 'image' ? <img src={mediaPreview} alt="Preview" className="h-20 w-20 rounded-2xl object-cover" /> : <video src={mediaPreview} controls className="h-20 w-20 rounded-2xl object-cover" />}<button aria-label="Remove media" onClick={() => { setMediaPreview(null); setMediaType(null) }} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white"><IgIcon name="close" size={13} active/></button></div><input value={mediaCaption} onChange={e => setMediaCaption(e.target.value)} placeholder="Add a caption…" className="min-w-0 flex-1 rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3 text-sm outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100"/><button aria-label="Send media" onClick={() => send(mediaCaption)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-amber-500 text-white shadow-md"><IgIcon name="send" size={18} active/></button></div></section>}
    {emojiOpen && <section className="border-t border-purple-100 bg-white p-3"><div className="mx-auto grid max-w-4xl grid-cols-7 gap-1 rounded-2xl bg-purple-50 p-2 sm:grid-cols-10">{EMOJIS.map(e => <button key={e} onClick={() => setText(v => v + e)} className="rounded-xl p-2 text-xl transition hover:bg-white">{e}</button>)}</div></section>}
    <footer className="sticky bottom-0 z-10 border-t border-purple-100 bg-[#FFFBF0]/95 p-3 backdrop-blur-xl sm:p-4"><div className="mx-auto flex max-w-4xl items-center gap-2 rounded-[24px] bg-white p-2 shadow-lg ring-1 ring-purple-100"><button aria-label="Emoji" onClick={() => setEmojiOpen(v => !v)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${emojiOpen ? 'bg-purple-100' : 'hover:bg-stone-100'}`}><span className="text-lg">☺</span></button><button aria-label="Add media" onClick={() => setAttachOpen(v => !v)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${attachOpen ? 'bg-amber-100' : 'hover:bg-stone-100'}`}><IgIcon name="plus" size={20}/></button><button aria-label="Share music" onClick={() => setMusicOpen(v => !v)} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${musicOpen ? 'bg-purple-100' : 'hover:bg-stone-100'}`}><IgIcon name="music" size={19}/></button><input value={text} onChange={e => handleTyping(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="Write a message…" className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-stone-400"/><button onClick={() => send()} className="flex h-10 items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-amber-500 px-4 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-95"><IgIcon name="send" size={16} active/><span className="hidden sm:inline">Send</span></button></div></footer>
  </div>

  return <div className="min-h-[70vh] overflow-hidden rounded-[28px] bg-[#FFFBF0] text-neutral-900 shadow-xl ring-1 ring-purple-100 sm:min-h-[76vh]">
    <header className="border-b border-purple-100 bg-gradient-to-r from-purple-50 via-[#FFFBF0] to-amber-50 px-4 pb-4 pt-5 sm:px-6"><div className="flex items-center gap-3"><button aria-label="Back" onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-purple-100"><IgIcon name="back" size={20}/></button><div className="flex-1"><p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-600">Harvest Family</p><h1 className="mt-0.5 text-2xl font-extrabold tracking-tight sm:text-3xl">Messages</h1></div><div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-amber-500 text-white shadow-md"><IgIcon name="chat" size={20} active/></div></div><div className="mt-5 flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-purple-100"><IgIcon name="search" size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your community" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"/></div></header>

    <div className="px-4 pt-4 sm:px-6"><div className="inline-flex rounded-2xl bg-purple-50 p-1"><button onClick={() => setTab('chats')} className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${tab === 'chats' ? 'bg-white text-purple-700 shadow-sm' : 'text-stone-500'}`}>Chats</button><button onClick={() => setTab('groups')} className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${tab === 'groups' ? 'bg-white text-purple-700 shadow-sm' : 'text-stone-500'}`}>Groups</button></div></div>

    <div className="px-4 py-5 sm:px-6"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold text-stone-700">{tab === 'chats' ? 'People in your community' : 'Community groups'}</p><span className="text-xs text-stone-400">{tab === 'chats' ? people.length : '1 group'}</span></div><div className="flex gap-3 overflow-x-auto pb-1">{tab === 'chats' && people.slice(0, 8).map(u => <button key={u.username} onClick={() => setActive(u)} className="min-w-[72px] text-center"><div className="mx-auto w-fit"><Avatar user={u} online={!!presence[u.username]?.online} size="md"/></div><p className="mt-1.5 truncate text-[11px] font-semibold text-stone-700">{u.username}</p></button>)}{tab === 'chats' && people.length === 0 && !query && <p className="py-3 text-sm text-stone-500">No community members available right now.</p>}{tab === 'chats' && people.length === 0 && query && <div className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-purple-50 to-amber-50 px-4 py-3 ring-1 ring-purple-100"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-purple-600 shadow-sm"><IgIcon name="search" size={17}/></div><div className="min-w-0"><p className="truncate text-xs font-bold text-purple-800">No people match “{query}”</p><p className="text-[11px] text-stone-500">Try a name, username, or another search.</p></div></div>}{tab === 'groups' && <button onClick={() => setActive(GROUP)} className="flex min-w-[230px] items-center gap-3 rounded-[22px] bg-gradient-to-br from-purple-600 to-teal-600 p-3 text-left text-white shadow-lg"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 font-bold">Y</div><div><p className="font-bold">Youth Group</p><p className="mt-0.5 text-xs text-white/75">12 members • invite-only</p></div></button>}</div></div>

    <div className="px-3 pb-5 sm:px-5 sm:pb-7">{tab === 'chats' ? <div className="space-y-2">
      {people.length === 0 && query && <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#FFFBF0] via-purple-50 to-teal-50 px-6 py-12 text-center shadow-sm ring-1 ring-purple-100 sm:px-10 sm:py-14"><div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-amber-300/25 blur-2xl"/><div className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-purple-300/20 blur-2xl"/><div className="relative mx-auto max-w-md"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-gradient-to-br from-purple-600 to-teal-500 text-white shadow-lg ring-4 ring-white/70"><IgIcon name="search" size={31} active/></div><span className="mt-5 inline-flex rounded-full bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-purple-600 shadow-sm ring-1 ring-purple-100">Community search</span><h2 className="mt-3 text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">No one matched that search.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-500">We couldn’t find a community member for <span className="font-semibold text-purple-700">“{query}”</span>. Try a different name or username and keep connecting.</p><div className="mt-5 flex flex-wrap justify-center gap-2"><span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 shadow-sm ring-1 ring-purple-100">Try a first name</span><span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 shadow-sm ring-1 ring-purple-100">Try @username</span><span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 shadow-sm ring-1 ring-purple-100">Check spelling</span></div><button onClick={() => setQuery('')} className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg active:scale-95"><IgIcon name="close" size={16} active/>Clear search</button></div></div>}
      {!hasConversation && !query && hasPeople && <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-purple-700 via-purple-600 to-teal-600 p-6 text-white shadow-xl sm:p-8"><div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-400/20 blur-2xl"/><div className="absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-teal-300/15 blur-2xl"/><div className="relative mx-auto max-w-2xl text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-white/15 shadow-inner ring-1 ring-white/20"><IgIcon name="chat" size={30} active/></div><p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Welcome to Harvest Family</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Start with a simple hello.</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-white/80 sm:text-base">Your first conversation can be a prayer, an encouragement, or just a warm hello. Connect with someone from the community and make this space feel like home.</p><div className="mt-5 flex flex-wrap items-center justify-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10">🙏 Pray together</span><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10">💜 Encourage</span><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10">✨ Connect</span></div><p className="mt-5 text-xs font-medium text-white/60">Choose someone above to begin your first conversation.</p></div></section>}
      {hasConversation && people.map(u => { const ms = msgs[keyFor(currentUser, u.username)] || []; const last = ms[ms.length - 1]; return <button key={u.username} onClick={() => setActive(u)} className="group flex w-full items-center gap-3 rounded-[22px] bg-white p-3 text-left shadow-sm ring-1 ring-purple-100 transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99] sm:p-4"><Avatar user={u} online={!!presence[u.username]?.online}/><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate font-bold text-sm">{u.username}</p>{u.verified && <VerifiedBadge size={14}/>}</div><p className="mt-0.5 truncate text-sm text-stone-500">{preview(last)}{last?.from === currentUser ? ` • ${last.status === 'seen' ? 'Seen' : 'Sent'}` : ''}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><span className="text-[10px] text-stone-400">{last?.at || ''}</span><span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 opacity-0 transition group-hover:opacity-100"><IgIcon name="back" size={15}/></span></div></button> })}
      {hasConversation && people.length === 0 && !query && <div className="rounded-[24px] bg-white px-6 py-12 text-center ring-1 ring-purple-100"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50"><IgIcon name="search" size={24}/></div><p className="mt-3 font-bold">No conversations found</p><p className="mt-1 text-sm text-stone-500">There are no community members available to message right now.</p></div>}
    </div> : <button onClick={() => setActive(GROUP)} className="flex w-full items-center gap-4 rounded-[24px] bg-white p-4 text-left shadow-sm ring-1 ring-purple-100 transition hover:-translate-y-0.5 hover:shadow-md"><Avatar user={GROUP} group size="md"/><div className="min-w-0 flex-1"><p className="font-bold">Youth Group</p><p className="mt-0.5 truncate text-sm text-stone-500">{preview(groupThread[groupThread.length - 1])}</p><p className="mt-1 text-[11px] font-medium text-purple-600">12 members • Invite-only • Admin approval</p></div><div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50"><IgIcon name="back" size={17}/></div></button>}</div>
  </div>
}
