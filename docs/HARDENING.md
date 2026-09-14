# Harvest Family — Hardening (VPS-only, 500 users, PIN kept, no OTP)

> Single VPS KES 1k. Postgres + MinIO + Fastify + Socket.IO same host. No external auth/SMS.

## 1. Threat model (500 users, church trust boundary)

| Vector | Before | After | File:Line |
|---|---|---|---|
| **Auth PIN plaintext** | `src/state/auth.tsx:5` `ADMIN_PINS=['7777','0000','7C3AED']` client-side only; `server/src/index.js:32` `ADMIN_PINS_PLAIN` fallback in prod; JWT secret fallback `dev-jwt-secret-change-in-prod` at `:24` + `:72`; no bcrypt verification for member PIN | Server bcrypt kept: `users.pin_hash bcrypt(10)` in `server/migrations/002_realtime.sql:64` + `server/src/middleware/auth.js:42 isAdminPin` compares against `ADMIN_PIN_HASHES` JSON bcrypt array; prod fail-closed (no plaintext fallback when `NODE_ENV=production`); member PIN 4-6 digits `isValidMemberPin`; JWT expiry `2h guest /24h member /7d admin|pastor` at `server/src/index.js:92` | `server/src/middleware/auth.js:22` `makeAuthenticate`, `:42` `isAdminPin`, `:88` `isValidMemberPin`, `server/src/index.js:16` `JWT_SECRET` warn, `:28-94` login hardened |
| **Role RBAC Admin 188** | `src/App.jsx:174` `<RequireRole role="admin"><Admin/></RequireRole>` client-side gate only (bypass via devtools); API `server/src/routes/pending.js:7` `if req.user?.role !== 'admin'` inline but no middleware, no pastor role | API RBAC via middleware `requireRole` at `server/src/middleware/auth.js:28 RANK` + `requireAdmin/requirePastor/requireMember`; all pending/admin routes now `preHandler:[requireAdmin]`; client gate kept but server is source of truth | `server/src/middleware/auth.js:28-45`, `server/src/index.js:23` `authenticate` global, `server/src/routes/pending.js:4` `requireAdmin` on `:12`,`:22`,`:32`, `server/src/routes/media.js:2` `requireMember` |
| **Verify split-brain 138 vs 564** | `src/App.jsx:138` approve hardcodes `verified:false`; `src/components/Admin.tsx:8` `toggleVerify` mutates `localStorage harvest_users` only; feed never re-JOINs users table → stale snapshot | DB fix: `server/src/routes/pending.js:22` reads live `users.verified` on approve and stores `verified_snapshot`; `server/src/routes/feed.js:20` `COALESCE(users.verified, posts.verified_snapshot)` so `POST /api/admin/verify/:username` (`pending.js:38`) toggling `users.verified` reflects immediately without re-approve; audit log `actor_role` | `server/src/routes/pending.js:22-24` snapshot, `server/src/routes/feed.js:20,28`, `server/migrations/003_hardening.sql:6` audit, `server/src/routes/pending.js:38` verify endpoint |
| **Single follow 98 → mutual** | `src/state/auth.tsx:98` `return following.includes(target)` single direction; `src/App.jsx:98` leaked location if follower only | Mutual `isMutual(viewer,target)` checks both directions at `src/state/auth.tsx:115` `a && b`; server adds `is_mutual(a UUID,b UUID)` SQL at `server/migrations/003_hardening.sql:18` + `server/src/routes/users.js:44` `is_mutual` query; ViewUser `canSee = admin || isMutual` at `src/components/ViewUser.tsx:23`, HarvestMap `canSee` at `src/components/HarvestMap.tsx:40` | `src/state/auth.tsx:115`, `server/migrations/003_hardening.sql:18-24`, `server/src/routes/users.js:44`, `src/components/ViewUser.tsx:23`, `src/components/HarvestMap.tsx:40` |
| **Coords leak 723** | `src/App.jsx:723` `users.map(u=> <Marker position={[u.lat,u.lng]})` exposes precise coords to all; API would leak if any `/api/users` returned raw lat/lng | Frontend: `HarvestMap.tsx:47` splits `visibleUsers`/`hiddenUsers`; hidden jitter `groupCoords[group] + (Math.random-0.5)*0.008` approx 300-500m, `opacity 0.6` popup `Hidden — mutual follow required`; Backend: new `GET /api/users/map` at `server/src/routes/users.js:10` checks `isAdmin || mutual` else returns jitter centroid + `hidden:true, location:null` | `src/components/HarvestMap.tsx:47-73`, `src/components/ViewUser.tsx:23-43`, `server/src/routes/users.js:10-40`, `server/migrations/003_hardening.sql:26` |
| **localStorage pending 109 → Postgres** | `src/App.jsx:79` `harvest_pending` localStorage array; `PostCreate.tsx:18` fabricates `picsum.photos` + `gtv-videos-bucket`; `App.jsx:96 submitPost` pushes to local state | Postgres `pending_queue` (`server/migrations/001_init.sql:20`) replaces localStorage; member `POST /api/media/confirm` inserts `status='pending'` (`server/src/routes/media.js:54`), admin sees `GET /api/pending` (`server/src/routes/pending.js:8`), member sees `GET /api/pending/mine`; `presign -> PUT MinIO -> confirm` via `src/lib/api.ts:15 presign` + `:24 uploadToMinio`; workers `thumb.js` / `transcode.js` process; localStorage kept only as offline fallback when `VITE_USE_API!=true` | `src/App.jsx:79-127`, `src/components/PostCreate.tsx:18`, `server/migrations/001_init.sql:20`, `server/src/routes/media.js:18`, `server/src/routes/pending.js:8`, `src/lib/api.ts:15` |
| **JWT silent swallow** | `server/src/index.js:20` `catch{}` swallows verify error, sets no req.authError | `server/src/middleware/auth.js:22 makeAuthenticate` sets `req.user=null; req.authError=e.message`, logs shape violation, validates role in `admin|pastor|member|guest` | `server/src/middleware/auth.js:12-26`, `server/src/index.js:22-25` |

## 2. Auth PIN bcrypt — kept, no OTP, VPS-only

**Constraint:** Church 500 users, low-end Android, no SMS/OTP cost. PIN is 4-6 digits kept.

* Storage: `users.pin_hash TEXT` bcrypt cost 10 (not 12 — 1 vCPU ~15ms vs 200ms; 500 users login burst OK). See `migrations/002_realtime.sql:64`.
* Admin PINs: never plaintext in prod. `.env ADMIN_PIN_HASHES='["$2a$10$...","$2a$10$...","$2a$10$..."]'` generated via `node -e "import('bcryptjs').then(async m=>{for(const p of ['7777','0000','7C3AED'])console.log(await m.hash(p,10))})"`. Code at `middleware/auth.js:42` iterates hashes with `bcrypt.compare`. In `NODE_ENV=production` plaintext fallback disabled (fail-closed).
* Admin account binding: an admin row that already has `pin_hash` authenticates **only** against that hash (`app.js` login). `ADMIN_PIN_HASHES` is a bootstrap credential: it can claim an admin account that has no `pin_hash` yet, and it can never overwrite an existing one. Provision real admin accounts via `POST /api/admin/users` (sets `pin_hash`) so no admin row is ever left in the bootstrap state.
* Member PIN: `isValidMemberPin` regex `^\d{4,6}$` (`middleware/auth.js:88`). On first login, hash stored; on later login `bcrypt.compare` (`index.js:60`). Wrong PIN → 401 + `login_attempts` row.
* Roles: `admin | pastor | member | guest` (`auth.tsx:3`, `003_hardening.sql:5`). `guest` = no PIN or no username → ephemeral JWT `2h` with id `000...`. `pastor` = DB-promoted (update `users set role='pastor' where username='pst.simon'`), not a PIN list; keeps PIN bcrypt kept but adds pastoral authority without new PIN distribution.
* JWT: `JWT_SECRET` from `.env` (`index.js:16` warns if missing). Expiry `2h guest /24h member /7d pastor|admin`. Payload `{id, username, role, group_name, constituency, faith}`. Verified via `makeAuthenticate` on every request (`index.js:23` `app.addHook('onRequest', authenticate)`). Realtime `realtime/io.js:58` verifies same secret.
* Rate limit: `loginRateLimit` (`middleware/auth.js:98`) — 5 attempts /15min per `IP:username`, 429 + `retryAfter`. In-memory Map, GC 30min, OK for single VPS; `login_attempts` table persists for forensics (`003_hardening.sql:38`).

## 3. RBAC guards — Admin 188

* `requireRole(...allowed)` (`middleware/auth.js:28`) uses rank `guest 0 < member 1 < pastor 2 < admin 3`. `admin` bypasses all. Pastor passes member routes via `requireMember` (allows pastor+admin).
* Applied:
  - `GET /api/pending` → `requireAdmin` (`pending.js:12`)
  - `POST /api/pending/:id/approve` → `requireAdmin` (`pending.js:22`)
  - `POST /api/pending/:id/reject` → `requireAdmin` (`pending.js:32`)
  - `POST /api/admin/verify/:username` → `requireAdmin` (`pending.js:38`)
  - `POST /api/media/presign` + `confirm` → `requireMember` (`media.js:6,18`)
  - `GET /api/users/map` + follow/mutual → `requireMember` (`users.js:10,40`)
  - `GET /api/pending/mine` → `requireMember` (`pending.js:8`)
* Client `src/components/Protected.tsx:4 RequireRole` still prompts PIN unlock (`pin 7777 demo`) but now calls `POST /api/auth/login` → JWT → server enforces.

## 4. Verify split-brain 138 vs 564

* Bug: approve stored `approvedPosts` with `verified:false` (`App.jsx:138` old) while `Admin.tsx:8 toggleVerify` mutated `harvest_users` localStorage; feed never re-queried users → verified badge stale.
* Fix transaction (`pending.js:22-42`):
  ```sql
  SELECT verified, group_name, constituency, faith FROM users WHERE id=$1 -- live
  INSERT INTO posts (...verified_snapshot, group_name...) VALUES (snap.verified,...)
  DELETE FROM pending_queue WHERE id=$1
  INSERT INTO audit_log (actor_id,action='approve',target_type,target_id,meta)
  ```
* Feed (`feed.js:20`) returns `verified: COALESCE(users.verified, posts.verified_snapshot)`. Therefore toggling `POST /api/admin/verify/:username` (`pending.js:38` `UPDATE users SET verified=$2`) reflects instantly. `verified_snapshot` kept for historical correctness (if user later unverified, old posts still show snapshot if desired).
* Audit: `003_hardening.sql:13` adds `audit_log.actor_role` + index for forensics.

## 5. Mutual follows 98

* Before: single direction `following.includes(target)` leaked location if viewer followed target.
* After: `src/state/auth.tsx:115 isMutual` checks both maps; server `003_hardening.sql:18 is_mutual(a,b)` + `server/src/routes/users.js:32` batch checks `follows` + `followers` sets. `GET /api/users/:username/mutual` exposes result. `POST /api/users/:username/follow` toggles and returns `{following, mutual}`.

## 6. Coords leak 723

* Frontend: `HarvestMap.tsx:40 canSee = isAdmin || isMutual(viewer, u.username)`; `visibleUsers = users.filter(canSee)`, `hiddenUsers = users.filter(!canSee)` rendered via `jitter(groupCoords[group])` approx centroid, list shows `Hidden — mutual follow to see` (`HarvestMap.tsx:47-89`, `ViewUser.tsx:23-44`).
* Backend: `GET /api/users/map` (`users.js:10`) never returns precise `lat/lng` unless `isAdmin || mutual`. Otherwise returns jittered centroid + `hidden:true`, `location:null`, strips `role`. Group centroids indexed (`003_hardening.sql:30`). Raw `users.lat/lng` never exposed via `/api/feed` (feed omits coords) nor `/api/users?q=` (select omits lat/lng at `users.js:6`).

## 7. Replace localStorage pending 109 with Postgres

* Frontend before: `src/App.jsx:79 useState(()=> JSON.parse(localStorage.getItem('harvest_pending')||'[]'))`, `submitPost` push + `localStorage.setItem`, `approve` moves to `harvest_approved_*` (`App.jsx:96-127`). Offline only.
* Backend: `pending_queue` (`001_init.sql:20`) with `status pending|approved|rejected|transcoding`, indexes `idx_pending_status`, `idx_pending_type_status` (`003_hardening.sql:36`). `POST /api/media/confirm` member → `INSERT pending_queue status='pending'` (`media.js:54`); admin → direct `posts/reels/stories` + `status='transcoding'` (`media.js:41,47`). Admin queue `GET /api/pending` + member `GET /api/pending/mine` (`pending.js:8`). Approve transaction moves to `posts|stories|reels|tracks` + `DELETE pending` + `audit_log` (`pending.js:22-42`). Frontend flag `VITE_USE_API=true` switches `PostCreate.tsx:12` from `picsum` fabrication to `src/lib/api.ts:15 presign` → `uploadToMinio` → `confirmMedia`; `Home.tsx:34` from `[...approvedPosts, ...postsBase]` to `fetchFeed()`; `Admin.tsx:17` from localStorage prop to `fetch('/api/pending')`. LocalStorage retained as offline cache until socket reconnect, but writes go to Postgres first.
* Migration path (see `MEDIA_PIPELINE_AND_RANKED_FEED.md:9`): deploy server alongside frontend, `VITE_USE_API=true` presign fallback to picsum if offline, backfill `harvest_pending` via `POST /api/migrate` (admin), after 30d deprecate localStorage writes.

## 8. Postgres schema deltas

* `001_init.sql:16` role check extended `member|admin` → `member|admin|pastor|guest` via `003_hardening.sql:5`.
* `002_realtime.sql:64` `users.pin_hash TEXT` kept, comment added.
* `003_hardening.sql` adds: `idx_users_role`, `idx_users_username_lower`, `follows_no_self` check, `idx_follows_followee`, `is_mutual()` function, `idx_users_group_name`, `login_attempts` table + indexes, `pending_queue.attempts`, `audit_log.actor_role`, seeds pastor `pst.simon`.

## 9. File:line fix table

| Fix | File:Line (before → after) | Patch |
|---|---|---|
| Auth hook silent catch | `server/src/index.js:20` → `server/src/middleware/auth.js:12` + `server/src/index.js:22` | `makeAuthenticate` validates shape/role, sets `req.authError`, warns if JWT_SECRET default |
| ADMIN_PINS plaintext | `server/src/index.js:32` `ADMIN_PINS_PLAIN` → `server/src/middleware/auth.js:42` `isAdminPin` with `ADMIN_PIN_HASHES` bcrypt + prod fail-closed | Generate hashes via bcryptjs 10, set `.env ADMIN_PIN_HASHES` |
| Member PIN stored | `server/src/index.js:53` hash cost 10 kept but now validates `isValidMemberPin` + 401 on mismatch | `server/src/index.js:60` `bcrypt.compare` check, `login_attempts` insert |
| Role pastor|guest | `server/migrations/001_init.sql:16` `CHECK role IN ('member','admin')` → `server/migrations/003_hardening.sql:5` plus `server/src/index.js:40` role derive + `middleware/auth.js:32 RANK` | DB + JWT include pastor, guest 2h expiry |
| RBAC Admin | `server/src/routes/pending.js:7` inline `if req.user?.role !== 'admin'` → `preHandler:[requireAdmin]` | `server/src/routes/pending.js:12,22,32,38`, `server/src/routes/media.js:6,18`, `server/src/routes/users.js:10` |
| Verify snapshot | `src/App.jsx:138` hardcoded `verified:false` → `server/src/routes/pending.js:22-24` live `SELECT verified` snapshot + `feed.js:20 COALESCE` | `server/src/routes/pending.js:22`, `server/src/routes/feed.js:20,28` |
| Pending queue | `src/App.jsx:79` localStorage → `server/migrations/001_init.sql:20 pending_queue` + `server/src/routes/media.js:54` `INSERT pending` + `server/src/routes/pending.js:8` `GET /api/pending/mine` | `src/lib/api.ts:33 confirmMedia`, `src/components/PostCreate.tsx:12` presign flow |
| Coords leak | `src/App.jsx:723` precise Marker → `src/components/HarvestMap.tsx:47` jitter hidden + `server/src/routes/users.js:10` gated `GET /api/users/map` | `server/migrations/003_hardening.sql:30` index, `users.js:27` jitter |
| Mutual | `src/App.jsx:98` single → `src/state/auth.tsx:115 isMutual` + `server/migrations/003_hardening.sql:18 is_mutual()` | `server/src/routes/users.js:32,44` |
| Rate limit | none → `server/src/middleware/auth.js:98 loginRateLimit` + `server/migrations/003_hardening.sql:38 login_attempts` | `server/src/index.js:29 preHandler:[loginRateLimit]` |
| JWT expiry | `server/src/index.js:72` `7d` all → `server/src/index.js:92` `2h guest /24h member /7d admin|pastor` | `index.js:92 expiresIn` |

## 10. Ops (VPS KES 1k)

* `.env` must set `JWT_SECRET=$(openssl rand -hex 32)`, `ADMIN_PIN_HASHES` bcrypt array, keep `MINIO_SECRET_KEY` 32 chars reused for Postgres pw (docker-compose `postgres:16-alpine` limit 400M, api 350M).
* `docker compose up -d --build` — single command. Caddy + api + postgres + minio + redis 64M + coturn host mode unchanged.
* Backups `backup.cron:02:00 EAT` `pg_dump | gzip` + `mc mirror --exclude "hls/*/*.ts"` to R2 ~1G. `login_attempts` pruned >7d.
* Test: `curl -s http://localhost:3000/health`, `POST /api/auth/login {pin:'7777',username:'harvest_nyeri'}` → admin JWT, `GET /api/pending` with member JWT → 403, `GET /api/users/map` with non-mutual → hidden coords.
