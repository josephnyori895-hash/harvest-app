// Guard against publishing an APK signed with the wrong key.
//
// Android refuses to install an update whose signing certificate differs from
// the installed app ("App not installed as package conflicts with an existing
// package"). That happened when a locally built APK — signed with the local
// developer keystore — was published over CI builds signed with the release
// keystore. The pin below is the certificate every installed Harvest app
// already trusts; a build that does not match it must never reach
// workers/public or the release manifest.
//
// Usage: node scripts/verify-apk-cert.mjs <path-to.apk>
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const apk = process.argv[2]
if (!apk) {
  console.error('usage: node scripts/verify-apk-cert.mjs <path-to.apk>')
  process.exit(2)
}
if (!existsSync(apk)) {
  console.error(`apk not found: ${apk}`)
  process.exit(2)
}

const pinned = readFileSync(join(root, 'android/release-cert-sha256.txt'), 'utf8')
  .split(/\s+/)
  .map(s => s.trim().toLowerCase())
  .find(Boolean)
if (!/^[0-9a-f]{64}$/.test(pinned || '')) {
  console.error('android/release-cert-sha256.txt must contain one SHA-256 fingerprint')
  process.exit(2)
}

function findApksigner() {
  const explicit = process.env.APKSIGNER
  if (explicit && existsSync(explicit)) return explicit
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''
  const tools = []
  if (home) {
    try {
      for (const dir of readdirSync(join(home, 'build-tools'))) tools.push(join(home, 'build-tools', dir, 'apksigner'))
    } catch { /* fall through to PATH */ }
  }
  if (tools.length) return tools.sort().at(-1)
  return 'apksigner'
}

let output = ''
try {
  output = execFileSync(findApksigner(), ['verify', '--print-certs', apk], { encoding: 'utf8' })
} catch (e) {
  console.error(`could not inspect ${apk}: ${e?.message || e}`)
  process.exit(2)
}

const digests = [...output.matchAll(/certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/g)]
  .map(m => m[1].replace(/:/g, '').toLowerCase())
if (!digests.length) {
  console.error(`no signing certificate found in ${apk} — the APK is unsigned`)
  process.exit(1)
}
if (!digests.includes(pinned)) {
  console.error(`APK signed with the wrong key.\n  expected: ${pinned}\n  found:    ${digests.join(', ')}`)
  console.error('This APK cannot install over the released app. Build it in CI, where the release keystore is used.')
  process.exit(1)
}
console.log(`APK signing certificate matches the released app (${pinned}).`)
