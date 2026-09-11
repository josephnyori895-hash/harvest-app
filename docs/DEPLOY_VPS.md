# Harvest Family — VPS-only Deploy (KES 1k/mo) — Caddy + compose + RPO 24h

> Budget: **KES 1,000/mo fixed**. No managed DB/S3/Redis/transcode SaaS. Offsite is Cloudflare R2 free tier (10 GB free, we use ~1 GB). Cost stays VPS-only.

VPS target: 1 vCPU, 1–2 GB RAM, 25–40 GB SSD, 1 TB BW (Contabo VPS S / Hetzner CX11 / Hostinger KVM1). 500 users fits ~25 GB/yr media (docs/MEDIA_PIPELINE_AND_RANKED_FEED.md:7).

---

## 1. Architecture (single VPS, docker compose up)

```
Internet --443/80--> Caddy (caddy:2-alpine, auto TLS) --\
                    |-- apex harvestfamily.or.ke  -> /srv (../dist) SPA + try_files /index.html
                    |-- api.harvestfamily.or.ke   -> api:3000 (Fastify + socket.io, server/src/index.js:88)
                    |-- media.harvestfamily.or.ke -> minio:9000 (harvest-media, server/src/s3.js:10)
                    \-- /socket.io/*               -> api:3000 (realtime io.js)
postgres:16-alpine (pgdata) -- api only, 127.0.0.1:5432
minio (minio_data)  -- 9000 internal, 9001 console 127.0.0.1
redis:7-alpine      -- 127.0.0.1:6379, 64 MB LRU
coturn:alpine host mode 3478/5349 UDP+TCP (server/coturn.conf:3) — for Nyeri 3G symmetric NAT
cloudflared (optional --profile tunnel) for free .tk when LE/80 blocked
```

`server/docker-compose.yml:1` is `docker compose up -d` single command. All state in volumes `pgdata`, `minio_data`, `caddy_data` — snapshotted via provider + nightly pg_dump.

---

## 2. Domain + TLS (free domain)

### Option A — Standard LE (recommended): `harvestfamily.or.ke` or any Freenom .ml/.ga that LE trusts

1. DNS: `A @ -> VPS_IP`, `A api -> VPS_IP`, `A media -> VPS_IP` (or wildcard `A *.`).
2. Wait DNS propagate (`dig +short harvestfamily.or.ke`).
3. On VPS: `DOMAIN=harvestfamily.or.ke docker compose up -d caddy` — Caddy auto ACME on 80->443 (`server/Caddyfile:1`). No certbot needed.

Check: `curl -v https://api.harvestfamily.or.ke/health` -> `{"status":"ok"}`.

### Option B — Free .tk when LE or port 80 is blocked (Freenom .tk often rate-limited by LE)

CF Tunnel avoids inbound 80/443 entirely. Use `server/Caddyfile.tk-cloudflared:1`:

1. Cloudflare dashboard: add `harvestfamily.tk` -> CF NS, create Zero Trust Tunnel, copy `TUNNEL_TOKEN`.
2. In Tunnel dashboard -> Public Hostnames: `harvestfamily.tk -> http://caddy:80`, `api.harvestfamily.tk -> http://caddy:80`, `media.harvestfamily.tk -> http://caddy:80`.
3. VPS `.env`: `DOMAIN=harvestfamily.tk` + `TUNNEL_TOKEN=ey...`.
4. `cp Caddyfile.tk-cloudflared Caddyfile && docker compose --profile tunnel up -d` — TLS terminates at CF edge, origin is HTTP only, no LE needed.

Cost stays VPS-only (CF tunnel free). LE still attempted if Caddyfile standard used — tunnel is fallback.

---

## 3. First deploy (15 min)

```bash
# on VPS (Ubuntu 22.04)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin caddy ufw mc || true
sudo ufw allow 22,80,443/tcp && sudo ufw allow 3478,5349,5349/udp && sudo ufw allow 3478/udp && sudo ufw enable

git clone <repo> /opt/harvest
cd /opt/harvest
# frontend build -> dist served by Caddy
npm ci && npm run build   # produces dist/
# or local build then scp dist to VPS

cd server
cp .env.example .env
# edit: MINIO_SECRET_KEY (32 chars), JWT_SECRET, DOMAIN, COTURN_HOST, COTURN_PASSWORD
openssl rand -hex 16  # for MINIO_SECRET_KEY / COTURN_PASSWORD
openssl rand -hex 32  # for JWT_SECRET
nano .env

# optional R2 offsite (see §5)
# R2_ENDPOINT= https://<id>.r2.cloudflarestorage.com + access/secret from CF R2 dashboard

docker compose up -d --build
docker compose ps
curl -sf http://localhost:3000/health && curl -sf http://localhost:80/health || docker compose logs api

# mc aliases
./scripts/mc-setup.sh
# verify bucket private
mc ls myminio/harvest-media
```

Caddy logs: `docker compose logs -f caddy` — expect `certificate obtained` (Option A) or `http://caddy:80` (Option B tunnel).

Coturn host mode check: `ss -tulpn | grep 3478` + `turnutils_uclient -v -u harvest -w $COTURN_PASSWORD <VPS_IP>` (from Nyeri 3G device expect relay).

---

## 4. Backups — RPO 24h / RTO 2–4h

### RPO 24h (nightly)

- Cron `server/backup.cron:14` runs `server/scripts/backup.sh:1` at **02:00 EAT** (=23:00 UTC). Host TZ `Africa/Nairobi` or alt `0 23 UTC`.
- Steps `backup.sh:19`:
  1. `docker compose exec -T postgres pg_dump -U harvest | gzip -c > backups/pg-YYYY-MM-DD.sql.gz` (7-day local rotation) + `mc cp` to `myminio/harvest-media/backups/` (so mirror picks it up).
  2. `mc mirror --overwrite --exclude "hls/*/*.ts" myminio/harvest-media r2/harvest-media` — incremental, excludes regenerable HLS .ts segments to stay within R2 free 1 GB (thumbs/posters/m3u8 + dumps only ~400 MB/yr; full .ts would be ~10 GB/yr).
  3. Disk/health check: `df -h /` warns >80%, `curl /health` alerts Telegram on fail (existing 4 daemon bot reused via `TELEGRAM_BOT_TOKEN` in `.env`).

Install cron:

```bash
sudo cp server/backup.cron /etc/cron.d/harvest-backup
sudo chmod 644 /etc/cron.d/harvest-backup
sudo mkdir -p /var/log && touch /var/log/harvest-backup.log
# user crontab alternative:
# crontab -e  ->  0 2 * * * TZ="Africa/Nairobi" /opt/harvest/server/scripts/backup.sh >> /var/log/harvest-backup.log 2>&1
```

### R2 free 1 GB budget

| Object | Avg/yr | Kept offsite |
|---|---|---|
| pg dumps gz (7d rolling) | ~50 MB | full |
| originals/ (uploaded) | ~15 GB raw | **not all** — first 1 GB or last 90d only if budget tight; primary is VPS. Mirror `--exclude` opts trade RPO for cost. Default excludes `hls/*.ts` only, originals still mirror (fits 10 GB free; 1 GB is conservative note for ultra-free). If R2 1 GB hard cap, add `--exclude "originals/video/*"` and keep only thumbs/posters + dumps. |
| thumbs/*.webp + posters/*.jpg | ~400 MB | full |
| hls/*.m3u8 | ~5 MB | full |
| hls/*.ts | ~10 GB if kept | **excluded** — regenerable via `transcode.js` from originals |

With exclude .ts, nightly delta is typically <50 MB, fits R2 free indefinitely.

### RTO 2–4h

Provider snapshot (Contabo/Hetzner panel weekly Sunday 03:00 EAT) restores VM in ~30 min (volume pgdata + minio_data). If provider snapshot unavailable, `scripts/restore.sh:1` rehydrates:

```bash
# full DR to new KES 1k VPS
# 1. new VPS, install docker, git clone, docker compose up -d postgres minio
./scripts/mc-setup.sh                # re-alias r2
./scripts/restore.sh --full --from-r2   # pulls latest pg dump + mirror media ~1–2h depending BW
docker compose up -d --build api caddy
# 2. check
curl https://api.harvestfamily.or.ke/health
```

Detailed: `server/scripts/restore.sh:19` does `DROP DATABASE harvest; CREATE DATABASE` + `gunzip -c pg-*.gz | psql`, then `mc mirror r2/harvest-media -> myminio/harvest-media`. Missing `hls/*.ts` flagged for `node src/workers/transcode.js --retry-failed` (reels re-transcode, queued, ~2× realtime).

---

## 5. MinIO R2 offsite wiring

```bash
# CF dashboard -> R2 -> Create bucket harvest-media -> Manage -> R2 API Tokens -> Create
# Endpoint: https://<account-id>.r2.cloudflarestorage.com (shown in bucket overview)
# Put in server/.env:
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=harvest-media

# on VPS
cd /opt/harvest/server
./scripts/mc-setup.sh
mc mirror --dry-run myminio/harvest-media r2/harvest-media  # verify
./scripts/backup.sh  # first manual run
mc ls r2/harvest-media/backups/ --recursive | head
```

---

## 6. Monitoring — Telegram (reuse 4 daemons)

- Existing bot daemons already monitor `@harvestfamily` channels. Add health check: `backup.cron:23` pings `/health` every 6h and `backup.sh:76` TG alerts on `pg_dump`/`health` fail.
- `GET /health` (`server/src/index.js:76`) returns `pg:ok`, `bucket`, `uptime`. UptimeRobot free can hit `https://api.harvestfamily.or.ke/health` for external check (optional, not in KES 1k budget).

Logs: `docker compose logs -f api caddy | grep -E "WARN|ERROR"` + `journalctl -u docker | tail`.

Disk guard: `backup.sh` warns TG at >80% (VPS 25 GB fills ~year). Mitigation: `docker system prune -af` + MinIO lifecycle `mc ilm add --expiry-days 90 myminio/harvest-media --prefix originals/video/` (optional archive to R2).

---

## 7. Coturn 3478/5349 host mode

`server/coturn.conf:3` + `docker-compose.yml:coturn` uses `network_mode: host` (required for UDP relay). Same VPS, no extra cost.

- `3478` (TURN UDP/TCP) + `5349` (TURNS TLS) open in `ufw` and provider firewall.
- `external-ip` auto via `COTURN_EXTERNAL_IP=AUTO` or set `COTURN_HOST` public IP (detect: `curl -s ifconfig.me`).
- Mobile Nyeri 3G symmetric NAT: `lt-cred-mech` + `user=harvest:$COTURN_PASSWORD`, `realm=harvestfamily.or.ke`. Client uses `turns:harvestfamily.or.ke:5349` (`server/src/index.js:53`).

Test: `turnutils_uclient -p 3478 -u harvest -w <pw> -v <VPS_IP>` from outside.

If certs needed for TURNS: mount `caddy_data/caddy/certificates/...` to `/etc/coturn/certs` and uncomment `cert=`/`pkey=` in `coturn.conf:21`.

---

## 8. Cost stays VPS-only

| Item | Cost/mo | Notes |
|---|---|---|
| VPS 1 vCPU 1 GB 25 GB SSD 1 TB BW | **KES 1,000** (~$7) | Contabo/Hetzner/Hostinger. Single fixed bill. |
| Domain .or.ke | ~KES 1,500/yr (optional) | Or free `.tk/.ml/.ga` via Freenom + CF tunnel (LE fallback). Free domain requested in spec. |
| Cloudflare Tunnel | **0** | Free. Used if .tk LE blocked. |
| Cloudflare R2 offsite | **0** (10 GB free) | We budget 1 GB; fits even free .ts-excluded. No egress fee. |
| Let's Encrypt TLS (Caddy) | **0** | Auto via Caddy. |
| Coturn, Postgres, MinIO, Redis, API | **0** | On same VPS, Docker. |
| Telegram monitoring | **0** | Reuse existing 4 daemons. |
| **Total** | **KES 1,000** (+ domain optional) | No scaling surprise. |

At 500 DAU, BW ~1 TB covers HLS ~480p adaptive via Caddy (not Cloudflare cache). If BW exceeds, enable CF cache for `media.*` (free) but keep origin VPS.

---

## 9. File map

```
server/docker-compose.yml      # Caddy + api + postgres + minio + redis + coturn + cloudflared(profile)
server/Caddyfile               # apex + api.* + media.* TLS via LE
server/Caddyfile.tk-cloudflared# :80 only, used with --profile tunnel for .tk free
server/coturn.conf             # 3478/5349 host mode
server/.env.example            # DOMAIN, TUNNEL_TOKEN, R2, COTURN, JWT, TELEGRAM
server/scripts/backup.sh       # 02:00 EAT pg_dump + mc mirror (RPO 24h)
server/scripts/restore.sh      # RTO 2-4h rehydrate
server/scripts/mc-setup.sh    # alias myminio + r2
server/backup.cron             # /etc/cron.d install + 6h health ping
docs/DEPLOY_VPS.md             # this file
dist/                          # vite build, mounted /srv in Caddy
```

---

## 10. Snapshot (provider) + verify

- Weekly snapshot: provider panel -> Snapshots -> Create (Sunday 03:00 EAT). Name `harvest-YYYY-MM-DD`. Keep 2 snapshots (oldest pruned). Restore test quarterly: spin temp VPS from snapshot, `docker compose ps` check.
- Verify backups weekly: `mc ls myminio/harvest-media/backups/` + `ls -lh server/backups/` + `mc ls r2/harvest-media/backups/` should match, latest within 24h.
- Drill: `docker compose down -v && ./scripts/restore.sh --from-backup backups/pg-latest.sql.gz` on staging VPS.

---

## 11. Quick checklist (paste to VPS)

```bash
DOMAIN=harvestfamily.or.ke   # or .tk
echo $DOMAIN
dig +short $DOMAIN; dig +short api.$DOMAIN; dig +short media.$DOMAIN
docker compose --env-file .env up -d --build && docker compose ps
./scripts/mc-setup.sh && ./scripts/backup.sh && mc ls r2/harvest-media/backups/ | tail
sudo cp backup.cron /etc/cron.d/harvest-backup && cat /etc/cron.d/harvest-backup
curl -sk https://api.$DOMAIN/health | head; curl -sk https://$DOMAIN/ | head -c 200
ss -tulpn | grep -E '3478|5349|80|443'
```
