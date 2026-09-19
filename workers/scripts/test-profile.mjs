#!/usr/bin/env node
// E2E check for profile editing + avatar upload against a local wrangler dev server.
const API = (process.argv[2] || 'http://localhost:8799').replace(/\/$/, '')
let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}
async function j(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}
const stamp = String(Date.now()).slice(-8)
const U = { username: `tst.p${stamp}`, phone: `0725${stamp.slice(-6)}`, password: 'Passw0rd!x' }
const r0 = await j('POST', '/api/auth/register', null, { ...U, name: 'Profile Test', group_name: 'Harvest Central' })
const tok = r0.data?.token
check('register test user', !!tok, r0.status)

// 1. Profile text edits via PATCH /api/me
let r = await j('PATCH', '/api/me', tok, { name: 'Joseph Kimathi', location: 'Nyeri Town', faith: 'Saved by grace', group_name: 'Harvest Ruringu' })
check('PATCH /api/me saves name/location/faith/group', r.status === 200 && r.data?.user?.name === 'Joseph Kimathi' && r.data?.user?.location === 'Nyeri Town' && r.data?.user?.faith === 'Saved by grace' && r.data?.user?.group_name === 'Harvest Ruringu', JSON.stringify(r.data))

// 2. Empty name rejected
r = await j('PATCH', '/api/me', tok, { name: '   ' })
check('empty name rejected', r.status === 400, r.status)

// 3. Phone normalize + uniqueness
r = await j('PATCH', '/api/me', tok, { phone: '0725 123 456' })
check('phone normalizes to +254 format', r.status === 200 && r.data?.user?.phone === '+254725123456', JSON.stringify(r.data?.user?.phone))
const U2 = { username: `tst.q${stamp}`, phone: `0726${stamp.slice(-6)}`, password: 'Passw0rd!x' }
const r0b = await j('POST', '/api/auth/register', null, { ...U2, name: 'Other Test', group_name: 'Harvest Central' })
const tok2 = r0b.data?.token
// User 1 currently holds +254725123456 — user 2 must not be able to claim it.
r = await j('PATCH', '/api/me', tok2, { phone: '0725 123 456' })
check('duplicate phone rejected', r.status === 409, r.status)
r = await j('PATCH', '/api/me', tok, { phone: '' })
check('empty phone clears it', r.status === 200 && (r.data?.user?.phone ?? null) === null, JSON.stringify(r.data?.user?.phone))

// 4. Invalid group rejected
r = await j('PATCH', '/api/me', tok, { group_name: 'Nairobi West' })
check('invalid group rejected', r.status === 400, r.status)

// 5. Avatar key validation (no real upload — server must reject bogus keys)
r = await j('PATCH', '/api/me', tok, { avatar_key: 'originals/story/2026/01/evil.jpg' })
check('non-avatar key rejected', r.status === 400, r.status)
r = await j('PATCH', '/api/me', tok, { avatar_key: 'originals/avatar/2026/09/00000000-0000-4000-8000-000000000000.jpg' })
check('missing avatar object rejected', r.status === 404, r.status)

// 6. GET /api/me returns avatar_url field (null when no avatar)
r = await j('GET', '/api/me', tok)
check('GET /api/me includes avatar_url', r.status === 200 && 'avatar_url' in (r.data?.user || {}), JSON.stringify(r.data?.user?.avatar_url))

// 7. Directory includes avatar_url
r = await j('GET', '/api/users/map', tok)
const listed = (r.data?.users || []).find(u => u.username === U.username)
check('users/map includes avatar_url', r.status === 200 && listed && 'avatar_url' in listed)

// 8. Search includes avatar_url
r = await j('GET', '/api/users?q=profile', tok)
check('user search includes avatar_url', r.status === 200 && (r.data?.users?.[0] ? 'avatar_url' in r.data.users[0] : true))

// 9. media/confirm must not accept avatar type
r = await j('POST', '/api/media/confirm', tok, { key: 'originals/avatar/2026/09/00000000-0000-4000-8000-000000000000.jpg', type: 'avatar' })
check('media/confirm rejects avatar type', r.status === 400, r.status)

// 10. Presign policy: avatar allowed for members, real upload + attach round-trip
r = await j('POST', '/api/media/presign', tok, { type: 'avatar', contentType: 'image/png', bytes: 1000, ext: 'png' })
check('avatar presign allowed for member', r.status === 200 && r.data?.key?.startsWith('originals/avatar/'), r.status)
if (r.status === 200 && r.data?.url === '/api/media/upload') {
  // Proxy fallback path (no R2 creds locally): upload through the worker, then attach.
  const form = new FormData()
  form.append('key', r.data.key)
  form.append('contentType', 'image/png')
  // 1x1 transparent PNG
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  form.append('file', new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' }), 'avatar.png')
  const up = await fetch(`${API}/api/media/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: form })
  check('avatar upload via proxy', up.status === 201, up.status)
  const attach = await j('PATCH', '/api/me', tok, { avatar_key: r.data.key })
  check('avatar attach via PATCH /api/me', attach.status === 200 && !!attach.data?.user?.avatar_url, JSON.stringify(attach.data?.user?.avatar_url)?.slice(0, 60))
  const meAfter = await j('GET', '/api/me', tok)
  check('GET /api/me returns signed avatar url', meAfter.status === 200 && /^https?:\/\/.+\/api\/media\/.+/.test(meAfter.data?.user?.avatar_url || ''), String(meAfter.data?.user?.avatar_url || '').slice(0, 60))
  const rm = await j('PATCH', '/api/me', tok, { avatar_key: null })
  check('avatar removal clears it', rm.status === 200 && (rm.data?.user?.avatar_url ?? null) === null, JSON.stringify(rm.data?.user?.avatar_url))
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS')
process.exit(failures ? 1 : 0)
