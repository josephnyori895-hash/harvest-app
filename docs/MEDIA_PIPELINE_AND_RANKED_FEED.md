# Harvest Family — Media Pipeline + Ranked Feed Architecture
**VPS-only · KES 1k/mo · 500 users · Hybrid pending→approve · MinIO `harvest-media`**

> Replaces shallow `[...approvedPosts, ...postsBase]` at `src/components/Home.tsx:34` and localStorage `harvest_pending` at `src/App.jsx:79` / `src/components/PostCreate.tsx:18`.
> Document is source-of-truth for backend `server/` — VPS is the origin. R2 is optional offsite mirror, never primary.

---

## 0. Constraints & Budget

| Constraint | Decision | Why |
|---|---|---|
| **VPS KES 1k/mo** (~1 vCPU, 1–2 GB RAM, 25–40 GB SSD, 1 TB BW) | MinIO on same VPS, Postgres on same VPS, Node API (Fastify) on same VPS. No managed S3. | Keeps monthly cost fixed. No egress bills. |
| **500 users active** | ~25 GB/yr media (see §7), fits 25 GB SSD + log rotation. | 500× ~50 MB/yr avg (most users lurk). Heavy posters ~5% generate 80% bytes. |
| **Hybrid role** | `member` → `pending_queue`, `admin` → `posts` directly `status='approved'` bypass. | Matches `src/state/auth.tsx:3` `Role='admin'|'member'` + `ADMIN_PINS=['7777']`. |
| **Offline-first mobile** | Capacitor app talks to `https://api.harvestfamily.or.ke` via presigned POST (no file through Node). | Avoids Node memory spike on 50 MB video uploads. |

**R2 stance:** VPS is mirror-of-record. Optional nightly `mc mirror harvest-media -> r2/harvest-media` for free offsite (10 GB free). App never reads from R2 (single origin avoids split-brain). If VPS dies, rehydrate from R2.

---

## 1. Storage — MinIO `harvest-media` on VPS

### 1.1 Bucket layout (single bucket, prefix per type)

```
harvest-media/
  originals/{type}/{yyyy}/{mm}/{uuid}.{ext}   # immutable, private
  thumbs/{type}/{uuid}-400w.webp              # 400w WebP + blurhash in DB
  hls/{reelId}/360p.m3u8 + segments
  hls/{reelId}/480p.m3u8
  hls/{reelId}/720p.m3u8
  hls/{reelId}/master.m3u8
  posters/{reelId}.jpg                         # 266w poster for <video poster>
```

- Bucket: `harvest-media`, created on bootstrap, versioning OFF, object lock OFF.
- Public read OFF — all reads via presigned GET (15 min) or Cloudflare-style CDN cache header. Frontend never gets direct MinIO creds.
- Lifecycle: `originals/*` never expires. `hls/*` segments cached 1y. Orphan `originals/` without DB row GC'd after 48h via cron.

### 1.2 Presigned POST (PostCreate 527/539 replacement)

**Current shallow:** `src/components/PostCreate.tsx:13` fabricates `https://picsum.photos/400/400?random=` and GTM `https://commondatastorage.googleapis.com/gtv-videos-bucket/...` (line 14, `src/App.jsx:138/146`, `src/components/Reels.tsx:4`). No upload.

**Target flow:**

```
1. Client: POST /api/media/presign { type:'post'|'story'|'reel'|'track', contentType, bytes, ext }
   Auth: Bearer JWT (role from auth.tsx). Rate-limit: 10 presigns / min / user.
   Server validates: ext whitelist, maxBytes (image 8MB, video 80MB, audio 15MB), mime sniff.

2. Server: minio.presignedPostPolicy({ bucket:'harvest-media', key:`originals/${type}/${yyyy}/${mm}/${uuid}.${ext}`, expires: 900, conditions: [['content-length-range',1,maxBytes], ['eq','$Content-Type',contentType]] })
   Returns: { url: 'https://media.harvestfamily.or.ke/harvest-media', fields:{key, policy, x-amz-signature...}, key, expiresAt }

3. Client uploads directly to MinIO via <form> POST (no Node proxy). Shows progress bar.

4. Client: POST /api/media/confirm { key, type, caption, blurhash?, duration? }
   Server inserts into pending_queue (member) or posts/* (admin) with status.
   Enqueues worker job: thumb for images, HLS for video.
```

This keeps Node out of hot path; 80 MB video never touches Node heap (critical on 1 GB VPS).

### 1.3 Image pipeline (original + thumb 400w WebP blurhash)

Trigger: `POST /api/media/confirm` for `type=post|story`

```
Worker thumb.js:
  GET original from MinIO -> sharp()
    .resize(400, null, {withoutEnlargement:true})
    .webp({quality:72})
  -> PUT thumbs/{uuid}-400w.webp
  Generate blurhash (blurhash lib, 4x3) + dominant color
  Update row: thumb_key, thumb_url (presigned GET template), blurhash, width, height
  Store sizes: original bytes + thumb bytes in DB
```

Frontend: `src/components/Home.tsx:73` `<img src={p.img}>` becomes:

```tsx
<img src={thumbUrl} style={{background: blurhashCSS}} loading="lazy" />
```

Original served only on tap-to-zoom via presigned GET 60s.

### 1.4 Video pipeline (reels 20-24, autoPlay 346) — poster 266 + HLS 360/480/720

Reels currently `src/components/Reels.tsx:21` `<video src={cur.video} autoPlay muted loop poster={cur.img}>` with bare `ForBiggerBlazes.mp4`.

Pipeline:

```
Worker transcode.js:
  ffmpeg -i original.mp4
    -vf scale=-2:360 -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 64k hls/360p.m3u8
    -vf scale=-2:480 ... 720 ...
    -hls_time 4 -hls_playlist_type vod -master_pl_name master.m3u8
  poster: ffmpeg -ss 0.5 -i original.mp4 -vframes 1 -vf scale=266:-1 poster.jpg (266w as spec)
  PUT to MinIO hls/* + posters/*
  Update reels row: hls_master_key, poster_key, duration, width, height, status='ready'
```

States: `pending_transcode` → `ready` → `approved` (admin sees transcoding spinner). Failed → `transcode_failed` with retry 3x.

Frontend: `src/components/Reels.tsx:21` switches to `hls.js` if `hls_master_url` exists, else fallback mp4. `autoPlay` + `muted` + `playsInline` kept (line 21/346). Use IntersectionObserver to pause offscreen (battery on low-end Android).

### 1.5 Audio pipeline (Music SoundHelix 26 + iTunes 646)

Current `src/components/Music.tsx:35` `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3` + iTunes preview fetch `https://itunes.apple.com/search?term=` line 17/646.

Pipeline same as image: `type='track'` → store original m4a/mp3, generate 128kbps preview + waveform JSON. Keep iTunes search as fallback tab, but uploaded tracks go through `tracks` table with `preview_url` presigned.

---

## 2. Postgres — `pending_queue → posts/stories/reels/tracks` + verified JOIN fix

### 2.1 Core tables

```sql
-- users mirrors src/App.jsx:26 mockUsers + onboarding group 50-57
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,          -- harvest_nyeri, pst.simon
  name TEXT NOT NULL,
  phone TEXT,
  location TEXT,                          -- estate
  group_name TEXT NOT NULL,               -- Harvest Central etc 50-57
  constituency TEXT,                      -- 120-128 (Nyeri Town, Ruringu, Skuta…)
  faith TEXT,                             -- optional: harvested at onboarding step2
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  verified BOOLEAN DEFAULT FALSE,         -- Admin toggle 264
  role TEXT CHECK(role IN ('member','admin')) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- unified pending queue (hybrid)
CREATE TABLE pending_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT CHECK(type IN ('post','story','reel','track')) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  original_key TEXT NOT NULL,             -- MinIO key
  thumb_key TEXT,
  hls_master_key TEXT,
  poster_key TEXT,
  blurhash TEXT,
  width INT, height INT, duration INT,
  status TEXT CHECK(status IN ('pending','approved','rejected','transcoding')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT
);

-- materialized on approve (or admin direct insert)
CREATE TABLE posts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  caption TEXT,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  width INT, height INT,
  likes INT DEFAULT 0, comments INT DEFAULT 0,
  verified_snapshot BOOLEAN,               -- denormalized at approve time (fixes 138 vs 564)
  group_name TEXT, constituency TEXT, faith TEXT, -- denormalized for affinity scoring perf
  is_pinned BOOLEAN DEFAULT FALSE,        -- pinned=1 in feed
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE stories (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,        -- now()+24h, indexed
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE reels (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  caption TEXT,
  hls_master_key TEXT, poster_key TEXT,
  thumb_key TEXT,
  views INT DEFAULT 0,
  likes INT DEFAULT 0, comments INT DEFAULT 0,
  verified_snapshot BOOLEAN,
  group_name TEXT, constituency TEXT, faith TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  title TEXT, artist TEXT,
  original_key TEXT, preview_key TEXT,
  cover_thumb_key TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- audit (who approved what)
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action TEXT, -- 'approve','reject','verify_toggle','pin'
  target_type TEXT, target_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- likes/comments (for engagement scoring)
CREATE TABLE likes (user_id UUID, post_id UUID, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(user_id, post_id));
CREATE TABLE follows (follower_id UUID, followee_id UUID, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(follower_id, followee_id));
```

### 2.2 Verified JOIN fix (138 vs 564)

Bug: `src/App.jsx:138` `verified:false` hardcoded on approve (`approvedPosts` push) vs `src/components/Admin.tsx:11` `toggleVerify` mutates `users.verified` but feed never re-JOINs — stale snapshot.

Fix: On `approve` transaction:

```sql
BEGIN;
  SELECT verified, group_name, constituency, faith INTO v FROM users WHERE id=:user_id;
  INSERT INTO posts (id, user_id, ..., verified_snapshot, group_name, ...) 
  VALUES (:pending.id, :pending.user_id, ..., v.verified, v.group_name, ...)
  ON CONFLICT DO NOTHING;
  -- also snapshot for reels
  DELETE FROM pending_queue WHERE id=:pending.id;
  INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (:admin_id,'approve',:type,:id);
COMMIT;
```

Feed query JOINs `users` for live `verified` but ALSO exposes `verified_snapshot` for historical correctness. API returns `verified: COALESCE(users.verified, posts.verified_snapshot)` — so toggling verified updates feed without re-approving. Index on `users.verified`.

### 2.3 Stories expiry — `expires_at` 24h cron

On approve of `type='story'`:

```sql
INSERT INTO stories (id, user_id, original_key, thumb_key, blurhash, expires_at)
VALUES (:id, :uid, :key, :thumb, :hash, now() + interval '24 hours');
```

Cron `workers/cronStories.js` every 5 min:

```sql
DELETE FROM stories WHERE expires_at < now() RETURNING original_key, thumb_key;
-- then MinIO deleteObjects for returned keys (or mark for GC, delete async)
```

API `GET /api/stories` only returns `WHERE expires_at > now()` (top strip at `src/components/Home.tsx:51`). Client never sees expired.

---

## 3. Ranked Feed — `GET /api/feed` (not shallow append 238)

### 3.1 Replace `src/components/Home.tsx:34`

Old: `const allPosts = [...approvedPosts, ...postsBase]` (238 shallow append, newest localStorage first).

New: `GET /api/feed?cursor=&limit=20` returns ranked `posts+reels` interleaved, `stories` separately at top.

### 3.2 Scoring formula (weights per spec)

For each eligible `post|reel` where `created_at <= now()` and `status='approved'` (or denormalized tables):

```
recency    = exp(-hours_since_created / 72)          weight 0.45
engagement = ln(1 + likes + comments*3) / ln(1+max)  normalized 0..1, weight 0.25
             (comments weigh 3× likes, log dampens viral skew)
affinity   = (group_match?1:0)*0.5 + (constituency_match?1:0)*0.3 + (faith_match?1:0)*0.2  weight 0.20
             group 50-57 priority, constituency 120-128, faith fallback
verified   = verified?1:0                             weight 0.10
pinned     = is_pinned? +1000 boost (always top 1)
score = 0.45*recency + 0.25*engagement + 0.20*affinity + 0.10*verified + pinned_boost
```

- `hours_since_created = EXTRACT(EPOCH FROM (now() - created_at))/3600`
- `max` = max `ln(...)` in current window for normalization (computed via `MAX() OVER()` or cached max per day).
- `group_match` = `post.group_name = viewer.group_name` (viewer from JWT `users.group_name` 50-57)
- `constituency`, `faith` similarly.

### 3.3 SQL (single query, indexed)

```sql
WITH viewer AS (SELECT group_name AS vg, constituency AS vc, faith AS vf FROM users WHERE id=:viewer_id),
scored AS (
  SELECT p.id, p.user_id, u.username, u.name, u.verified, p.caption, p.thumb_key, p.blurhash,
         p.likes, p.comments, p.created_at, p.is_pinned,
         EXTRACT(EPOCH FROM (now() - p.created_at))/3600 AS h,
         ln(1 + p.likes + p.comments*3) AS eng_raw
  FROM posts p JOIN users u ON u.id=p.user_id CROSS JOIN viewer
  WHERE p.approved_at IS NOT NULL
  UNION ALL
  SELECT r.id, r.user_id, u.username, u.name, u.verified, r.caption, r.poster_key, NULL,
         r.likes, r.comments, r.created_at, r.is_pinned,
         EXTRACT(EPOCH FROM (now() - r.created_at))/3600,
         ln(1 + r.likes + r.comments*3)
  FROM reels r JOIN users u ON u.id=r.user_id CROSS JOIN viewer
  WHERE r.approved_at IS NOT NULL
),
norm AS (
  SELECT *, MAX(eng_raw) OVER() AS max_eng FROM scored
)
SELECT *, 
  (0.45*exp(-h/72) + 0.25*(CASE WHEN max_eng>0 THEN eng_raw/max_eng ELSE 0 END)
   + 0.20*(CASE WHEN group_name=vg THEN 0.5 WHEN constituency=vc THEN 0.3 WHEN faith=vf THEN 0.2 ELSE 0 END)
   + 0.10*(CASE WHEN verified THEN 1 ELSE 0 END)
   + CASE WHEN is_pinned THEN 1000 ELSE 0 END) AS rank_score,
  thumb_key, -- presign on fly
  (SELECT json_agg(s.*) FROM (SELECT * FROM stories WHERE expires_at>now() ORDER BY created_at DESC LIMIT 20) s) AS stories_top
FROM norm
ORDER BY rank_score DESC, created_at DESC
LIMIT 20 OFFSET :offset; -- or cursor: WHERE rank_score < :cursor_score
```

Indexes:
```sql
CREATE INDEX idx_posts_approved_at ON posts(approved_at DESC);
CREATE INDEX idx_reels_approved_at ON reels(approved_at DESC);
CREATE INDEX idx_posts_group ON posts(group_name);
CREATE INDEX idx_stories_expires ON stories(expires_at);
CREATE INDEX idx_posts_pinned ON posts(is_pinned) WHERE is_pinned;
```

Stories top 51: separate `GET /api/stories` returns 20–50 stories ordered `created_at DESC` but pinned stories first, rendered in `Home` top strip `src/components/Home.tsx:51`. Pagination via `cursor=created_at`.

### 3.4 Hybrid write path

- **Member** `POST /api/media/confirm` → `INSERT INTO pending_queue status='pending'` → admin sees in `GET /api/pending` (replaces `Admin.tsx:17` localStorage pending). Response `202 {queued:true}`.
- **Admin** same endpoint but `if jwt.role='admin'` → directly `INSERT INTO posts/reels/stories ... status='approved'` + enqueue transcode, skip pending. Audit log `action='direct_approve'`.
- **Approve** `POST /api/pending/:id/approve` (admin only) → transaction moves row → `posts|stories|reels|tracks` + delete pending + audit. Reject similar.

---

## 4. API Surface

```
POST   /api/auth/login         {pin} -> {token, role, username}  (mirrors auth.tsx ADMIN_PINS)
POST   /api/media/presign      {type, contentType, bytes, ext} -> {url, fields, key}
POST   /api/media/confirm      {key, type, caption} -> {id, status}
GET    /api/pending            ?status=pending (admin) -> [{id,type,user,caption,thumbUrl,at}]
POST   /api/pending/:id/approve  (admin)
POST   /api/pending/:id/reject   {reason}
GET    /api/feed               ?cursor=&limit=20  -> {posts:[{id,user,verified,loc,time,likes,img,caption,comments,rank_score,blurhash}], nextCursor}
GET    /api/stories            -> {stories:[{id,name,thumb,expires_at}]}
GET    /api/reels              ?cursor=            -> HLS master URLs
GET    /api/tracks             ?q=                 -> tracks + iTunes fallback proxy
POST   /api/likes/:id/toggle   -> {liked, likes}
GET    /api/media/:key         -> 302 presigned GET (15min) — avoids exposing MinIO domain
```

All `thumbUrl/posterUrl/hlsUrl` returned as presigned GETs with `Cache-Control: public,max-age=900` + CDN.

---

## 5. MinIO Deployment (VPS-only)

`docker-compose.yml` (single VPS, KES 1k):

```yaml
services:
  postgres: { image: postgres:16-alpine, environment: {POSTGRES_DB: harvest, POSTGRES_USER: harvest}, volumes: [pgdata:/var/lib/postgresql/data], ports: ["5432:5432"] }
  minio: { image: minio/minio, command: server /data --console-address :9001, environment: {MINIO_ROOT_USER: harvest, MINIO_ROOT_PASSWORD: <gen>}, volumes: [minio:/data], ports: ["9000:9000","9001:9001"] }
  api: { build: ./server, environment: {DATABASE_URL: postgres://..., MINIO_ENDPOINT: minio:9000, MINIO_BUCKET: harvest-media}, ports: ["3000:3000"], depends_on: [postgres,minio] }
  caddy: { image: caddy:alpine, ports: ["80:80","443:443"], volumes: [./Caddyfile:/etc/caddy/Caddyfile] }
```

Caddy reverse-proxies `media.harvestfamily.or.ke -> minio:9000` and `api.harvestfamily.or.ke -> api:3000` with auto TLS.

MinIO SDK `server/src/s3.js` uses `endpoint: process.env.MINIO_ENDPOINT`, `forcePathStyle:true`.

Bootstrap `mc mb harvest-media` + `mc anonymous set none harvest-media` (private).

---

## 6. Frontend Integration Points (file:line refs)

| Frontend | Current | After |
|---|---|---|
| `src/components/PostCreate.tsx:12` `getUser()` + `onSubmit(type,data)` 527 | Fabricates picsum/gtv URL | Calls `presign -> PUT to MinIO -> confirm`. Shows upload progress. `type` radio kept. |
| `src/App.jsx:96` `submitPost` + `src/App.jsx:103` `approve` | Pushes to `harvest_pending` localStorage, `approvedPosts` with `img: picsum` 138/146 | `submitPost` → `POST /api/media/confirm` (member→pending, admin→approved). `approve` → `POST /api/pending/:id/approve`. Removes localStorage pending/approved. |
| `src/components/Home.tsx:25` `approvedStories`/`approvedPosts` useMemo 6-14 | Reads `harvest_approved_*` localStorage, shallow `[...approvedPosts, ...postsBase]` line 34 | `useEffect` fetch `/api/feed` + `/api/stories`. Stories top 51 strip, feed ranked. `blurhash` placeholder while thumb loads. |
| `src/components/Reels.tsx:11` `approvedReels` + `reelsData` 20-24, `autoPlay` 21/346 | Merges localStorage + static gtv mp4 21 | Fetch `/api/reels` (HLS). `hls.js` for `master.m3u8`, poster 266 `poster_key` presigned. Keep `autoPlay muted loop playsInline`. |
| `src/components/Music.tsx:17` iTunes search 646 + SoundHelix 26 | Direct `fetch(itunes)` + static SoundHelix | Keep iTunes tab (proxy via `/api/tracks?q=` to avoid CORS), add Harvest `tracks` table tab that uses MinIO presigned `preview_url`. |
| `src/components/Stories.tsx:8` `auto-advance 4s` | Dots over `allStories` (fix) | Add `expires_at` countdown, `expires_at` returned from API, skip expired client-side. |
| `src/components/Admin.tsx:17` pending list | Reads `pending` prop from App localStorage | Fetch `GET /api/pending` (admin only). Approve/reject call API, audit log shown. |
| `src/state/auth.tsx:3` `Role` | Local PIN check | Add `POST /api/auth/login` → JWT, but keep local PIN as fallback offline. Verified JOIN fix via snapshot. |

---

## 7. Capacity — 500 users ~25 GB/yr

Assumptions (church community, not TikTok):

- 30% post monthly (150 users) × avg 2 posts/mo × 1.2 MB (400w WebP thumb ~60KB + original ~1.1MB) = 360 MB/mo → 4.3 GB/yr images
- 10% post video monthly (50 users) × 1 reel/mo × 18 MB (HLS ladder 360+480+720 avg, original 40 MB but ladder replaces original after transcode? Keep original 40 MB optional) ~ 900 MB/mo → 10.8 GB/yr video (with HLS ladder ~18 MB per reel, original GC option cuts to ~10 GB)
- Stories: 20% daily? 100 users × 0.5 stories/wk × 0.8 MB = 160 MB/mo → 1.9 GB/yr but 24h expiry → effective stored ~ 80 MB rolling
- Tracks: 20 uploads/yr × 5 MB = 0.1 GB
- DB + thumbs + metadata ~ 2 GB/yr
- **Total ~19–25 GB/yr** fits 25 GB SSD with 70% used at year-end. Rotation: archive originals >90d to R2 (optional), keep thumbs/HLS on VPS.

VPS sizing for KES 1k: 1 vCPU handles ~10 concurrent HLS transcodes queued (ffmpeg `veryfast` ~2× realtime, 30s video ~15s transcode). Use BullMQ-lite queue in Node (no Redis — use Postgres `pg-boss` or simple table `jobs` to avoid extra RAM). Cron stories 5 min negligible.

---

## 8. Security & Ops

- Presign: validate `contentType` whitelist `image/jpeg|png|webp`, `video/mp4|quicktime`, `audio/mp3|m4a|wav`. Max bytes enforced via `content-length-range` condition.
- Auth: JWT 7d, refresh via PIN re-login. Admin endpoints check `role==='admin'` (mirrors `Protected.tsx:1` RequireRole).
- MinIO keys never to client except presigned POST fields (scope-limited to one key, 15 min).
- Postgres RLS optional — API enforces, not DB.
- Backups: nightly `pg_dump | gzip -> minio/backups/` + `mc mirror` to R2 if configured. Keep 7 d.
- Monitoring: `GET /health` returns disk `df -h /` %, `pg` ok, `minio` ok. Alert if disk >80% (VPS small).

---

## 9. Migration Path (no big bang)

1. Deploy `server/` + MinIO + Postgres alongside current frontend (frontend still reads localStorage fallback).
2. Feature-flag `VITE_USE_API=true` — `PostCreate` tries presign, fallback to picsum if offline.
3. Backfill `harvest_pending`/`harvest_approved_*` from localStorage via `POST /api/migrate` (admin).
4. Switch `Home` to `GET /api/feed` when flag on; keep `postsBase` as empty-state if API 0 rows.
5. After 30d, deprecate localStorage keys (keep read, stop write).

---

## 10. File Map (implemented)

```
server/
  docker-compose.yml
  Caddyfile
  package.json
  src/index.js          # Fastify bootstrap
  src/db.js             # pg Pool
  src/s3.js             # MinIO client + presign helpers
  src/routes/media.js   # presign + confirm
  src/routes/feed.js    # ranked feed SQL
  src/routes/pending.js # queue + approve/reject + audit
  src/workers/thumb.js
  src/workers/transcode.js
  src/workers/cronStories.js
  src/feed/rank.js      # JS rank fallback for tests
  migrations/001_init.sql
  migrations/002_media.sql
docs/MEDIA_PIPELINE_AND_RANKED_FEED.md (this file)
```

See `server/README.md` for run instructions.

