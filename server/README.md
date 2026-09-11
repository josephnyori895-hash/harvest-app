# Harvest Family API — VPS-only (KES 1k)

MinIO `harvest-media` + Postgres + Fastify. See `../docs/MEDIA_PIPELINE_AND_RANKED_FEED.md` for full spec.

## Quick start (VPS or local)

```bash
cp .env.example .env   # set MINIO_SECRET_KEY, JWT_SECRET
docker compose up -d --build
docker compose logs -f api
```

Endpoints: `POST /api/auth/login`, `POST /api/media/presign`, `POST /api/media/confirm`, `GET /api/feed`, `GET /api/pending` etc.

## Workers

On 1 vCPU VPS run workers in same container or separate:

```bash
node src/workers/thumb.js      # 400w WebP blurhash
node src/workers/transcode.js  # HLS 360/480/720 + poster 266 (needs ffmpeg)
node src/workers/cronStories.js # purge expires_at 24h every 5m
```

Systemd: `server/systemd/*.service` (optional).

## Frontend flag

```bash
VITE_API_URL=https://api.harvestfamily.or.ke
VITE_USE_API=true npm run dev
```

When `VITE_USE_API` off, frontend keeps localStorage fallback (current shallow).

## Deploy (VPS-only KES 1k)

See `../docs/DEPLOY_VPS.md` for full ops: Caddy reverse_proxy `dist + api:3000 + minio:9000`, TLS free domain (LE or CF tunnel if .tk), `docker compose up`.

```bash
cp .env.example .env  # set DOMAIN, MINIO_SECRET_KEY, JWT_SECRET, COTURN, R2
npm run build         # dist/ for Caddy /srv
docker compose up -d --build
./scripts/mc-setup.sh && ./scripts/backup.sh
sudo cp backup.cron /etc/cron.d/harvest-backup
```

Caddy: `Caddyfile` (LE) or `Caddyfile.tk-cloudflared` with `docker compose --profile tunnel up -d` if .tk LE blocked. Coturn `host` mode `3478/5349` (`coturn.conf`).

## Backup / RTO (RPO 24h / RTO 2-4h)

Nightly `02:00 EAT` cron (`backup.cron:1`) -> `scripts/backup.sh:1`:

```bash
./scripts/mc-setup.sh  # myminio + r2 aliases (once)
./scripts/backup.sh    # pg_dump gzip 7d rotate + mc mirror --exclude "hls/*/*.ts" -> R2 1GB free
./scripts/restore.sh --full --from-r2   # RTO 2-4h rehydrate
```

`mc mirror --overwrite --exclude "hls/*/*.ts" myminio/harvest-media r2/harvest-media` keeps offsite ~1 GB (thumbs/posters/m3u8 + dumps, .ts regenerable). Provider snapshot weekly Sundays 03:00 EAT.
