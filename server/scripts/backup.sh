#!/usr/bin/env bash
# backup.sh — nightly pg_dump 02:00 EAT + mc mirror harvest-media -> R2 (RPO 24h, RTO 2-4h)
# VPS-only, no extra cost. R2 free tier 10GB (we use ~1GB: DB dumps + thumbs/posters, exclude .ts)
# Called by cron: 0 2 * * * /opt/harvest/server/scripts/backup.sh >> /var/log/harvest-backup.log 2>&1
# EAT = UTC+3 -> 02:00 EAT = 23:00 UTC previous day. Host cron uses Africa/Nairobi TZ or 0 23 UTC.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
STAMP="$(date +%F)"
TS="$(date +%F_%H%M%S_EAT)"
BACKUP_DIR="${BACKUP_DIR:-$DIR/backups}"
mkdir -p "$BACKUP_DIR"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

log(){ echo "[$(date '+%F %T %Z')] $*"; }
tg(){
  if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
    curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" -d chat_id="$TELEGRAM_CHAT_ID" -d parse_mode=Markdown -d text="$1" >/dev/null || true
  fi
}

log "=== backup $TS ==="

# --- 1) pg_dump (postgres:16-alpine) -> gzip ---
# Prefer docker compose exec (no host pg client needed)
COMPOSE="docker compose"
if ! $COMPOSE ps postgres >/dev/null 2>&1; then COMPOSE="docker-compose"; fi
PG_DUMP_FILE="$BACKUP_DIR/pg-${STAMP}.sql.gz"
if $COMPOSE exec -T postgres pg_dump -U harvest -d harvest | gzip -c > "$PG_DUMP_FILE.tmp"; then
  mv "$PG_DUMP_FILE.tmp" "$PG_DUMP_FILE"
  SIZE="$(du -h "$PG_DUMP_FILE" | cut -f1)"
  log "pg_dump OK $PG_DUMP_FILE ($SIZE)"
else
  log "pg_dump FAIL"
  tg "🚨 harvest backup FAILED: pg_dump $STAMP"
  exit 1
fi

# rotate local pg dumps (keep 7d)
find "$BACKUP_DIR" -name 'pg-*.sql.gz' -mtime +$RETENTION_DAYS -delete || true

# also push latest dump into MinIO bucket for offsite (so mc mirror picks it up or direct upload)
# bucket harvest-media/backups/
if command -v mc >/dev/null 2>&1 && mc alias list 2>/dev/null | grep -q "myminio"; then
  mc cp "$PG_DUMP_FILE" myminio/harvest-media/backups/ 2>&1 | log || true
  log "push pg dump to minio backups/ OK"
fi

# --- 2) mc mirror MinIO harvest-media -> R2 (offsite) ---
# Setup: ./scripts/mc-setup.sh (aliases myminio + r2)
# R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET env (see .env)
# We mirror incrementally, exclude HLS .ts segments (regenerable, save 80% bandwidth & R2 1GB budget)
# Include: originals/, thumbs/, posters/, hls/*.m3u8, backups/
if command -v mc >/dev/null 2>&1; then
  if mc alias list 2>/dev/null | grep -q "r2"; then
    log "mc mirror myminio/harvest-media -> r2/${R2_BUCKET:-harvest-media} (exclude hls/*.ts)"
    set +e
    mc mirror --overwrite --exclude "hls/*/*.ts" myminio/harvest-media "r2/${R2_BUCKET:-harvest-media}" 2>&1 | log
    RC=$?
    set -e
    if [[ $RC -eq 0 ]]; then
      log "mc mirror OK"
    else
      log "mc mirror FAIL rc=$RC"
      tg "⚠️ harvest mirror FAILED rc=$RC $STAMP — check R2 creds/network"
    fi
  else
    log "mc alias r2 not configured — skipping mirror (run ./scripts/mc-setup.sh). Local dump retained."
  fi
else
  log "mc not installed — skipping mirror. Install: curl https://dl.min.io/client/mc/release/linux_amd64/mc -o /usr/local/bin/mc && chmod +x"
fi

# --- 3) disk / health check ---
df -h / | log
USED_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [[ "$USED_PCT" -gt 80 ]]; then
  log "WARN disk ${USED_PCT}% >80%"
  tg "⚠️ harvest VPS disk ${USED_PCT}% — prune: docker system prune / minio GC old originals >90d"
fi

# ping health endpoint + notify on failure
if curl -sf http://localhost:3000/health >/dev/null 2>&1 || curl -sf http://localhost/health >/dev/null 2>&1; then
  log "health OK"
else
  log "health FAIL"
  tg "🚨 harvest API health FAIL $STAMP"
fi

log "=== backup done $TS ==="
# optional success ping (quiet unless verbose)
# tg "✅ harvest backup OK $STAMP pg:$SIZE"
