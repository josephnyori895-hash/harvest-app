# Realtime — VPS-only (KES 1k/mo) Socket.IO + Redis/Memory + Coturn

Hybrid: keep PIN bcrypt, no Ably/Pusher. Same VPS runs Postgres + MinIO + Fastify + Socket.IO + Redis (64MB) + coturn 3478/5349. 500 users = single instance sufficient; Redis adapter optional for future scale.

## Architecture
```
[ React App — Chat.tsx / CallScreen.tsx ]
        │  socket.io-client 4.x  (websocket first, polling fallback)
        │  auth: {token}  JWT from POST /api/auth/login (PIN bcrypt)
        ▼
[ Fastify:3000 + socket.io Server ] ── PG (messages, groups, invites)
        │  adapter: memory (default) OR redis://redis:6379 if REDIS_URL set
        │  ephemeral: presence Map, typing 3s timers
        └─ coturn:3478/5349 (TURN for 60% Nyeri 3G symmetric NAT)
```

## Channels (rooms)

| channel | room key | who |
|---------|----------|-----|
| DM | `harvest:chat:a:b` — sorted pair via `keyFor(a,b)` `src/lib/realtime.ts:34` | both peers join on `chat:join {peer}` |
| Group | `group:youth_group` — `groupKey(slug)` `src/lib/realtime.ts:35` | `group:join {slug}` after membership check (invite-only) |
| Personal | `user:${username}` | auto-joined on connect — for delivered/seen + invites + call signaling when not in chat room |
| Presence | global broadcast | `presence:update` / `presence:snapshot` |

Deterministic key eliminates `harvest:chat:b:a` duplication — fixed `Chat.tsx:416 keyFor`.

## Event Contract

### Chat (replaces fake setTimeout 800 delivered / 1800 seen)
```
client → chat:send {to, body, tempId, kind:'dm'|'group', groupSlug}
server → chat:message {id, conversation_key, from, to, text, at, status:'sent'}
server → message:delivered {id, conversation_key, status:'delivered'}  // when recipient online or acks
client → message:delivered {id, conversation_key}  // recipient explicit ack
client → message:seen {conversation_key}           // viewer scrolled thread → server flips all sent→seen, emits message:seen
server → message:seen {conversation_key, by, at}
```
Status icons `Chat.tsx:425`:
- `sent` → `✓`  (`text-white/70`)
- `delivered` → `✓✓` (`text-zinc-300`)
- `seen` → `✓✓` (`text-blue-400`)

Fallback: REST `GET /api/chat/history?peer=alice` or `?group=youth_group` hydrates `messages` table; localStorage `harvest_msgs` retained as offline cache until socket reconnect.

### Typing (3s broadcast) `Chat.tsx:476`
```
client → typing:start {conversation_key}  // on input change
server → typing {conversation_key, username, typing:true}  // to room except sender
— server auto clears after 3000ms, emits typing:false
client → typing:stop {conversation_key}   // on send / blur
```
Client renders `typingMap[k]` bubble with bounce dots.

### Presence (green dot) `Chat.tsx:426 presence 464 511`
```
server (connect) → presence:update {username, online:true, lastSeen}
server (disconnect when socketIds==0) → presence:update {username, online:false, lastSeen}
server (new conn) → presence:snapshot {user: {online, lastSeen}} // hydrate
```
Client `presence[username]?.online` drives `bg-green-500` dot `Chat.tsx:464,511`. `last_seen` PG column keeps fallback when offline. No external presence service.

### Group youth_group invite-only (admin approves) `Chat.tsx:518 Groups invite 525`
```
client (any member) → group:invite {slug:'youth_group', targetUsername}
server checks: global admin OR group_members.role='admin' → insert group_invites status='pending', emit to user:${target}
admin → group:invite:approve {inviteId, approve:true|false}  // or REST POST /api/groups/:slug/invites/:id/approve
server → group:invite:result {id, slug, status:'approved'} → joins sockets, inserts group_members
```
REST mirror: `POST /api/groups/:slug/invite`, `POST /api/groups/:slug/invites/:id/approve` — same auth.

### WebRTC Calls — coturn 3478 `CallScreen.tsx:391 Calling mute/cam 407 412`
- Media never through Fastify — only SDP/ICE relay via sockets `call:offer/answer/ice/end/decline`
- ICE config `src/lib/realtime.ts:getIceServers()`:
  ```js
  stun:harvestfamily.or.ke:3478, stun.l.google.com:19302
  turn:harvestfamily.or.ke:3478 + turns:5349 (lt-cred-mech)
  ```
- Coturn runs host-networked on VPS; `server/coturn.conf` with `external-ip`, `max-bps 30M` (≈20 concurrent calls), lt-cred. 60% Nyeri 3G symmetric NAT requires TURN — STUN alone fails.
- `CallScreen.tsx:391` `status` real states: Calling… → Ringing… → Connected → Ended/Declined/No answer (was setTimeout toggle fake).
- `CallScreen.tsx:407` mute toggles `localStream.getAudioTracks()[0].enabled`
- `CallScreen.tsx:412` cam toggles `localStream.getVideoTracks()[0].enabled`

## Server Files
- `server/src/realtime/io.js:14 attachRealtime(httpServer)` — socket.io Server, auth jwt, redis adapter opportunistic, all handlers
- `server/src/routes/chat.js` — REST history + presence + group invites (fallback when ws blocked on 3G)
- `server/migrations/002_realtime.sql` — groups, group_members, group_invites, messages, users.pin_hash/last_seen
- `server/src/index.js:14` imports bcrypt + chatRoutes + attachRealtime; `:92` attaches after `app.listen`
- `server/package.json:26` adds `socket.io`, `bcryptjs`, `redis`
- `server/docker-compose.yml:14 redis 64MB LRU + coturn host mode + api REDIS_URL, COTURN_*`
- `server/coturn.conf` — LT cred, ports, external-ip auto
- `server/.env.example:14` `REDIS_URL`, `COTURN_*`, `ADMIN_PIN_HASHES`

## Client Files (file:line fixes)
- `src/lib/realtime.ts:34 keyFor` — deterministic sorted pair, shared client/server
- `src/lib/realtime.ts:47 connectSocket()` — auth token, reconnect infinite, websocket+polling
- `src/components/Chat.tsx:22 connectSocket + onSocket(chat:message|delivered|seen|typing|presence)` — **removes** `setTimeout 800 delivered` `Chat.tsx:33-37` fake and `setTimeout 1800 seen + reply` `Chat.tsx:39-49` fake; now real acks
- `src/components/Chat.tsx:55-90 useEffect chat:join/group:join + fetchHistory` — loads PG history, emits message:seen
- `src/components/Chat.tsx:104 send()` — optimistic tempId → emit `chat:send` with ack replacing tempId with server id, handles group vs dm, offline fallback
- `src/components/Chat.tsx:132 handleTyping()` — emits `typing:start`, 3s `typing:stop`
- `src/components/Chat.tsx:60 presence` — green dot from `presence:update/snapshot` not hardcoded `['harvest_nyeri',...]`
- `src/components/Chat.tsx:140 inviteToGroup()` — `group:invite` with admin approves flow
- `src/components/CallScreen.tsx:12-110` — real RTCPeerConnection, getUserMedia, ontrack, onicecandidate → `call:ice`, offer/answer via `call:offer/answer`, `CallScreen.tsx:107 toggleMute`, `112 toggleCam`

## PIN bcrypt kept
- Frontend `src/state/auth.tsx:5 ADMIN_PINS` unchanged for offline demo
- Backend `server/src/index.js:30-42` — if `ADMIN_PIN_HASHES` JSON array set, compares with bcrypt; else plaintext fallback. New users get `pin_hash` bcrypt(10) stored, existing users upgraded on login. No plaintext PIN stored long-term.

## Deploy (VPS KES 1k)

```bash
# generate hashes for 7777,0000,7C3AED
node -e "import('bcryptjs').then(async m=>{for(const p of ['7777','0000','7C3AED']){console.log(p, await m.hash(p,10))}})"
# .env
ADMIN_PIN_HASHES='["$2a$10$...","$2a$10$..."]'
COTURN_EXTERNAL_IP=$(curl -s ifconfig.me)
COTURN_PASSWORD=$(openssl rand -base64 24)

docker compose up -d --build
docker compose exec postgres psql -U harvest -c "\i /docker-entrypoint-initdb.d/002_realtime.sql"
# or npm run migrate

# Caddy TLS for wss + turns
# api.harvestfamily.or.ke → :3000 (ws + https)
# turns:5349 needs cert mounted to /etc/coturn/certs (certbot)
```

Monolith cost: 1 vCPU 1GB fits — Redis 64MB LRU, PG, MinIO, Node, coturn ~150MB idle, 500 users fan-out in memory well below limit. Upgrade to Redis adapter only when scaling to 2 api replicas.

## Testing on Nyeri 3G
- Force TURN: `pc.getStats()` should show `candidateType: relay` when on Safaricom NAT
- Throttle Chrome: 3G 400ms RTT, verify delivered→seen still fires within 1s (no 800/1800 fakes)
- Kill coturn, verify call degrades to STUN-only but still connects on WiFi (graceful)
