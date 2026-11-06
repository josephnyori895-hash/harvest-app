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
# CI stamps 1000 + run number, so a local build has to stay in the low band or
# it would advertise itself as newer than every release and the phone would stop
# seeing CI updates. Same scheme as the fallback in android/app/build.gradle.
GIT_COMMITS="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
LOCAL_VERSION_CODE=$(( GIT_COMMITS % 900 ))
(( LOCAL_VERSION_CODE < 1 )) && LOCAL_VERSION_CODE=1
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
printf '{"version_code": %s, "version_name": "%s", "apk_url": "/harvest-family.apk"}\n' \
  "$HARVEST_VERSION_CODE" "$HARVEST_VERSION_NAME" > workers/public/app-version.json

echo "▸ 5/6 Deploying worker + APK to Cloudflare…"
cd workers
npx wrangler deploy | tail -3
cd ..

echo "▸ 6/6 Verifying live download…"
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
