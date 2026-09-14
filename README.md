# Harvest Family Church — Nyeri

Instagram-style church community app for Harvest Family Church Nyeri — posts, reels, stories, groups, chat, live, music, map, and giving.

## Stack
- **Frontend:** React 19 + Vite 8 + Tailwind + Capacitor Android
- **Backend:** Fastify + Netlify Functions
- **Database:** Netlify Database / PostgreSQL
- **Media:** Netlify Blobs / S3-compatible storage
- **Payments:** M-Pesa Daraja integration
- **Hosting:** Netlify

The production frontend and API are served from the same site. `/api/*` is rewritten to the Netlify Function defined under `server/netlify/functions`.

## Local development

```bash
npm install
npm run dev

# backend dependencies
npm install --prefix server
```

For local backend development, copy `server/.env.example` to `server/.env` and provide the required values. Do not commit `.env` files or production secrets.

## Production build

```bash
npm run build
```

Netlify uses the repository `netlify.toml` configuration. The build installs backend dependencies before building the Vite frontend, and publishes `dist/`.

## Capacitor Android

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Production configuration

The frontend defaults to the same-origin `/api` endpoint in production. Keep `VITE_USE_API=true` (or unset it, since production defaults to the real API) and leave `VITE_API_URL` empty unless a separate API host is intentionally used.

Required backend configuration includes:
- `NETLIFY_DB_URL` or a configured Netlify Database connection
- `JWT_SECRET`
- `ADMIN_PIN_HASHES` (bcrypt hashes, never plaintext PINs)
- `CORS_ORIGINS`
- M-Pesa credentials and public `MPESA_CALLBACK_URL` when giving is enabled

Apply database migrations before relying on production data. Never put these secrets in GitHub source files.

## Security / demo mode

Demo account switching is development-only. Production authorization must come from the backend/JWT rather than localStorage values. The browser may retain a short-lived token/session identifier, but must not be treated as the authority for roles or permissions.

## CI

GitHub Actions validates the frontend build, installs backend dependencies, syntax-checks backend and Netlify modules, and syncs Capacitor Android.

## Deployment

Pushes to `main` trigger the connected Netlify project when production builds are active and the team's credit balance permits deployment. After configuring environment variables and the database, run a production smoke test against `/api` and the main application flows.

---
Harvest Family Church Nyeri • 2026
