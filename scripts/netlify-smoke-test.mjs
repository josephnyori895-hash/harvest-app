#!/usr/bin/env node

const base = (process.env.SMOKE_BASE_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Usage: SMOKE_BASE_URL=https://your-site.netlify.app npm run smoke:netlify')
  process.exit(2)
}

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
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message })
    console.error(`FAIL ${name}:`, error.message)
  }
}

await check('health', '/health', {}, (r, b) => r.status === 200 && b?.status === 'ok' && b?.pg === 'ok' && b?.storage === 'netlify-blobs' && b?.database === 'netlify-database')
await check('protected endpoint rejects anonymous request', '/api/me', {}, r => r.status === 401)
await check('admin endpoint rejects anonymous request', '/api/pending', {}, r => r.status === 401)
await check('member endpoint rejects anonymous request', '/api/feed', {}, r => r.status === 401)
await check('M-Pesa callback accepts empty callback safely', '/api/giving/mpesa/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, r => r.status === 200)
await check('unknown API route does not expose stack trace', '/api/__smoke_unknown__', {}, (r, _b, text) => r.status >= 400 && !/stack|node_modules|file:\/\//i.test(text))

console.log('\nNetlify smoke test:', checks.every(c => c.ok) ? 'PASS' : 'FAIL')
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)

if (!checks.every(c => c.ok)) process.exit(1)
