# Harvest Family Church — Nyeri

Instagram-style church community app • Vite 8 + React 19 + Capacitor 8.5 + Tailwind

Built for Harvest Family Church Nyeri — posts, reels, stories, groups, chat, live, music, map, giving.

## Stack
- **Frontend**: React 19 + Vite 8.2 + Tailwind 3.4 + Capacitor Android
- **Backend**: FastAPI :3000 + Postgres 16 + Redis + MinIO :9000 + Socket.IO + Coturn (WebRTC)
- **Infra**: Caddy + Docker Compose • Netlify-ready frontend

## Quick Start
```bash
npm install
npm run dev          # http://localhost:5173

# backend
cd server
cp .env.example .env # fill secrets
docker compose up -d
npm start            # :3000
```

## Build APK (Capacitor)
```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Features
- **Admin as ROLE** — admin/leader/member/guest (no separate admin page)
- **Stories** — immersive full-screen, auto-advance, stickers, music moods, 24h expiry
- **Posting** — rich text, music via iTunes, scheduling (admins)
- **Music** — church categories worship/choir/hymn/praise
- **Groups** — GroupDetails + UserListModal with admin add/remove/role-cycle
- **Giving** — fund manager + transaction verification
- **Chat** — socket.io + WebRTC via Coturn :3478/:5349
- **Map** — harvest locations (Leaflet)
- **IG Switcher** — 4 accounts: allan(admin) | youth_harvest | worship_team | pst.simon

## Deploy
- **Frontend**: `npm run build` → deploy `dist/` to Netlify / VPS
- **Backend VPS**: `server/docker-compose.yml` + Caddy + MinIO + Postgres + Redis
- Backups: 6h cron + R2 offsite mirror

## Env
See `server/.env.example` — never commit `.env`.

---
Harvest Family Church Nyeri • 2026
