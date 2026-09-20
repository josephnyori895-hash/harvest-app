#!/usr/bin/env node

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

await check('health', '/health', {}, (r, b) => r.status === 200 && b?.status === 'ok' && b?.database === 'ok' && b?.storage === 'r2')
await check('public feed is reachable anonymously', '/api/feed', {}, (r, b) => r.status === 200 && Array.isArray(b?.posts) && Array.isArray(b?.stories))
await check('admin endpoint rejects anonymous request', '/api/pending', {}, r => r.status === 401)
await check('M-Pesa callback accepts empty callback safely', '/api/giving/mpesa/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, r => r.status === 200)
await check('unknown API route does not expose stack trace', '/api/__smoke_unknown__', {}, (r, _b, text) => r.status >= 400 && !/stack|node_modules|file:\/\//i.test(text))

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
