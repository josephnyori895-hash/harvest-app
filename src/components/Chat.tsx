import { useEffect, useState, useRef } from 'react'
import CallScreen from './CallScreen'
import { connectSocket, getSocket, onSocket, emitSocket, keyFor, groupKey, fetchHistory } from '../lib/realtime'

export default function Chat({ onBack, users }: { onBack: () => void; users: any[] }) {
  const [active, setActive] = useState<any | null>(null)
  const [text, setText] = useState('')
  const [call, setCall] = useState<{ peer: string; type: 'voice' | 'video' } | null>(null)
  const [msgs, setMsgs] = useState<Record<string, any[]>>(() => {
    const s = localStorage.getItem('harvest_msgs')
    return s ? JSON.parse(s) : {}
  })
  const currentUser = (() => {
    try {
      const raw = localStorage.getItem('harvest_users')
      const u = raw ? JSON.parse(raw)[0]?.username : null
      return localStorage.getItem('harvest_username') || u || 'allan'
    } catch { return 'allan' }
  })()
  const [presence, setPresence] = useState<Record<string, { online: boolean; lastSeen: string }>>({})
  const [typingMap, setTypingMap] = useState<Record<string, string | null>>({})
  const typingTimeout = useRef<Record<string, any>>({})
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null)
  const [chatEmoji, setChatEmoji] = useState('😀')
  const EMOJIS = ['😀','😂','❤️','🙏','🔥','💜','😊','🎉','👏','😍','🤗','✨','🙌','💪','😇','🥰','😎','🤩','🙌','💯','🎵','🎶','🎤','🎧','🎹','🎸','🙏','💯','😘','🤩']
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const sock = connectSocket()
    const offMsg = onSocket('chat:message', (m: any) => {
      const k = m.conversation_key || keyFor(m.from, m.to || currentUser)
      setMsgs(prev => { const next = { ...prev, [k]: [...(prev[k] || []), m] }; localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })
      if (m.to === currentUser || m.kind === 'group') emitSocket('message:delivered', { id: m.id, conversation_key: k })
    })
    const offDelivered = onSocket('message:delivered', ({ id, conversation_key }: any) => {
      setMsgs(prev => { const k = conversation_key; if(!k||!prev[k]) return prev; const next = { ...prev, [k]: prev[k].map((x:any)=>x.id===id?{...x,status:'delivered'}:x) }; localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })
    })
    const offSeen = onSocket('message:seen', ({ conversation_key }: any) => {
      setMsgs(prev => { const k = conversation_key; if(!k||!prev[k]) return prev; const next = { ...prev, [k]: prev[k].map((x:any)=>x.from===currentUser?{...x,status:'seen'}:x) }; localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })
    })
    const offTyping = onSocket('typing', ({ conversation_key, username, typing }: any) => { setTypingMap(prev => ({ ...prev, [conversation_key]: typing ? username : null })) })
    const offPresence = onSocket('presence:update', ({ username, online, lastSeen }: any) => { setPresence(prev => ({ ...prev, [username]: { online, lastSeen } })) })
    const offSnapshot = onSocket('presence:snapshot', (snap: any) => setPresence(snap))
    return () => { offMsg(); offDelivered(); offSeen(); offTyping(); offPresence(); offSnapshot() }
  }, [currentUser])

  useEffect(() => {
    if (!active) return
    const isGroup = active.username === 'youth_group'
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const sock = getSocket()
    if (sock?.connected) { if (isGroup) sock.emit('group:join', { slug: 'youth_group' }); else sock.emit('chat:join', { peer: active.username }) }
    fetchHistory(isGroup ? undefined : active.username, isGroup ? 'youth_group' : undefined)
      .then(({ messages, conversation_key }) => {
        if (!messages?.length) return
        setMsgs(prev => {
          const existing = prev[conversation_key] || []
          const byId = new Map(existing.map((m:any)=>[String(m.id), m]))
          for (const m of messages) byId.set(String(m.id), m)
          const merged = [...byId.values()].sort((a:any,b:any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          const next = { ...prev, [conversation_key]: merged }
          localStorage.setItem('harvest_msgs', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
    const t = setTimeout(() => emitSocket('message:seen', { conversation_key: k }), 400)
    return () => clearTimeout(t)
  }, [active, currentUser])

  useEffect(() => {
    if (!active) return
    const isGroup = active.username === 'youth_group'
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const thread = msgs[k] || []
    const hasUnread = thread.some((m:any) => m.from !== currentUser && m.status !== 'seen')
    if (hasUnread) emitSocket('message:seen', { conversation_key: k })
  }, [msgs, active, currentUser])

  const send = () => {
    if (!text.trim() && !mediaPreview) return
    if (!active) return
    const isGroup = active.username === 'youth_group'
    const body = text.trim()
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const tempId = `tmp_${Date.now()}`
    const msgData: any = { id: tempId, from: currentUser, to: isGroup ? null : active.username, text: body, at: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}), status: 'sent', created_at: new Date().toISOString() }
    if (mediaPreview) { msgData.media = mediaPreview; msgData.mediaType = mediaType; setMediaPreview(null); setMediaType(null) }
    setMsgs(prev => { const next = { ...prev, [k]: [...(prev[k]||[]), msgData] }; localStorage.setItem('harvest_msgs', JSON.stringify(next)); return next })
    setText('')
    setShowEmoji(false)
    setShowAttach(false)

    emitSocket('typing:stop', { conversation_key: k })
    const sock = getSocket()
    if (sock?.connected) {
      const payload: any = isGroup ? { kind: 'group', groupSlug: 'youth_group', body, tempId } : { kind: 'dm', to: active.username, body, tempId }
      if (mediaPreview) payload.media = mediaPreview
      emitSocket('chat:send', payload, (res: any) => {
        if (res?.error) { console.warn('[send ack error]', res.error); return }
        if (res?.id) {
          setMsgs(prev => { const thread = prev[k] || []; const nextThread = thread.map((m:any)=>m.id===tempId?{...m,id:res.id,status:res.status||'sent'}:m); return { ...prev, [k]: nextThread } })
        }
      })
    }
  }

  const handleTyping = (val: string) => {
    setText(val)
    if (!active) return
    const isGroup = active.username === 'youth_group'
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    emitSocket('typing:start', { conversation_key: k })
    if (typingTimeout.current[k]) clearTimeout(typingTimeout.current[k])
    typingTimeout.current[k] = setTimeout(() => emitSocket('typing:stop', { conversation_key: k }), 3000)
  }

  const handleFileAttach = (e: any) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setMediaPreview(dataUrl)
      setMediaType(f.type.startsWith('video') ? 'video' : 'image')
    }
    reader.readAsDataURL(f)
    setShowAttach(false)
  }
  const [musicShareQuery,setMusicShareQuery]=useState('')
  const [musicShareResults,setMusicShareResults]=useState<any[]>([])
  const [showMusicShare,setShowMusicShare]=useState(false)
  const searchShareMusic=async(term:string)=>{ if(!term.trim()){setMusicShareResults([]);return} try{const r=await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=6`);const j=await r.json();setMusicShareResults(j.results.map((x:any)=>({id:x.trackId,title:x.trackName,artist:x.artistName,cover:x.artworkUrl100?.replace('100x100','200x200'),url:x.previewUrl})))}catch{}}
  const shareMusic=(m:any)=>{ if(!active) return; const isGroup=active.username==='youth_group'; const k=isGroup?groupKey('youth_group'):keyFor(currentUser,active.username); const tempId=`tmp_${Date.now()}`; const msg={id:tempId,from:currentUser,to:isGroup?null:active.username,text:`🎵 ${m.title} • ${m.artist}`,music:m,at:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),status:'sent',created_at:new Date().toISOString()}; setMsgs((prev:any)=>{const n={...prev,[k]:[...(prev[k]||[]),msg]};localStorage.setItem('harvest_msgs',JSON.stringify(n));return n}); setShowMusicShare(false); setMusicShareQuery(''); const sock=getSocket(); if(sock?.connected){ const payload:any=isGroup?{kind:'group',groupSlug:'youth_group',body:`🎵 ${m.title}`,music:m,tempId}:{kind:'dm',to:active.username,body:`🎵 ${m.title}`,music:m,tempId}; emitSocket('chat:send',payload,()=>{})}}

  const [inviteTarget, setInviteTarget] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const inviteToGroup = () => {
    if (!inviteTarget.trim()) return
    setInviteStatus('sending…')
    emitSocket('group:invite', { slug: 'youth_group', targetUsername: inviteTarget.trim() }, (res: any) => {
      if (res?.error) setInviteStatus(res.error)
      else setInviteStatus('Invite sent — admin must approve ✓')
      setTimeout(() => setInviteStatus(''), 3000)
    })
  }

  const sendVoice = () => {
    setRecording(false)
    const r = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
    const tempId = `tmp_${Date.now()}`
    const isGroup = active?.username === 'youth_group'
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const msg = { id:tempId, from:currentUser, to:isGroup?null:active.username, text:'🎙️ Voice message', at:r, status:'sent', created_at:new Date().toISOString() }
    setMsgs(prev => ({ ...prev, [k]: [...(prev[k]||[]), msg] }))
    localStorage.setItem('harvest_msgs', JSON.stringify(msgs))
  }

  if (active) {
    const isGroup = active.username === 'youth_group'
    const k = isGroup ? groupKey('youth_group') : keyFor(currentUser, active.username)
    const thread = msgs[k] || []
    const peerTyping = typingMap[k]
    if (call) return <CallScreen peer={call.peer} type={call.type} onEnd={() => setCall(null)} />
    return (
      <div className="bg-black text-white min-h-[70vh] flex flex-col">
        <div className="flex items-center gap-3 px-4 h-[56px] border-b border-zinc-800">
          <button onClick={() => setActive(null)} className="text-xl">‹</button>
          <div className="relative"><div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs">{active.username[0].toUpperCase()}</div></div>{(presence[active.username]?.online || ['allan','pst.simon','youth_harvest'].includes(active.username)) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></span>}</div>
          <div><p className="text-sm font-semibold flex items-center gap-1">{active.username} {active.verified && <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[7px]">✓</span>}</p><p className="text-xs text-zinc-400">{isGroup ? 'Youth Group • invite-only' : `${active.name} • ${presence[active.username]?.online ? 'Active now' : 'Last seen ' + (presence[active.username]?.lastSeen ? new Date(presence[active.username].lastSeen).toLocaleTimeString() : 'recently')}`}</p></div>
          <div className="flex gap-3 ml-auto">
            <button onClick={() => setCall({ peer: active.username, type: 'voice' })} className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm">📞</button>
            <button onClick={() => setCall({ peer: active.username, type: 'video' })} className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm">📹</button>
            <span className="text-xl">⋯</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {thread.length === 0 ? <p className="text-sm text-zinc-500 text-center py-12">No messages yet — say Karibu 🙏</p> : thread.map((m:any) => (
            <div key={m.id} className={`flex ${m.from === currentUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[72%] px-3 py-2 rounded-2xl text-sm ${m.from === currentUser ? 'bg-[#0095f6] text-white rounded-br-sm' : 'bg-zinc-800 text-white rounded-bl-sm'}`}>
                {m.media && m.mediaType === 'image' && <img src={m.media} alt="" className="w-full max-h-48 object-cover rounded-lg mb-2" />}
                {m.media && m.mediaType === 'video' && <video src={m.media} controls className="w-full max-h-48 object-cover rounded-lg mb-2" />}
                {m.music && <div className="flex gap-2 items-center p-2 bg-black/30 rounded-lg mb-2"><img src={m.music.cover} className="w-10 h-10 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">🎵 {m.music.title}</p><p className="text-[11px] opacity-70 truncate">{m.music.artist}</p></div><a href={m.music.url} target="_blank" className="text-xs bg-white text-black px-2 py-1 rounded-full">▶</a></div>}
                {m.text && <div>{m.text}</div>}
                <div className={`text-[10px] mt-1 flex items-center gap-1 ${m.from === currentUser ? 'justify-end' : ''} ${m.from === currentUser ? (m.status === 'seen' ? 'text-blue-400' : m.status === 'delivered' ? 'text-zinc-300' : 'text-white/70') : 'text-zinc-400'}`}>{m.at} {m.from === currentUser && <span className={`text-[11px] ${m.status === 'seen' ? 'text-blue-400' : ''}`}>{m.status === 'seen' ? '✓✓' : m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : ''}</span>}</div>
              </div>
            </div>
          ))}
          {peerTyping && <div className="flex justify-start"><div className="bg-zinc-800 px-3 py-2 rounded-2xl rounded-bl-sm text-sm text-zinc-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" /><span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce delay-100" /><span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce delay-200" /><span className="ml-1 text-xs">{peerTyping} is typing…</span></div></div>}
        </div>
        {showAttach && (
          <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900 flex gap-2 justify-center">
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-800 text-white text-sm">📷 Photo</button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-800 text-white text-sm">🎥 Video</button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFileAttach} className="hidden" />
          </div>
        )}
        {showMusicShare && (
          <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900">
            <div className="flex gap-2"><input value={musicShareQuery} onChange={e=>{setMusicShareQuery(e.target.value);searchShareMusic(e.target.value)}} placeholder="Search music to share 🎵" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-full px-3 py-2 text-xs outline-none"/><button onClick={()=>setShowMusicShare(false)} className="text-xs">✕</button></div>
            <div className="space-y-2 mt-2 max-h-32 overflow-auto">{musicShareResults.map((m:any)=><div key={m.id} className="flex gap-2 p-2 bg-zinc-800 rounded-lg items-center"><img src={m.cover} className="w-8 h-8 rounded"/><div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{m.title}</p><p className="text-[11px] text-zinc-400 truncate">{m.artist}</p></div><button onClick={()=>shareMusic(m)} className="px-3 py-1 rounded-full bg-[#0095f6] text-white text-xs">Send</button></div>)}</div>
          </div>
        )}
        {mediaPreview && (
          <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900 flex items-center gap-2">
            {mediaType === 'image' && <img src={mediaPreview} alt="" className="w-12 h-12 object-cover rounded-lg" />}
            {mediaType === 'video' && <video src={mediaPreview} className="w-12 h-12 object-cover rounded-lg" />}
            <span className="text-xs text-zinc-400 flex-1">{mediaType === 'image' ? '📷 Photo attached' : '🎥 Video attached'}</span>
            <button onClick={() => { setMediaPreview(null); setMediaType(null) }} className="text-red-400 text-xs">✕</button>
          </div>
        )}
        {showEmoji && (
          <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900 grid grid-cols-8 gap-1">
            {EMOJIS.map(e => <button key={e} onClick={() => { setText(t => t + e); setShowEmoji(false)}} className="text-xl p-1 hover:bg-zinc-800 rounded">{e}</button>)}
          </div>
        )}
        <div className="p-3 border-t border-zinc-800 flex gap-2 items-center">
          <button onClick={() => setShowEmoji(!showEmoji)} className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-lg">😊</button>
          <button onClick={() => setShowAttach(!showAttach)} className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-lg">📎</button>
          <button onClick={() => setShowMusicShare(!showMusicShare)} className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-lg">🎵</button>
          <button onClick={sendVoice} className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-lg">🎙️</button>
          <input value={text} onChange={e => handleTyping(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Message... 🎵 🎶 🙏" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2.5 text-sm outline-none" />
          <button onClick={send} className="px-4 py-2 rounded-full bg-[#0095f6] text-white text-sm font-semibold">Send</button>
        </div>
        <div className="flex justify-center pb-1">
          {EMOJIS.slice(0,10).map(e => <button key={e} onClick={() => setText(t => t + e)} className="text-base px-1.5 py-0.5 hover:bg-zinc-800 rounded">{e}</button>)}
        </div>
        <p className="text-[11px] text-zinc-600 text-center py-1">Privacy: 1-1 • Group below • 📎 Photo • 🎙️ Voice • 😊 Emoji</p>
      </div>
    )
  }

  return (
    <div className="bg-black text-white min-h-[70vh]">
      <div className="flex items-center justify-between px-4 h-[56px] border-b border-zinc-800">
        <div className="flex items-center gap-3"><button onClick={onBack} className="text-xl">‹</button><h1 className="font-bold">allan</h1><span>⌄</span></div>
        <div className="flex gap-4 text-xl"><span>✎</span></div>
      </div>
      <div className="px-4 py-2 flex gap-2 overflow-x-auto border-b border-zinc-800">
        <div className="flex flex-col items-center min-w-[60px]"><div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">📎<br />Note</div><p className="text-[11px] mt-1">Note</p></div>
        {users.slice(0,6).map((u:any) => (
          <button key={u.username} onClick={() => setActive(u)} className="flex flex-col items-center min-w-[60px]">
            <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs">{u.username[0].toUpperCase()}</div></div>
            <p className="text-[11px] mt-1 truncate w-[60px] text-center">{u.username.split('_')[0]}</p>
          </button>
        ))}
      </div>
      <div className="px-4 py-2 flex justify-between items-center"><p className="font-semibold text-sm">Messages</p><p className="text-sm text-blue-500">Requests</p></div>
      <div>
        {users.slice(0,8).map((u:any) => {
          const k2 = keyFor(currentUser, u.username)
          const thread = msgs[k2] || []
          const last = thread[thread.length-1]
          return (
            <button key={u.username} onClick={() => setActive(u)} className="w-full flex gap-3 px-4 py-3 hover:bg-zinc-900 text-left">
              <div className="relative"><div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">{u.username[0].toUpperCase()}</div>{(presence[u.username]?.online) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></span>}{!presence[u.username] && ['allan','pst.simon','youth_harvest'].includes(u.username) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black opacity-60"></span>}</div>
              <div className="flex-1 min-w-0"><p className="text-[14px] font-semibold flex items-center gap-1">{u.username} {u.verified && <span className="w-3 h-3 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">✓</span>}</p><p className="text-[13px] text-zinc-400 truncate flex items-center gap-1">{last ? <><span className={last.status==='seen'?'text-blue-400':''}>{last.status==='seen'?'✓✓':last.status==='delivered'?'✓✓':last.status==='sent'?'✓':''}</span> {last.text}</> : u.name+' • Tap to chat'}</p></div>
              <span className="text-xs text-zinc-500">{last ? last.at : ''}</span>
            </button>
          )
        })}
      </div>
      <div className="px-4 py-3 border-t border-zinc-800 mt-2">
        <p className="text-xs font-bold text-zinc-400">GROUP CHAT</p>
        <button onClick={() => setActive({ username: 'youth_group', name: 'Youth Group', verified: false })} className="w-full flex gap-3 py-3 text-left">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-600 flex items-center justify-center">👥</div>
          <div className="flex-1"><p className="text-sm font-semibold">Youth Group • 12 members</p><p className="text-xs text-zinc-400">Privacy: invite-only • Admin approves joins</p></div>
          <span className="text-xs bg-zinc-800 px-2 py-1 rounded-full text-white">Open</span>
        </button>
      </div>
      <div className="px-4 py-3 border-t border-zinc-800">
        <div className="flex gap-2 overflow-x-auto pb-1">
            {[['😀','😂'],['❤️','🙏'],['🔥','💜'],['🎵','🎶'],['😊','🎉'],['👏','😍'],['🤗','✨'],['💪','😇'],['🥰','😎'],['🤩','💯']].map((row,i) => (
            <div key={i} className="flex gap-1">{row.map(e => <button key={e} onClick={() => setText(t => t + e)} className="text-lg px-2 py-0.5 hover:bg-zinc-800 rounded">{e}</button>)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
