#!/usr/bin/env bash
# update-apk.sh — rebuild, stage, and ship the Android APK to the live download link.
#
# Usage:
#   ./update-apk.sh            build debug APK + deploy worker (APK + API together)
#   ./update-apk.sh --release  build signed release APK instead (needs android/keystore.properties)
#
# The download URL never changes: https://harvestfamily-api.<subdomain>.workers.dev/harvest-family.apk
# Wrangler must be logged in once first:  npx wrangler login
set -euo pipefail
cd "$(dirname "$0")"

BUILD_TYPE="debug"
[[ "${1:-}" == "--release" ]] && BUILD_TYPE="release"

JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
# The gradle build refuses anything below the committed floor, and an installed
# app refuses anything that does not outrank the live release. The old
# `git rev-list --count % 900` scheme produced codes like 8 against a floor of
# 1648, so the documented local build failed outright. Use the higher of the
# floor and the live release + 1 instead.
VERSION_FLOOR=1
if [[ -f android/version-code.txt ]]; then
  VERSION_FLOOR="$(tr -dc '0-9' < android/version-code.txt)"
  [[ -n "$VERSION_FLOOR" ]] || VERSION_FLOOR=1
fi
LIVE_VERSION_CODE="$(curl -fsS --max-time 20 \
  https://harvestfamily-api.harvestfamily.workers.dev/api/app-version 2>/dev/null \
  | sed -E 's/.*"version_code"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/' || true)"
[[ "$LIVE_VERSION_CODE" =~ ^[0-9]+$ ]] || LIVE_VERSION_CODE=0
LOCAL_VERSION_CODE=$(( VERSION_FLOOR > LIVE_VERSION_CODE + 1 ? VERSION_FLOOR : LIVE_VERSION_CODE + 1 ))
HARVEST_VERSION_CODE="${HARVEST_VERSION_CODE:-$LOCAL_VERSION_CODE}"
HARVEST_VERSION_NAME="${HARVEST_VERSION_NAME:-1.0.${HARVEST_VERSION_CODE}}"
export HARVEST_VERSION_CODE HARVEST_VERSION_NAME

# The APK must bake the API origin. Without it, the WebView's relative /api
# calls resolve to Capacitor's local server, so the app cannot reach the backend
# and the update check always answers available:false — a locally built APK
# would never prompt. The GitHub release workflow exports this; match it here.
export VITE_API_URL="${VITE_API_URL:-https://harvestfamily-api.harvestfamily.workers.dev}"

echo "▸ 1/5 Building web app (Vite)…"
npm run build --silent

echo "▸ 2/5 Syncing into Android project (Capacitor)…"
npx cap sync android > /dev/null

echo "▸ 3/5 Building $BUILD_TYPE APK (Gradle)…"
cd android
if [[ "$BUILD_TYPE" == "release" ]]; then
  JAVA_HOME="$JAVA_HOME" ./gradlew assembleRelease -q
  SRC="app/build/outputs/apk/release/app-release.apk"
else
  JAVA_HOME="$JAVA_HOME" ./gradlew assembleDebug -q
  SRC="app/build/outputs/apk/debug/app-debug.apk"
fi
cd ..

# Android only installs an update signed with the same certificate as the app
# already on members' phones. A build signed with the developer keystore is
# rejected with "App not installed as package conflicts with an existing
# package", so never publish one: the release workflow holds the real signing
# key, and this script only has whatever android/keystore.properties points at.
if ! APKSIGNER="$(command -v apksigner || true)" node scripts/verify-apk-cert.mjs "android/$SRC"; then
  echo "✖ Refusing to publish: this APK is not signed with the production release key."
  echo "  Build left at android/$SRC."
  echo "  Publish APK updates through the GitHub release workflow, which restores the release keystore."
  exit 1
fi

echo "▸ 4/6 Staging web app, APK and version manifest…"
STAGED="workers/downloads/harvest-family.apk"
cp "android/$SRC" "$STAGED"
# Worker assets are replaced wholesale on every deploy and the Worker reads the
# release version from them, so staging here is what keeps in-app updates alive
# after a local deploy (it used to drop RELEASE_APK_FILENAME, which disabled the
# update prompt and 503'd the download URL).
rm -rf workers/public
mkdir -p workers/public
cp -r dist/. workers/public/
rm -f workers/public/_redirects workers/public/_headers
cp "$STAGED" workers/public/harvest-family.apk
# The app verifies this digest before opening the installer. Without it in the
# manifest the updater can only trust the transport, not the downloaded bytes.
APK_SHA256=$(sha256sum "$STAGED" | cut -d' ' -f1)
printf '{"version_code": %s, "version_name": "%s", "apk_url": "/harvest-family.apk", "sha256": "%s"}\n' \
  "$HARVEST_VERSION_CODE" "$HARVEST_VERSION_NAME" "$APK_SHA256" > workers/public/app-version.json

echo "▸ 5/6 Deploying worker + APK to Cloudflare…"
cd workers
npx wrangler deploy | tail -3
cd ..

echo "▸ 6/6 Verifying live download…"
sleep 3
LIVE_SHA256=$(curl -fsSL --retry 5 --retry-delay 3 -m 120 https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk | sha256sum | cut -d' ' -f1)
LOCAL_SHA256=$(sha256sum "$STAGED" | cut -d' ' -f1)
if [[ "$LIVE_SHA256" != "$LOCAL_SHA256" ]]; then
  echo "⚠️  SHA-256 mismatch:"
  echo "   local: $LOCAL_SHA256"
  echo "   live:  $LIVE_SHA256"
  exit 1
fi

# Resuming depends on a real 206 from the Worker. Cloudflare's static asset
# layer ignores Range, so a plain 200 here means the next interrupted download
# would restart from zero.
RANGE_FILE=$(mktemp)
trap 'rm -f "$RANGE_FILE"' EXIT
RANGE_CODE=$(curl -sS --retry 5 --retry-delay 3 -m 120 \
  -H 'Range: bytes=0-99' \
  -o "$RANGE_FILE" \
  -w '%{http_code}' \
  https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk || true)
RANGE_BYTES=$(wc -c < "$RANGE_FILE" | tr -d ' ')
if [[ "$RANGE_CODE" != "206" || "$RANGE_BYTES" != "100" ]]; then
  echo "⚠️  Resumable download check failed:"
  echo "   expected HTTP 206 with 100 bytes"
  echo "   got HTTP $RANGE_CODE with $RANGE_BYTES bytes"
  exit 1
fi

echo "✅ LIVE APK verified — SHA-256 checksums match ($LIVE_SHA256)"
echo "   Range request: HTTP 206, 100 bytes"
echo "   versionCode: $HARVEST_VERSION_CODE"
echo "   versionName: $HARVEST_VERSION_NAME"
echo "   https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk"
