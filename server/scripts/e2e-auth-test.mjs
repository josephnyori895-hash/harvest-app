// In-process E2E: boot the Fastify app, run register/login flows, print results.
process.env.DATABASE_URL = 'postgres://harvest@127.0.0.1:5433/harvest'
process.env.DATABASE_SSL = 'false'
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
process.env.NODE_ENV = 'development'
process.env.PORT = '3101'

const { buildApp } = await import('/home/nyorii/Projects/church-harvest-harvestfamily/server/src/app.js')
const { runMigrations } = await import('/home/nyorii/Projects/church-harvest-harvestfamily/server/src/migrate.js')
const { pool } = await import('/home/nyorii/Projects/church-harvest-harvestfamily/server/src/db.js')

await runMigrations()
const app = await buildApp()
await app.ready()

const BASE = 'http://localhost:3101'
const results = []
async function step(name, path, body, expect) {
  try {
    const r = await app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json' }, payload: body })
    let b = null
    try { b = r.json() } catch {}
    const pass = r.statusCode === expect
    results.push({ name, pass, detail: `${r.statusCode} ${JSON.stringify(b).slice(0, 100)}` })
    if (!pass) console.log(`  body: ${JSON.stringify(b).slice(0, 300)}`)
    return b
  } catch (e) {
    results.push({ name, pass: false, detail: e.message })
    return null
  }
}

// 1. Health
{
  const r = await app.inject({ method: 'GET', url: '/health' })
  results.push({ name: 'health', pass: r.statusCode === 200, detail: `${r.statusCode} ${r.body.slice(0, 80)}` })
}

// 2. Register a member
const reg = await step('register member', '/api/auth/register', { username: 'joy_wambui', name: 'Joy Wambui', phone: '0712345678', password: 'blessed2026', group_name: 'Harvest Skuta' }, 201)
results.push({ name: 'register returns token', pass: Boolean(reg?.token), detail: reg ? `role=${reg.role} user=${reg.username}` : 'no body' })

// 3. Duplicate username
await step('duplicate username 409', '/api/auth/register', { username: 'joy_wambui', name: 'Joy Again', phone: '0799999999', password: 'password123' }, 409)

// 4. Duplicate phone
await step('duplicate phone 409', '/api/auth/register', { username: 'other_user', name: 'Other', phone: '0712345678', password: 'password123' }, 409)

// 5. Reserved username
await step('reserved username 409', '/api/auth/register', { username: 'allan', name: 'Fake', phone: '0722222222', password: 'password123' }, 409)

// 6. Weak password
await step('weak password 400', '/api/auth/register', { username: 'weak_pw', name: 'Weak', phone: '0733333333', password: '123' }, 400)

// 7. Bad phone
await step('bad phone 400', '/api/auth/register', { username: 'bad_phone', name: 'Bad', phone: '12345', password: 'password123' }, 400)

// 8. Allan by phone
const allanPhone = await step('allan login by phone 200', '/api/auth/login', { username: '0706300077', password: 'Kipsii@2026#' }, 200)
results.push({ name: 'allan role=admin', pass: allanPhone?.role === 'admin', detail: `role=${allanPhone?.role}` })

// 9. Allan by username
const allanUser = await step('allan login by username 200', '/api/auth/login', { username: 'allan', password: 'Kipsii@2026#' }, 200)

// 10. Allan by phone in +254 format
await step('allan login +254 format 200', '/api/auth/login', { username: '+254706300077', password: 'Kipsii@2026#' }, 200)

// 11. Wrong password
await step('wrong password 401', '/api/auth/login', { username: 'allan', password: 'WrongPass' }, 401)

// 12. Member login with their password
await step('member login by phone 200', '/api/auth/login', { username: '0712345678', password: 'blessed2026' }, 200)

// 13. Admin sees phones via /api/users/map
if (allanUser?.token) {
  const map = await app.inject({ method: 'GET', url: '/api/users/map', headers: { authorization: `Bearer ${allanUser.token}` } })
  const body = map.json()
  const withPhone = (body.users || []).filter(u => u.phone)
  results.push({ name: 'admin sees phone numbers', pass: map.statusCode === 200 && withPhone.length >= 1, detail: `${map.statusCode} users=${body.users?.length} withPhone=${withPhone.length}` })
  // 14. Admin token works on admin-only endpoint
  const pending = await app.inject({ method: 'GET', url: '/api/pending', headers: { authorization: `Bearer ${allanUser.token}` } })
  results.push({ name: 'allan accesses /api/pending', pass: pending.statusCode === 200, detail: `${pending.statusCode}` })
}

// 15. Member must NOT see phones
{
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: { username: '0712345678', password: 'blessed2026' } })
  const tok = login.json()?.token
  if (tok) {
    const map = await app.inject({ method: 'GET', url: '/api/users/map', headers: { authorization: `Bearer ${tok}` } })
    const body = map.json()
    const withPhone = (body.users || []).filter(u => u.phone)
    results.push({ name: 'member sees NO phone numbers', pass: map.statusCode === 200 && withPhone.length === 0, detail: `withPhone=${withPhone.length}` })
  }
}

console.log('\n========== E2E RESULTS ==========')
let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
}
console.log(`\n${failed === 0 ? 'ALL PASS ✓' : failed + ' FAILED'}`)

await pool.end()
process.exit(failed === 0 ? 0 : 1)
