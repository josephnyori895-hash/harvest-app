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
HARVEST_VERSION_CODE="${HARVEST_VERSION_CODE:-$((1000 + $(git rev-list --count HEAD)))}"
HARVEST_VERSION_NAME="${HARVEST_VERSION_NAME:-1.0.${HARVEST_VERSION_CODE}}"
export HARVEST_VERSION_CODE HARVEST_VERSION_NAME

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

STAGED="workers/downloads/harvest-family.apk"
cp "android/$SRC" "$STAGED"

echo "▸ 4/5 Deploying worker + APK to Cloudflare…"
cd workers
npx wrangler deploy | tail -3
cd ..

echo "▸ 5/5 Verifying live download…"
sleep 3
LIVE_SHA256=$(curl -fsSL --retry 5 --retry-delay 3 -m 120 https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk | sha256sum | cut -d' ' -f1)
LOCAL_SHA256=$(sha256sum "$STAGED" | cut -d' ' -f1)
if [[ "$LIVE_SHA256" == "$LOCAL_SHA256" ]]; then
  echo "✅ LIVE APK verified — SHA-256 checksums match ($LIVE_SHA256)"
  echo "   versionCode: $HARVEST_VERSION_CODE"
  echo "   versionName: $HARVEST_VERSION_NAME"
  echo "   https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk"
else
  echo "⚠️  SHA-256 mismatch:"
  echo "   local: $LOCAL_SHA256"
  echo "   live:  $LIVE_SHA256"
  exit 1
fi
