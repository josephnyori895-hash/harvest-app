#!/usr/bin/env bash
# mc-setup.sh — alias myminio (VPS) + r2 (Cloudflare R2 offsite, free 10GB -> we use 1GB)
# Idempotent. Run once on VPS after docker compose up.
# Env: MINIO_ACCESS_KEY, MINIO_SECRET_KEY, R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$DIR/.env" ]]; then set -a; source "$DIR/.env"; set +a; fi

if ! command -v mc >/dev/null 2>&1; then
  echo "mc not found. Install:"
  echo "  curl -sSL https://dl.min.io/client/mc/release/linux_amd64/mc -o /usr/local/bin/mc && chmod +x /usr/local/bin/mc"
  exit 1
fi

# 1) myminio alias (local MinIO on same VPS)
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-harvest}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-harvest1234567890}"
echo "[mc] alias myminio -> http://localhost:9000"
mc alias set myminio http://localhost:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" || true
mc mb myminio/harvest-media --ignore-existing || true
# bucket private — presigned GET only
mc anonymous set none myminio/harvest-media || true
mc ls myminio/harvest-media || true

# 2) r2 alias (offsite free)
if [[ -n "${R2_ENDPOINT:-}" && -n "${R2_ACCESS_KEY:-}" ]]; then
  echo "[mc] alias r2 -> $R2_ENDPOINT bucket ${R2_BUCKET:-harvest-media}"
  # R2_ENDPOINT like https://<account-id>.r2.cloudflarestorage.com
  mc alias set r2 "$R2_ENDPOINT" "$R2_ACCESS_KEY" "${R2_SECRET_KEY}" || true
  mc mb "r2/${R2_BUCKET:-harvest-media}" --ignore-existing || true
  mc ls "r2/${R2_BUCKET:-harvest-media}" || true
  echo "[mc] test mirror (dry-run): mc mirror --dry-run myminio/harvest-media r2/${R2_BUCKET:-harvest-media}"
else
  echo "[mc] R2_ENDPOINT/R2_ACCESS_KEY not set — skipping r2 alias."
  echo "     Set in .env: R2_ENDPOINT=https://<id>.r2.cloudflarestorage.com R2_ACCESS_KEY=... R2_SECRET_KEY=... R2_BUCKET=harvest-media"
  echo "     Then re-run: ./scripts/mc-setup.sh"
fi
echo "[mc] done."
