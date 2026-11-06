import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const update = readFileSync(new URL('../src/lib/appUpdate.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../workers/src/index.js', import.meta.url), 'utf8')
const apkScript = readFileSync(new URL('../update-apk.sh', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../.github/workflows/android-release.yml', import.meta.url), 'utf8')

test('the installed build is read from the native package, not from config', () => {
  // Capacitor.Config.versionCode is never injected in this repo, so reading it
  // returned 0 on every device and the prompt could not appear. App.getInfo()
  // reads the package manager.
  assert.match(update, /import \{ App \} from '@capacitor\/app'/, 'App comes from @capacitor/app, not core')
  assert.match(update, /await App\.getInfo\(\)/, 'getInfo is async and must be awaited')
  assert.match(update, /Number\(info\?\.build\)/, 'build is the installed versionCode')
  assert.match(update, /String\(info\?\.version \|\| ''\)/, 'version is the installed versionName')
  assert.doesNotMatch(update, /import \{ Capacitor, App \} from '@capacitor\/core'/, 'App is not exported by core')
})

test('a build number we cannot read still compares by version name', () => {
  assert.match(update, /function compareVersionNames\(/, 'name comparison exists')
  assert.match(update, /Boolean\(installedName && latestName\) && compareVersionNames\(latestName, installedName\) > 0/,
    'unreadable build falls back to comparing names instead of silently disabling')
})

test('an up-to-date or unmeasurable install never nags', () => {
  assert.match(update, /if \(!newer\) return \{ available: false \}/)
  assert.match(update, /if \(!d\?\.update_available\) return \{ available: false \}/)
  assert.match(update, /catch \{\n    \/\/ Offline or endpoint unavailable — never nag on failure\.\n    return \{ available: false \}/)
})

test('the release endpoint reports 1000 + run, matching the stamped versionCode', () => {
  assert.match(worker, /url\.pathname === '\/api\/app-version'/)
  assert.match(worker, /version_code: 1000 \+ run/)
  assert.match(worker, /apk_url: '\/harvest-family\.apk'/)
})

test('the prompt offers update and a 24h deferral', () => {
  assert.match(app, /Update available/)
  assert.match(app, /dismissUpdate\(update\.versionCode\)/)
  assert.match(app, /openApkDownload\(update\.apkUrl\)/)
  assert.match(update, /const DISMISS_HOURS = 24/)
})

test('the check runs on open, not only after sign-in', () => {
  // Returning <Onboarding/> before UpdateGate meant the first screen — where a
  // member with an old build actually sits — never ran the check. That is the
  // case Nyorii reported: open the app, get no update prompt.
  assert.match(app, /if \(!onboarded\) return \(\s*<UpdateGate>\s*<Onboarding/, 'onboarding sits inside UpdateGate')
  const onboardingReturn = app.indexOf('if (!onboarded) return')
  const gate = app.indexOf('<UpdateGate>')
  assert.ok(gate > 0 && onboardingReturn > 0, 'both the branch and the gate exist')
})

test('the APK build bakes an API origin, so the check can reach the Worker', () => {
  // RS-137: update-apk.sh built the web bundle without VITE_API_URL. Inside the
  // WebView every relative /api call then resolves to Capacitor's local server,
  // so checkForUpdate could not parse a manifest and always answered
  // available:false — an APK from the documented local script never prompted.
  // The GitHub workflow exported this; the script must match it.
  assert.match(apkScript, /export VITE_API_URL="\$\{VITE_API_URL:-https:\/\/harvestfamily-api\.harvestfamily\.workers\.dev\}"/,
    'the local release script exports the API origin before building')
  assert.ok(apkScript.indexOf('VITE_API_URL') < apkScript.indexOf('npm run build'), 'the origin is set before vite runs')
})

test('Update hands the APK to the system browser, not a WebView popup', () => {
  // '_blank' inside the Android WebView opened nothing that could save the APK
  // (Waydroid: app fell to the launcher, /sdcard/Download stayed empty).
  assert.match(update, /window\.open\(target, native \? '_system' : '_blank', 'noopener'\)/)
  assert.match(update, /const native = Boolean\(Capacitor\.isNativePlatform\?\.\(\)\)/)
})

test('the shipped version travels with the assets, not with the deploy command', () => {
  // RELEASE_APK_FILENAME only exists for deploys that pass --var. A plain
  // `wrangler deploy` (update-apk.sh did exactly that) dropped it, so
  // /api/app-version answered update_available:false and the permanent APK URL
  // answered 503 — in-app updates died until the next CI run.
  assert.match(worker, /app-version\.json/, 'the endpoint reads the manifest from assets')
  assert.match(worker, /async function readAppVersionManifest/, 'manifest reader exists')
  assert.match(worker, /async function resolveReleaseApk/, 'the permanent URL resolves its own target')
  assert.doesNotMatch(worker, /if \(!filename \|\| !\/\^harvest-family-/, 'the hard 503 guard on the deploy var is gone')
  assert.match(workflow, /app-version\.json/, 'CI writes the manifest')
  assert.match(apkScript, /app-version\.json/, 'the local release script writes it too')
})

test('a local build stays below the CI version band', () => {
  // 1000 + git commit count overtook CI's 1000 + run number, so a locally built
  // APK claimed to be newer than every release and the phone stopped updating.
  assert.match(apkScript, /LOCAL_VERSION_CODE=\$\(\( GIT_COMMITS % 900 \)\)/)
  assert.doesNotMatch(apkScript, /1000 \+ \$\(git rev-list --count HEAD\)/)
})

test('"Remind me later" snoozes for 24h instead of muting that version forever', () => {
  // The code-only value made Later permanent and left DISMISS_HOURS unused.
  assert.match(update, /until: Date\.now\(\) \+ DISMISS_HOURS \* 60 \* 60 \* 1000/)
  assert.match(update, /return until > Date\.now\(\)/)
})
