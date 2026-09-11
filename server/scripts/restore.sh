#!/usr/bin/env bash
# restore.sh — RTO 2-4h: rehydrate VPS from nightly backups (pg_dump + R2 mirror)
# Scenarios: (a) VPS dies -> new KES 1k VPS, (b) pgdata corrupt, (c) minio data loss
# Usage:
#   ./scripts/restore.sh --from-backup backups/pg-YYYY-MM-DD.sql.gz
#   ./scripts/restore.sh --from-r2                 # pull latest pg dump from r2/harvest-media/backups/
#   ./scripts/restore.sh --mirror-r2-to-minio      # rehydrate media objects (thumbs/posters/originals)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

usage(){ cat <<'USAGE'
Usage:
  ./scripts/restore.sh --from-backup <path.gz>   restore postgres from local gzip
  ./scripts/restore.sh --from-r2                 pull latest pg dump from R2 then restore
  ./scripts/restore.sh --mirror-r2-to-minio      mc mirror r2/harvest-media -> myminio/harvest-media
  ./scripts/restore.sh --full --from-r2          both DB + media (full DR)
USAGE
}

PG_FILE=""
FROM_R2=false
MIRROR=false
FULL=false
while [[ $# -gt 0 ]]; do case "$1" in
  --from-backup) PG_FILE="$2"; shift 2;;
  --from-r2) FROM_R2=true; shift;;
  --mirror-r2-to-minio) MIRROR=true; shift;;
  --full) FULL=true; shift;;
  -h|--help) usage; exit 0;;
  *) echo "unknown $1"; usage; exit 1;;
esac; done
if $FULL; then FROM_R2=true; MIRROR=true; fi

log(){ echo "[$(date '+%F %T')] $*"; }

# --- 1) restore postgres ---
if $FROM_R2 || [[ -n "$PG_FILE" ]]; then
  if $FROM_R2; then
    if ! command -v mc >/dev/null 2>&1; then echo "mc not found"; exit 1; fi
    LATEST=$(mc ls "r2/${R2_BUCKET:-harvest-media}/backups/" 2>/dev/null | grep "pg-" | sort | tail -1 | awk '{print $NF}')
    if [[ -z "$LATEST" ]]; then echo "no pg dumps in r2/backups/"; exit 1; fi
    PG_FILE="/tmp/${LATEST}"
    log "pulling r2 back $LATEST -> $PG_FILE"
    mc cp "r2/${R2_BUCKET:-harvest-media}/backups/${LATEST}" "$PG_FILE"
  fi
  if [[ ! -f "$PG_FILE" ]]; then echo "file not found $PG_FILE"; exit 1; fi
  log "restoring postgres from $PG_FILE (compose down postgres volume optional)"
  # Option A: live restore (drop+recreate) without destroying pgdata
  # pg_restore via psql: gunzip dump | psql
  # Requires DB reachable. If pgdata was wiped, `docker compose up -d postgres` will recreate empty DB first.
  docker compose up -d postgres
  sleep 5
  log "waiting postgres healthy..."
  for i in 1 2 3 4 5 6; do docker compose exec -T postgres pg_isready -U harvest && break; sleep 3; done
  # terminate connections, drop+recreate harvest DB then restore
  # Use postgres maintenance DB to run drop
  log "dropping/creating harvest DB..."
  docker compose exec -T postgres psql -U harvest -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='harvest' AND pid<>pg_backend_pid();" || true
  docker compose exec -T postgres psql -U harvest -d postgres -c "DROP DATABASE IF EXISTS harvest;" || true
  docker compose exec -T postgres psql -U harvest -d postgres -c "CREATE DATABASE harvest OWNER harvest;" || true
  log "importing dump..."
  gunzip -c "$PG_FILE" | docker compose exec -T postgres psql -U harvest -d harvest
  log "postgres restore OK"
fi

# --- 2) rehydrate MinIO from R2 ---
if $MIRROR || $FULL; then
  if ! command -v mc >/dev/null 2>&1; then echo "mc not found"; exit 1; fi
  if ! mc alias list | grep -q "myminio"; then echo "run ./scripts/mc-setup.sh first"; exit 1; fi
  log "mirror r2/${R2_BUCKET:-harvest-media} -> myminio/harvest-media (this rehydrates originals/thumbs/posters/m3u8)"
  # .ts segments excluded in backup mirror, so HLS will be missing segments -> need re-transcode for affected reels
  # After mirror, flag reels with missing segments for transcode retry:
  mc mirror --overwrite "r2/${R2_BUCKET:-harvest-media}" myminio/harvest-media
  log "mc mirror done. Ensuring bucket exists + checking media count:"
  mc ls myminio/harvest-media --recursive | head -n 20 || true
  log "NOTE: reels missing hls/*.ts need transcode: run node src/workers/transcode.js --retry-failed or re-upload originals trigger"
fi

log "restore finished. Next: docker compose up -d --build api caddy redis && docker compose logs -f api"
