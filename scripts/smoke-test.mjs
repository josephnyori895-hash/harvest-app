#!/usr/bin/env node
import { createHash } from 'node:crypto'

const base = (process.env.SMOKE_BASE_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Usage: SMOKE_BASE_URL=https://harvestfamily-api.harvestfamily.workers.dev npm run smoke')
  process.exit(2)
}

const smokeUsername = process.env.SMOKE_USERNAME || ''
const smokePin = process.env.SMOKE_PIN || ''
const checks = []

async function check(name, path, options = {}, assert = () => true) {
  const started = Date.now()
  try {
    const response = await fetch(`${base}${path}`, { redirect: 'manual', ...options })
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch {}
    const ok = assert(response, body, text)
    checks.push({ name, ok, detail: `${response.status} in ${Date.now() - started}ms` })
    if (!ok) console.error(`FAIL ${name}:`, text.slice(0, 500))
    return { response, body, text }
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message })
    console.error(`FAIL ${name}:`, error.message)
    return { response: null, body: null, text: '' }
  }
}

// A just-deployed Worker can briefly serve the previous version (edge
// propagation). Runs right after deploy retry once after a short wait.
async function checkAfterDeploy(name, path, options = {}, assert = () => true) {
  const first = await check(name, path, options, assert)
  if (checks[checks.length - 1]?.ok) return first
  await new Promise(r => setTimeout(r, 5000))
  checks.pop()
  return check(`${name} (retry)`, path, options, assert)
}

// APK checks need raw bytes. The text helper above would corrupt binary data
// before the digest could be verified.
async function checkBinary(name, path, options = {}, assert = () => true) {
  const started = Date.now()
  try {
    const response = await fetch(`${base}${path}`, options)
    const body = Buffer.from(await response.arrayBuffer())
    const ok = assert(response, body)
    checks.push({ name, ok, detail: `${response.status}, ${body.length} bytes in ${Date.now() - started}ms` })
    if (!ok) console.error(`FAIL ${name}: unexpected ${response.status} (${body.length} bytes, content-range=${response.headers.get('content-range') || '-'})`)
    return { response, body, ok }
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message })
    console.error(`FAIL ${name}:`, error.message)
    return { response: null, body: null, ok: false }
  }
}

async function checkBinaryAfterDeploy(name, path, options = {}, assert = () => true) {
  const first = await checkBinary(name, path, options, assert)
  if (first.ok) return first
  await new Promise(r => setTimeout(r, 5000))
  checks.pop()
  return checkBinary(`${name} (retry)`, path, options, assert)
}

await check('health', '/health', {}, (r, b) => r.status === 200 && b?.status === 'ok' && b?.database === 'ok' && b?.storage === 'r2')
// Feed is members-only since the privacy hardening — anonymous callers must be
// rejected rather than served member names/captions/photos.
await check('feed requires authentication', '/api/feed', {}, r => r.status === 401)
await check('admin endpoint rejects anonymous request', '/api/pending', {}, r => r.status === 401)
await check('M-Pesa callback accepts empty callback safely', '/api/giving/mpesa/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, r => r.status === 200)
await check('unknown API route does not expose stack trace', '/api/__smoke_unknown__', {}, (r, _b, text) => r.status >= 400 && !/stack|node_modules|file:\/\//i.test(text))
// Latest-version probe must always answer shape-valid (deployments without a
// release still return {update_available:false} rather than erroring).
const versionProbe = await checkAfterDeploy('app-version probe answers', '/api/app-version', {}, (r, b) => r.status === 200 && typeof b?.update_available === 'boolean')

// The in-app updater trusts the manifest digest. Verify the bytes actually
// served at the public URL, and verify the resume path used after a dropped
// connection. Cloudflare static assets ignore Range, so this is the one check
// that proves the Worker is doing the slicing rather than returning a full 200.
if (versionProbe.body?.update_available) {
  const expected = String(versionProbe.body?.sha256 || '').toLowerCase()
  if (/^[0-9a-f]{64}$/.test(expected)) {
    await checkBinaryAfterDeploy('APK download matches manifest SHA-256', '/harvest-family.apk', {}, (r, body) => {
      if (r.status !== 200) return false
      const actual = createHash('sha256').update(body).digest('hex')
      if (actual !== expected) console.error(`  expected ${expected}, got ${actual}`)
      return actual === expected
    })
  }

  await checkBinaryAfterDeploy('APK supports resumable Range requests', '/harvest-family.apk', {
    headers: { Range: 'bytes=100-199' },
  }, (r, body) => {
    const contentRange = r.headers.get('content-range') || ''
    return r.status === 206 &&
      body.length === 100 &&
      /^bytes 100-199\/\d+$/.test(contentRange) &&
      /\bbytes\b/i.test(r.headers.get('accept-ranges') || '')
  })
}

if (smokeUsername || smokePin) {
  if (!smokeUsername || !smokePin) {
    console.error('Authenticated smoke requires both SMOKE_USERNAME and SMOKE_PIN')
    process.exit(2)
  }

  const login = await check('authenticated login', '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: smokeUsername, pin: smokePin }),
  }, (r, b) => r.status === 200 && typeof b?.token === 'string' && b.token.length > 20)

  const token = login.body?.token
  if (token) {
    const auth = { Authorization: `Bearer ${token}` }
    await check('authenticated /api/me', '/api/me', { headers: auth }, (r, b) => r.status === 200 && b?.user?.username === smokeUsername)
    await check('authenticated feed', '/api/feed', { headers: auth }, r => r.status === 200)
    await check('authenticated presence', '/api/presence', { headers: auth }, r => r.status === 200)
    await check('authenticated chat history', '/api/chat/history', { headers: auth }, r => r.status === 200)
    await check('authenticated chat conversations', '/api/chat/conversations', { headers: auth }, (r, b) => r.status === 200 && Array.isArray(b?.conversations))
    await check('authenticated groups', '/api/groups', { headers: auth }, (r, b) => r.status === 200 && Array.isArray(b?.groups))
    await check('authenticated departments', '/api/departments', { headers: auth }, (r, b) => r.status === 200 && Array.isArray(b?.departments))
  }
} else {
  console.log('Authenticated checks skipped: set SMOKE_USERNAME and SMOKE_PIN to enable them.')
}

console.log('\nCloudflare Worker smoke test:', checks.every(c => c.ok) ? 'PASS' : 'FAIL')
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)

if (!checks.every(c => c.ok)) process.exit(1)
