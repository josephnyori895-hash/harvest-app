import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const update = readFileSync(new URL('../src/lib/appUpdate.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../workers/src/index.js', import.meta.url), 'utf8')

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
