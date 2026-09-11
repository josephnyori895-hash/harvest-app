import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { rateLimit, validateString, dmConversationKey, ownsDmConversation, cleanupRateLimitBuckets } from './socketSecurity.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('[config] JWT_SECRET must be set and at least 32 characters long')

const allowedOrigins = (process.env.APP_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
if (!allowedOrigins.length) console.warn('[realtime] APP_ORIGINS is empty; browser Socket.IO connections will be rejected')

const MAX_SDP = 200_000
const MAX_ICE = 20_000
const MAX_ROOM = 250
const RATE = { chat: 30, typing: 60, calls: 20, invites: 10, joins: 30 }

export async function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 256 * 1024,
  })

  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter')
      const { createClient } = await import('redis')
      const pub = createClient({ url: process.env.REDIS_URL })
      const sub = pub.duplicate()
      await Promise.all([pub.connect(), sub.connect()])
      io.adapter(createAdapter(pub, sub))
      console.log('[realtime] redis adapter enabled')
    } catch (e) { console.warn('[realtime] redis adapter failed:', e.message) }
  }

  const presence = new Map()
  const typingTimers = new Map()
  const interval = setInterval(cleanupRateLimitBuckets, 60_000)
  interval.unref?.()

  const groupKey = slug => `group:${slug}`
  const personalKey = username => `user:${username}`

  const emitError = (socket, message) => socket.emit('error', { message })
  const validRoom = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ROOM

  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token
    const header = socket.handshake.headers?.authorization
    const token = typeof authToken === 'string' && authToken ? authToken : (typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : '')
    if (!token || token.length > 4096) return next(new Error('auth required'))
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      if (!payload?.id || typeof payload.username !== 'string' || !payload.username || !['member','leader','admin','guest'].includes(payload.role)) return next(new Error('invalid token claims'))
      socket.user = payload
      next()
    } catch { next(new Error('invalid token')) }
  })

  io.on('connection', socket => {
    const { username, id: userId, role } = socket.user
    if (!username || !userId) return socket.disconnect(true)

    socket.join(personalKey(username))
    const rec = presence.get(username) || { online: false, lastSeen: new Date().toISOString(), socketIds: new Set() }
    rec.online = true; rec.socketIds.add(socket.id); rec.lastSeen = new Date().toISOString(); presence.set(username, rec)
    query('UPDATE users SET last_seen=now() WHERE username=$1', [username]).catch(e => console.warn('[realtime] last_seen:', e.message))
    io.emit('presence:update', { username, online: true, lastSeen: rec.lastSeen })
    socket.emit('presence:snapshot', Object.fromEntries([...presence].map(([u,v]) => [u, { online:v.online, lastSeen:v.lastSeen }])))

    socket.on('chat:join', async ({ peer } = {}, ack) => {
      if (!rateLimit(socket, 'joins', RATE.joins)) return ack?.({ error: 'rate limit exceeded' })
      peer = validateString(peer, 100, true)
      if (!peer || peer === username) return ack?.({ error: 'invalid peer' })
      try {
        const user = await query('SELECT 1 FROM users WHERE username=$1', [peer])
        if (!user.rows[0]) return ack?.({ error: 'user not found' })
        socket.join(dmConversationKey(username, peer))
        ack?.({ ok:true })
      } catch { ack?.({ error:'unable to join conversation' }) }
    })

    socket.on('group:join', async ({ slug } = {}, ack) => {
      if (!rateLimit(socket, 'joins', RATE.joins)) return ack?.({ error:'rate limit exceeded' })
      slug = validateString(slug, 100, true)
      if (!slug) return ack?.({ error:'invalid group' })
      try {
        const g = await query('SELECT id, invite_only FROM groups WHERE slug=$1', [slug])
        if (!g.rows[0]) return ack?.({ error:'group not found' })
        const member = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, userId])
        if (!member.rows[0] && role !== 'admin') return ack?.({ error:'not a member' })
        socket.join(groupKey(slug)); ack?.({ ok:true })
      } catch { ack?.({ error:'unable to join group' }) }
    })

    socket.on('chat:send', async ({ to, body, tempId, kind='dm', groupSlug } = {}, ack) => {
      if (!rateLimit(socket, 'chat', RATE.chat)) return ack?.({ error:'rate limit exceeded' })
      const text = validateString(body, 4000, true)
      if (!text) return ack?.({ error:'body 1..4000 chars required' })
      try {
        if (kind === 'group') {
          groupSlug = validateString(groupSlug, 100, true)
          if (!groupSlug) return ack?.({ error:'groupSlug required' })
          const g = await query('SELECT id FROM groups WHERE slug=$1', [groupSlug])
          if (!g.rows[0]) return ack?.({ error:'group not found' })
          const mem = await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [g.rows[0].id, userId])
          if (!mem.rows[0] && role !== 'admin') return ack?.({ error:'not a member' })
          const conv = groupKey(groupSlug)
          const { rows } = await query(`INSERT INTO messages (kind,conversation_key,sender_id,sender_username,group_id,body,status) VALUES ('group',$1,$2,$3,$4,$5,'sent') RETURNING id,created_at`, [conv,userId,username,g.rows[0].id,text])
          const msg = { id:rows[0].id, kind:'group', conversation_key:conv, from:username, groupSlug, text, status:'sent', created_at:rows[0].created_at }
          io.to(conv).emit('chat:message', msg); return ack?.({ ok:true,id:msg.id,serverId:msg.id,status:'sent' })
        }
        to = validateString(to, 100, true)
        if (!to || to === username) return ack?.({ error:'invalid recipient' })
        const recipient = await query('SELECT id,username FROM users WHERE username=$1', [to])
        if (!recipient.rows[0]) return ack?.({ error:'user not found' })
        const conv = dmConversationKey(username, to)
        const { rows } = await query(`INSERT INTO messages (kind,conversation_key,sender_id,sender_username,recipient_id,recipient_username,body,status) VALUES ('dm',$1,$2,$3,$4,$5,$6,'sent') RETURNING id,created_at`, [conv,userId,username,recipient.rows[0].id,to,text])
        const payload = { id:rows[0].id, tempId, kind:'dm', conversation_key:conv, from:username, to, text, status:'sent', created_at:rows[0].created_at }
        io.to(conv).emit('chat:message',payload); io.to(personalKey(to)).emit('chat:message',payload)
        ack?.({ ok:true,id:rows[0].id,serverId:rows[0].id,status:'sent' })
      } catch (e) { console.warn('[realtime] chat:send:',e.message); ack?.({ error:'message could not be sent' }) }
    })

    socket.on('message:delivered', async ({ id, conversation_key } = {}, ack) => {
      if (!rateLimit(socket,'chat',RATE.chat)) return ack?.({ error:'rate limit exceeded' })
      if (!Number.isInteger(id) || id < 1 || !validRoom(conversation_key)) return ack?.({ error:'invalid receipt' })
      try {
        const result = await query(`UPDATE messages SET status='delivered' WHERE id=$1 AND recipient_id=$2 AND conversation_key=$3 AND status='sent' RETURNING id,sender_username`, [id,userId,conversation_key])
        if (!result.rowCount) return ack?.({ error:'receipt not authorized' })
        io.to(conversation_key).emit('message:delivered',{ id,conversation_key,status:'delivered' }); ack?.({ok:true})
      } catch { ack?.({error:'receipt failed'}) }
    })

    socket.on('message:seen', async ({ conversation_key } = {}, ack) => {
      if (!rateLimit(socket,'chat',RATE.chat)) return ack?.({ error:'rate limit exceeded' })
      if (!validRoom(conversation_key)) return ack?.({error:'invalid conversation'})
      const parts = conversation_key.startsWith('harvest:chat:') ? conversation_key.slice(13).split(':') : []
      const peer = parts.find(p => p !== username)
      if (!peer || !ownsDmConversation(username,peer,conversation_key)) return ack?.({error:'conversation not authorized'})
      try {
        const result = await query(`UPDATE messages SET status='seen' WHERE conversation_key=$1 AND recipient_id=$2 AND status IN ('sent','delivered') RETURNING id`, [conversation_key,userId])
        if (result.rowCount) io.to(conversation_key).emit('message:seen',{conversation_key,by:username,at:new Date().toISOString()})
        ack?.({ok:true})
      } catch { ack?.({error:'receipt failed'}) }
    })

    const checkTypingConversation = conversation_key => {
      if (!validRoom(conversation_key) || !conversation_key.startsWith('harvest:chat:')) return false
      const parts = conversation_key.slice(13).split(':')
      return parts.length === 2 && parts.includes(username) && parts[0] !== parts[1]
    }
    socket.on('typing:start', ({ conversation_key } = {}) => {
      if (!rateLimit(socket,'typing',RATE.typing) || !checkTypingConversation(conversation_key)) return
      socket.to(conversation_key).emit('typing',{conversation_key,username,typing:true})
      const k=`${conversation_key}:${username}`; if(typingTimers.has(k)) clearTimeout(typingTimers.get(k))
      typingTimers.set(k,setTimeout(()=>{socket.to(conversation_key).emit('typing',{conversation_key,username,typing:false});typingTimers.delete(k)},3000))
    })
    socket.on('typing:stop', ({ conversation_key } = {}) => {
      if (!checkTypingConversation(conversation_key)) return
      socket.to(conversation_key).emit('typing',{conversation_key,username,typing:false})
      const k=`${conversation_key}:${username}`; if(typingTimers.has(k)){clearTimeout(typingTimers.get(k));typingTimers.delete(k)}
    })

    socket.on('group:invite', async ({ slug,targetUsername } = {}, ack) => {
      if(!rateLimit(socket,'invites',RATE.invites)) return ack?.({error:'rate limit exceeded'})
      slug=validateString(slug,100,true); targetUsername=validateString(targetUsername,100,true)
      if(!slug||!targetUsername||targetUsername===username) return ack?.({error:'invalid invite'})
      try{
        const g=await query('SELECT id,slug FROM groups WHERE slug=$1',[slug]); if(!g.rows[0]) return ack?.({error:'group not found'})
        const ga=await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3',[g.rows[0].id,userId,'admin'])
        if(role!=='admin'&&!ga.rows[0]) return ack?.({error:'only group admin can invite'})
        const target=await query('SELECT id FROM users WHERE username=$1',[targetUsername]); if(!target.rows[0]) return ack?.({error:'user not found'})
        const {rows}=await query(`INSERT INTO group_invites (group_id,invited_username,invited_user_id,inviter_id,status) VALUES ($1,$2,$3,$4,'pending') RETURNING id`,[g.rows[0].id,targetUsername,target.rows[0].id,userId])
        io.to(personalKey(targetUsername)).emit('group:invite:pending',{id:rows[0].id,slug,invitedBy:username}); ack?.({ok:true,id:rows[0].id})
      }catch{ack?.({error:'invite failed'})}
    })

    socket.on('group:invite:approve', async ({ inviteId,approve } = {}, ack) => {
      if(!rateLimit(socket,'invites',RATE.invites)||!Number.isInteger(inviteId)||typeof approve!=='boolean') return ack?.({error:'invalid invite action'})
      try{
        const inv=await query('SELECT * FROM group_invites WHERE id=$1 AND status=$2',[inviteId,'pending']); if(!inv.rows[0]) return ack?.({error:'invite not pending'})
        if(role!=='admin'){
          const ga=await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3',[inv.rows[0].group_id,userId,'admin'])
          if(!ga.rows[0]) return ack?.({error:'admin only'})
        }
        const status=approve?'approved':'rejected'
        await query('UPDATE group_invites SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1',[inviteId,status,userId])
        if(approve&&inv.rows[0].invited_user_id) await query('INSERT INTO group_members (group_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[inv.rows[0].group_id,inv.rows[0].invited_user_id,'member'])
        const g=await query('SELECT slug FROM groups WHERE id=$1',[inv.rows[0].group_id]); io.to(personalKey(inv.rows[0].invited_username)).emit('group:invite:result',{id:inviteId,slug:g.rows[0]?.slug,status}); ack?.({ok:true,status})
      }catch{ack?.({error:'invite action failed'})}
    })

    const relayCall = (event, payload, build) => {
      if(!rateLimit(socket,'calls',RATE.calls)) return
      const to=validateString(payload?.to,100,true); if(!to||to===username) return
      const sdp=typeof payload?.sdp==='string'&&payload.sdp.length<=MAX_SDP?payload.sdp:null
      const candidate=typeof payload?.candidate==='object'&&JSON.stringify(payload.candidate).length<=MAX_ICE?payload.candidate:null
      if(event==='call:offer'&&!sdp)return; if(event==='call:answer'&&!sdp)return; if(event==='call:ice'&&!candidate)return
      query('SELECT 1 FROM users WHERE username=$1',[to]).then(r=>{if(r.rows[0])io.to(personalKey(to)).emit(event,build(to,sdp,candidate,payload))}).catch(()=>{})
    }
    socket.on('call:offer',p=>relayCall('call:offer',p,(to,sdp,_,x)=>({from:username,sdp,type:x.type==='video'?'video':'voice'})))
    socket.on('call:answer',p=>relayCall('call:answer',p,(to,sdp)=>({from:username,sdp})))
    socket.on('call:ice',p=>relayCall('call:ice',p,(to,_,candidate)=>({from:username,candidate})))
    socket.on('call:end',({to}={})=>{if(rateLimit(socket,'calls',RATE.calls)){to=validateString(to,100,true);if(to&&to!==username)io.to(personalKey(to)).emit('call:end',{from:username})}})
    socket.on('call:decline',({to}={})=>{if(rateLimit(socket,'calls',RATE.calls)){to=validateString(to,100,true);if(to&&to!==username)io.to(personalKey(to)).emit('call:decline',{from:username})}})

    socket.on('disconnect',()=>{
      const r=presence.get(username); if(r){r.socketIds.delete(socket.id);if(!r.socketIds.size){r.online=false;r.lastSeen=new Date().toISOString();io.emit('presence:update',{username,online:false,lastSeen:r.lastSeen});query('UPDATE users SET last_seen=now() WHERE username=$1',[username]).catch(()=>{})}}
      for(const [k,t] of typingTimers){if(k.endsWith(`:${username}`)){clearTimeout(t);typingTimers.delete(k)}}
    })
  })

  return io
}
