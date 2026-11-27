// Release gate: the web bundle the Worker will serve and the web bundle baked
// into the APK must be the same build.
//
// The Worker deployment takes workers/public, while the APK gets the copy of
// dist that `npx cap sync` put into android/.../assets/public. If those drift —
// a local deploy refreshed only the site, or the APK was built before the last
// frontend build — phones install an app whose UI does not match the download
// page, and nobody notices because both look individually valid.
//
// Usage:
//   node scripts/verify-bundle-parity.mjs --web workers/public --apk app-release.apk
//
// Exit 0: identical web build. Exit 1: mismatch/missing asset. Exit 2: the check
// could not run (missing input or unzip).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const webDir = arg('--web', join(root, 'workers/public'))
const apk = arg('--apk')

function die(code, message) {
  console.error(message)
  process.exit(code)
}

if (!apk) die(2, 'bundle-parity: --apk is required')
if (!existsSync(apk)) die(2, `bundle-parity: APK not found: ${apk}`)
const webIndex = join(webDir, 'index.html')
if (!existsSync(webIndex)) die(2, `bundle-parity: web index not found: ${webIndex}`)

const APK_PREFIX = 'assets/public/'

function unzipEntry(entry) {
  try {
    return execFileSync('unzip', ['-p', apk, entry], { maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    if (e?.code === 'ENOENT') die(2, 'bundle-parity: unzip is required to inspect the APK')
    return null
  }
}

const sha = buf => createHash('sha256').update(buf).digest('hex')

function assetRefs(html) {
  const refs = new Set()
  for (const match of html.matchAll(/\/assets\/[A-Za-z0-9_.-]+/g)) refs.add(match[0])
  return [...refs].sort()
}

const webHtml = readFileSync(webIndex)
const apkHtml = unzipEntry(`${APK_PREFIX}index.html`)
if (!apkHtml) die(1, `bundle-parity: the APK has no ${APK_PREFIX}index.html — its web assets are missing`)

const problems = []
const report = []

if (!webHtml.equals(apkHtml)) {
  problems.push('index.html differs between the deployed web bundle and the APK')
} else {
  report.push('index.html                 : identical')
}

const webRefs = assetRefs(webHtml.toString('utf8'))
const apkRefs = assetRefs(apkHtml.toString('utf8'))
if (webRefs.join(',') !== apkRefs.join(',')) {
  problems.push(`asset sets differ:\n    web: ${webRefs.join(', ') || '(none)'}\n    apk: ${apkRefs.join(', ') || '(none)'}`)
}

for (const ref of new Set([...webRefs, ...apkRefs])) {
  const name = ref.replace(/^\/assets\//, '')
  const webFile = join(webDir, 'assets', name)
  if (!existsSync(webFile)) {
    problems.push(`${ref} is referenced but missing from ${webDir}`)
    continue
  }
  const apkBytes = unzipEntry(`${APK_PREFIX}assets/${name}`)
  if (!apkBytes) {
    problems.push(`${ref} is referenced but missing from the APK`)
    continue
  }
  const webSha = sha(readFileSync(webFile))
  const apkSha = sha(apkBytes)
  if (webSha !== apkSha) {
    problems.push(`${ref} differs (web ${webSha.slice(0, 12)}… vs apk ${apkSha.slice(0, 12)}…)`)
    continue
  }
  report.push(`${ref.padEnd(26)} : identical (${webSha.slice(0, 12)}…)`)
}

if (problems.length) {
  console.error('BUNDLE PARITY: FAILED — the Worker site and the APK ship different builds')
  for (const line of report) console.error(`  ${line}`)
  for (const p of problems) console.error(`  ✖ ${p}`)
  console.error('Rebuild the web app, re-run `npx cap sync android`, and rebuild the APK before publishing.')
  process.exit(1)
}

console.log('BUNDLE PARITY: PASSED — deployed web build and APK build are identical')
for (const line of report) console.log(`  ${line}`)
