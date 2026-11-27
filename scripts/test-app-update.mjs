import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const update = readFileSync(new URL('../src/lib/appUpdate.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../workers/src/index.js', import.meta.url), 'utf8')
const apkScript = readFileSync(new URL('../update-apk.sh', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../.github/workflows/android-release.yml', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const plugin = readFileSync(new URL('../android/app/src/main/java/com/harvestfamily/nyeri/UpdateInstallerPlugin.java', import.meta.url), 'utf8')
const mainActivity = readFileSync(new URL('../android/app/src/main/java/com/harvestfamily/nyeri/MainActivity.java', import.meta.url), 'utf8')

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
  assert.match(worker, /sha256: \/\^\[0-9a-f\]\{64\}\$\/\.test\(sha256\)/,
    'the manifest digest is validated before it reaches the app')
  assert.match(worker, /sha256: manifest\.sha256/, 'the endpoint exposes the shipped APK digest')
})

test('the Worker slices APK Range requests instead of forwarding them to assets', async () => {
  // Cloudflare static assets ignore Range and always return the whole file.
  // The updater resumes only on 206, so the Worker has to do the slicing.
  assert.match(worker, /async function serveApkAsset/, 'range-serving helper exists')
  assert.match(worker, /status: 206/, 'the helper answers partial content')
  assert.match(worker, /Content-Range/, 'the helper reports the selected bytes')

  const bytes = Buffer.from('0123456789abcdefghij')
  const { default: app } = await import('../workers/src/index.js')
  const env = {
    RELEASE_APK_FILENAME: 'harvest-family-7-abcdef0.apk',
    ASSETS: {
      async fetch(request) {
        assert.equal(request.headers.get('Range'), null, 'Range is not forwarded to the asset layer')
        return new Response(bytes, { headers: { 'Content-Type': 'application/vnd.android.package-archive' } })
      },
    },
  }
  const response = await app.fetch(new Request('https://example.test/harvest-family.apk', {
    headers: { Range: 'bytes=5-9' },
  }), env, {})
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Range'), 'bytes 5-9/20')
  assert.equal(response.headers.get('Content-Length'), '5')
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
  assert.equal(await response.text(), '56789')

  const invalid = await app.fetch(new Request('https://example.test/harvest-family.apk', {
    headers: { Range: 'bytes=50-' },
  }), env, {})
  assert.equal(invalid.status, 416)
  assert.equal(invalid.headers.get('Content-Range'), 'bytes */20')
})

test('the prompt offers update and a one-hour cooldown', () => {
  assert.match(app, /Update available/)
  assert.match(app, /dismissUpdate\(update\?\.versionCode \|\| 0\)/)
  assert.match(app, /const latest = await checkForUpdate\(\)/,
    'tapping Update refreshes the manifest before downloading')
  assert.match(app, /startUpdateInstall\(target\.apkUrl, target\.sha256, setInstall\)/)
  assert.match(update, /const DISMISS_HOURS = 1/)
})

test('the update prompt cannot be dismissed while a download is running', () => {
  assert.match(app, /if \(installBusy\) return/,
    'Escape and Later are ignored while starting, downloading or installing')
})

test('the update prompt is a centred dialog, never an edge-to-edge banner', () => {
  assert.match(app, /data-testid="update-prompt"/)
  assert.match(app, /fixed inset-0 z-\[100\] grid place-items-center/)
  assert.match(app, /max-w-\[380px\]/)
  assert.doesNotMatch(app, /fixed top-\[calc\(var\(--safe-area-inset-top/, 'the old top banner touched the phone edges')
})

test('the update check keeps running on the welcome screen and on return', () => {
  assert.match(app, /const onVisible = \(\) => \{ if \(document\.visibilityState === 'visible'\) void check\(\) \}/)
  assert.match(app, /window\.setInterval\(\(\) => \{\s*if \(document\.visibilityState === 'visible'\) void check\(\)\s*\}, 10 \* 60_000\)/)
  assert.match(app, /<UpdateGate>\s*<Onboarding/, 'signed-out users are still covered')
})

test('the signed-in column stays centred instead of stretching on a wide screen', () => {
  assert.match(app, /w-full min-w-0 max-w-\[560px\] flex-col/)
  assert.doesNotMatch(app, /lg:max-w-\[560px\]/, 'the column no longer grows to the viewport before the desktop breakpoint')
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

test('Update downloads and installs inside the app instead of opening a browser', () => {
  // The old '_blank' path saved nothing and '_system' handed the member to a
  // browser. Android now uses the native downloader + package installer.
  assert.doesNotMatch(app, /openApkDownload\(update\.apkUrl\)/)
  assert.match(update, /registerPlugin<UpdateInstallerPlugin>\('UpdateInstaller'\)/)
  assert.match(update, /downloadAndInstall\(\{\s*url: apkTarget\(apkUrl\),\s*\.\.\.\(sha256 \? \{ sha256 \} : \{\}\),\s*\}\)/,
    'the digest travels with the download request')
  assert.match(update, /Allow installs from Harvest Family, then come back/)

  const webFallback = update.indexOf('openApkDownload(apkUrl)')
  const nativeGuard = update.indexOf("if (!Capacitor.isNativePlatform?.())")
  assert.ok(webFallback > nativeGuard, 'only the non-native branch opens the browser')

  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/)
  assert.match(mainActivity, /registerPlugin\(UpdateInstallerPlugin\.class\)[\s\S]*super\.onCreate/,
    'the plugin must be registered before the bridge starts')
})

test('the native downloader saves the APK and opens the package installer', () => {
  assert.match(plugin, /extends Plugin/)
  assert.match(plugin, /getCacheDir\(\), APK_NAME/)
  assert.match(plugin, /openFollowingRedirects\(url, existing\)/, 'redirects are followed manually, including http→https')
  assert.match(plugin, /FileProvider\.getUriForFile/)
  assert.match(plugin, /application\/vnd\.android\.package-archive/)
  assert.match(plugin, /INSTALLER_PACKAGES[\s\S]*setPackage\(installer\)/,
    'target the package installer directly instead of showing an Open with chooser')
  assert.match(plugin, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/)
  assert.match(plugin, /handleOnResume\(\)[\s\S]*startDownload\(url, checksum\)/,
    'returning from the permission screen continues the download automatically')
})

test('the native downloader resumes interrupted downloads', () => {
  assert.match(plugin, /PART_NAME = "harvest-update\.apk\.part"/)
  assert.match(plugin, /setRequestProperty\("Range", "bytes=" \+ rangeStart \+ "-"\)/,
    'a partial file asks the server for the remaining bytes')
  assert.match(plugin, /HttpURLConnection\.HTTP_PARTIAL/)
  assert.match(plugin, /new FileOutputStream\(part, append\)/, 'a 206 response appends to the partial file')
  assert.match(plugin, /if \(total > 0 && done < total\)/, 'a short body is treated as an interruption')
  assert.doesNotMatch(plugin, /catch \(Exception e\) \{\s*downloading = false;\s*part\.delete\(\)/,
    'network failures keep the .part file so the next tap can resume')
  assert.match(plugin, /preparePartial\(url, checksum, part, meta\)/,
    'a partial file is only reused for the same release')
})

test('the native downloader verifies the APK SHA-256 before installing', () => {
  assert.match(plugin, /MessageDigest\.getInstance\("SHA-256"\)/)
  assert.match(plugin, /!checksum\.equals\(sha256\(part\)\)/)
  assert.match(plugin, /throw new ChecksumException\(\)/)
  assert.match(plugin, /The update file failed its security check/)
  assert.match(update, /const checksum = String\(d\.sha256 \|\| ''\)\.trim\(\)\.toLowerCase\(\)/)
  assert.match(update, /sha256: \/\^\[0-9a-f\]\{64\}\$\/\.test\(checksum\) \? checksum : ''/)
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
  assert.match(workflow, /"sha256": "%s"/, 'CI publishes the APK digest')
  assert.match(apkScript, /"sha256": "%s"/, 'the local release script publishes it too')
  assert.match(workflow, /LOCAL_SHA/, 'the digest describes the staged signed APK')
  assert.match(workflow, /cp "\$\{APK_PATH\}" workers\/public\/harvest-family\.apk/,
    'the signed APK replaces the stale checked-in file at the permanent URL')
  assert.match(apkScript, /Range: bytes=0-99/, 'the local release checks resumable downloads')
  assert.match(apkScript, /RANGE_CODE.*206|\"206\"/s, 'the local release requires a 206')
})

test('production smoke verifies the served APK digest and Range support', () => {
  const smoke = readFileSync(new URL('../scripts/smoke-test.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /createHash\('sha256'\)/, 'the smoke test hashes the real download')
  assert.match(smoke, /APK download matches manifest SHA-256/)
  assert.match(smoke, /Range: 'bytes=100-199'/, 'the smoke test exercises resume')
  assert.match(smoke, /r\.status === 206/, 'a full 200 response fails the resume check')
})

test('the update is offered again on every app open', () => {
  // A member who taps Later, closes the app and reopens it must be told about
  // the release again; the cooldown only paces the in-session checks.
  assert.match(app, /const check = async \(opening = false\) => \{/)
  assert.match(app, /info\.available && \(opening \|\| !isDismissed\(info\.versionCode\)\)/,
    'the opening check is not silenced by the snooze')
  assert.match(app, /void check\(true\)/, 'mount runs the opening check')
})

test('a local build stays below the CI version band', () => {
  // 1000 + git commit count overtook CI's 1000 + run number, so a locally built
  // APK claimed to be newer than every release and the phone stopped updating.
  // Take the higher of the committed floor and live + 1; both stay below the
  // next CI run's 1000 + run number.
  assert.match(apkScript,
    /LOCAL_VERSION_CODE=\$\(\( VERSION_FLOOR > LIVE_VERSION_CODE \+ 1 \? VERSION_FLOOR : LIVE_VERSION_CODE \+ 1 \)\)/,
    'local builds take the higher of the committed floor and live + 1')
  assert.doesNotMatch(apkScript, /GIT_COMMITS % 900/)
  assert.doesNotMatch(apkScript, /1000 \+ \$\(git rev-list --count HEAD\)/)
})

test('"Remind me later" snoozes for an hour instead of muting that version forever', () => {
  // The code-only value made Later permanent and left DISMISS_HOURS unused.
  // 24 hours then made the prompt effectively one-shot for a day.
  assert.match(update, /until: Date\.now\(\) \+ DISMISS_HOURS \* 60 \* 60 \* 1000/)
  assert.match(update, /return until > Date\.now\(\)/)
})
