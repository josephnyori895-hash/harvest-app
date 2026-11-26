#!/usr/bin/env bash
# Upgrade installation test — proves a new APK installs directly over the
# previous release without uninstalling, keeps app data, and launches.
#
# Usage: scripts/android-upgrade-test.sh <previous.apk> <new.apk>
#
# Requires one connected Android device or running emulator (adb). In CI the
# emulator is provided by reactivecircus/android-emulator-runner. A local run
# with no device fails on purpose; set UPGRADE_TEST_ALLOW_SKIP=1 to opt out.
set -euo pipefail

PREV="${1:?previous apk required}"
NEW="${2:?new apk required}"
PKG="$(tr -d '[:space:]' < "$(dirname "$0")/../android/release-package-id.txt")"

fail() { echo "UPGRADE TEST: FAILED — $*" >&2; exit 1; }

if ! adb get-state >/dev/null 2>&1; then
  if [ "${UPGRADE_TEST_ALLOW_SKIP:-0}" = "1" ]; then
    echo "UPGRADE TEST: skipped — no device attached (UPGRADE_TEST_ALLOW_SKIP=1)"
    exit 0
  fi
  fail "no device attached; the upgrade test is a release gate"
fi

echo "UPGRADE TEST: installing previous release"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$PREV" >/dev/null || fail "could not install the previous release"
DUMP="$(adb shell dumpsys package "$PKG" | tr -d '\r')"
BEFORE="$(printf '%s\n' "$DUMP" | awk '/firstInstallTime/{print $2; exit}' || true)"
[ -n "$BEFORE" ] || fail "could not read firstInstallTime from the installed previous release"

echo "UPGRADE TEST: installing the new release over it"
if ! adb install -r "$NEW" >/dev/null 2>&1; then
  fail "the new APK did not install over the previous release (package/signature/version conflict)"
fi

DUMP="$(adb shell dumpsys package "$PKG" | tr -d '\r')"
AFTER="$(printf '%s\n' "$DUMP" | awk '/firstInstallTime/{print $2; exit}' || true)"
[ "$BEFORE" = "$AFTER" ] || fail "firstInstallTime changed ($BEFORE → $AFTER): the app was reinstalled and data was lost"

EXPECTED_CODE="$(printf '%s\n' "$DUMP" | awk -F= '/versionCode=/{print $2; exit}' | awk '{print $1}')"
echo "UPGRADE TEST: installed versionCode=$EXPECTED_CODE, firstInstallTime preserved"

echo "UPGRADE TEST: launching the app"
COMPONENT="$(adb shell cmd package resolve-activity --brief "$PKG" | tr -d '\r' | tail -n1)"
case "$COMPONENT" in
  */*) adb shell am start -W -n "$COMPONENT" >/dev/null 2>&1 || fail "the app did not launch ($COMPONENT)" ;;
  *) adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || fail "the app did not launch" ;;
esac
sleep 6
if ! adb shell pidof "$PKG" >/dev/null 2>&1; then
  fail "the app process is not running after launch"
fi

echo "UPGRADE TEST: PASSED — update installs over the old app, data preserved, app launches"
