// Release compatibility gate.
//
// An Android update installs over the existing app only when the package id,
// the signing certificate, and an increasing versionCode all match what users
// already have. This script checks a freshly built APK against the pinned
// production identity and, when given one, against the previous release APK.
//
// Usage:
//   node scripts/release-compat-check.mjs --apk build.apk [--previous-apk prev.apk]
//         [--expect-package com.example.app] [--max-version-code 999999]
//
// Exit 0: compatible. Exit 1: incompatible (publication must be blocked).
// Exit 2: the check itself could not run (missing tool/input).
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const apk = arg('--apk')
const previousApk = arg('--previous-apk')
if (!apk || !existsSync(apk)) {
  console.error('release-compat: --apk is required and must exist')
  process.exit(2)
}

function tool(name) {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''
  const candidates = []
  if (home && existsSync(join(home, 'build-tools'))) {
    for (const dir of readdirSync(join(home, 'build-tools'))) {
      candidates.push(join(home, 'build-tools', dir, name))
      candidates.push(join(home, 'cmdline-tools', 'latest', 'bin', name))
    }
  }
  const found = candidates.filter(p => existsSync(p)).sort().at(-1)
  return found || name
}

function readBadging(file) {
  let out = ''
  try {
    out = execFileSync(tool('aapt2'), ['dump', 'badging', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    try {
      out = execFileSync(tool('aapt'), ['dump', 'badging', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (e) {
      console.error(`release-compat: no aapt/aapt2 available to read ${file}`)
      process.exit(2)
    }
  }
  const pkg = out.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'/)
  if (!pkg) {
    console.error(`release-compat: could not read the package line from ${file}`)
    process.exit(2)
  }
  return { packageId: pkg[1], versionCode: Number(pkg[2]) || 0, versionName: pkg[3] }
}

function readCert(file) {
  let out = ''
  try {
    out = execFileSync(tool('apksigner'), ['verify', '--print-certs', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    // apksigner exits non-zero for an unverifiable/unsigned APK; keep any output.
    out = String(e?.stdout || '')
    if (!out) {
      console.error(`release-compat: apksigner could not verify ${file}`)
      process.exit(1)
    }
  }
  const certs = [...out.matchAll(/certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/g)].map(m => m[1].replace(/:/g, '').toLowerCase())
  return [...new Set(certs)]
}

const pinnedPackage = (arg('--expect-package') || readFileSync(join(root, 'android/release-package-id.txt'), 'utf8')).trim()
const pinnedCert = readFileSync(join(root, 'android/release-cert-sha256.txt'), 'utf8').trim().split(/\s+/)[0].toLowerCase()

const problems = []
const report = []

const current = readBadging(apk)
const currentCerts = readCert(apk)

if (!new RegExp(`^${pinnedPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(current.packageId)) {
  problems.push(`application id ${current.packageId} does not match the production id ${pinnedPackage}`)
} else {
  report.push(`application id      : ${current.packageId} (matches production)`)
}

if (!currentCerts.includes(pinnedCert)) {
  problems.push(`signing certificate ${currentCerts.join(', ') || 'none'} does not match the approved ${pinnedCert}`)
} else {
  report.push(`signing certificate : ${pinnedCert} (matches the released app)`)
}
if (currentCerts.length === 0) problems.push('APK is unsigned')

report.push(`version             : ${current.versionName} (${current.versionCode})`)

if (previousApk) {
  if (!existsSync(previousApk)) {
    problems.push(`previous APK not found: ${previousApk}`)
  } else {
    const previous = readBadging(previousApk)
    const previousCerts = readCert(previousApk)
    if (previous.packageId !== current.packageId) {
      problems.push(`application id changed from ${previous.packageId} to ${current.packageId} — installed apps cannot update`)
    }
    if (!previousCerts.length) {
      problems.push('previous APK has no readable signing certificate')
    } else if (!previousCerts.every(c => currentCerts.includes(c))) {
      problems.push(`signing certificate differs from the previous release (${previousCerts.join(', ')} → ${currentCerts.join(', ')})`)
    }
    if (!(current.versionCode > previous.versionCode)) {
      problems.push(`versionCode ${current.versionCode} must be greater than the previous release's ${previous.versionCode}`)
    }
    report.push(`previous release    : ${previous.versionName} (${previous.versionCode}, ${previousCerts.join(', ')})`)
  }
}

if (problems.length) {
  console.error('RELEASE COMPATIBILITY: FAILED')
  for (const line of report) console.error(`  ${line}`)
  for (const p of problems) console.error(`  ✖ ${p}`)
  console.error('Publication blocked: this APK would not install over the released app.')
  process.exit(1)
}

console.log('RELEASE COMPATIBILITY: PASSED')
for (const line of report) console.log(`  ${line}`)
