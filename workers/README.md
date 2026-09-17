# Harvest Family — Cloudflare Workers Backend

Port of `server/` (Fastify + Netlify Blobs + socket.io + Postgres) to a **$0/month Cloudflare stack**:

| Old (server/) | New (workers/) |
|---|---|
| Fastify routes | Plain `fetch` router (`src/index.js` + `src/routes/*`) |
| Postgres (Netlify DB) | **D1** SQLite (`migrations/0001_schema.sql`, consolidated from 9 pg migrations) |
| Netlify Blobs media | **R2** bucket `harvest-media` (direct presigned uploads, proxy fallback) |
| socket.io on VPS | **Durable Object** `Realtime` (native WebSockets, hibernation) |
| Netlify scheduled cleanup | Workers **Cron** `*/10 * * * *` (`scheduled()`) |
| jsonwebtoken | WebCrypto HS256 (`src/lib/crypto.js`) — wire-compatible tokens |
| bcryptjs password hashing | **PBKDF2-SHA256** 100k iters (bcrypt cannot run on Workers) |
| ADMIN_PIN_HASHES bcrypt | Still bcrypt, via `bcryptjs` (admin bootstrap claim path only) |

The app is **mobile-only** — the APK ships the whole frontend; this Worker is the backend.

## Deploy from scratch

```bash
cd workers
npm install

# 1) Create resources (needs CLOUDFLARE_API_TOKEN or an interactive wrangler login)
npm run cf:provision          # creates D1 `harvestfamily` + R2 `harvest-media`, patches wrangler.toml

# 2) Schema + seeds (creates admin user `allan`)
npm run db:migrate            # wrangler d1 migrations apply DB --remote

# 3) Secrets
npx wrangler secret put JWT_SECRET        # openssl rand -base64 48

# Optional — direct-to-R2 presigned uploads (otherwise uploads proxy through the Worker)
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

# Optional — M-Pesa giving
npx wrangler secret put MPESA_ENV            # "production" or omit for sandbox
npx wrangler secret put MPESA_CONSUMER_KEY
npx wrangler secret put MPESA_CONSUMER_SECRET
npx wrangler secret put MPESA_SHORTCODE
npx wrangler secret put MPESA_PASSKEY
npx wrangler secret put MPESA_CALLBACK_URL   # https://<workers-domain>/api/giving/mpesa/callback

# 4) Deploy
npm run deploy               # wrangler deploy → https://harvestfamily-api.<subdomain>.workers.dev
```

## Verify

```bash
curl https://harvestfamily-api.<subdomain>.workers.dev/health
# {"status":"ok","db":"ok","storage":"cloudflare-r2","database":"cloudflare-d1"}

# register → login → feed smoke test
curl -X POST https://...workers.dev/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"testuser","name":"Test User","phone":"0712345678","password":"password123","group_name":"Harvest Central"}'
curl -X POST https://...workers.dev/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"password123"}'
curl https://...workers.dev/api/feed
```

## Realtime (chat, presence, calls)

- Endpoint: `wss://<workers-domain>/ws?token=<JWT>`
- Protocol: JSON frames `{ event, data, ackId? }` → server replies `{ event: '__ack', ackId, payload }`
- Events ported 1:1 from socket.io: `chat:send`, `chat:join`, `group:join`, `message:delivered`,
  `message:seen`, `typing:start/stop`, `group:invite`, `group:invite:approve`,
  `call:offer/answer/ice/end/decline`; server pushes `chat:message`, `typing`,
  `presence:update`, `presence:snapshot`, `message:delivered`, `message:seen`, `group:invite:*`
- Fan-out is by username via the DO's socket registry; conversation membership is validated in D1.
- The frontend client (`src/lib/realtime.ts`) implements the same protocol with automatic
  reconnect + exponential backoff.

## WebRTC calls (honest limitation)

STUN-only by default (Google STUN included). Cloudflare has **no free TURN**. On symmetric NAT
(common on Kenyan mobile networks) calls may fail. Options:
1. Keep coturn on the future VPS → set `VITE_COTURN_HOST/USER/PASS` at build time (client already supports it).
2. Cloudflare Calls (~$5/mo) as a managed TURN alternative.

Everything else (feed, chat, groups, giving, admin) has no such dependency.

## D1 notes

- UUIDs are TEXT, generated in JS (`crypto.randomUUID()`).
- Timestamps are ISO-8601 TEXT — lexicographic comparison equals chronological comparison.
- Booleans are 0/1 (`lib/db.js#bool` normalizes when reading).
- `meta`/`metadata` JSON columns are TEXT holding JSON strings.
- Consolidated schema in ONE migration (`migrations/0001_schema.sql`) — fresh databases only
  (the Netlify Postgres data, if any, would need a separate one-time copy).

## APK build (frontend)

```bash
# from repo root
VITE_API_URL=https://harvestfamily-api.<subdomain>.workers.dev \
VITE_REALTIME_URL=https://harvestfamily-api.<subdomain>.workers.dev \
npm run build
npx cap sync android
cd android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleRelease
```

CORS is pre-configured for the Capacitor WebView origins (`https://localhost`,
`capacitor://localhost`) in `wrangler.toml` `[vars]`.
