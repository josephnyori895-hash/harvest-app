#!/usr/bin/env node
// E2E test for the powers system: grants, one-department rule, location
// auto-assignment, admin direct adds. Usage: node scripts/test-powers.mjs [baseUrl]
const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
let failures = 0
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failures++ }

async function j(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}

const main = async () => {
  const admin = await j('POST', '/api/auth/login', null, { username: 'allan', password: 'Kipsii@2026#' })
  const AT = admin.data.token
  check('admin login', !!AT)

  const stamp = Date.now().toString().slice(-6)

  // ── Location-based auto-assignment at registration ──
  // Ruringu centroid ~(-0.432, 36.95)
  const geo = await j('POST', '/api/auth/register', null, { username: `geo${stamp}`, name: 'Geo Member', phone: `073${stamp}1`, password: 'password123', group_name: 'Harvest Central', lat: -0.4325, lng: 36.9505 })
  check('register with GPS succeeds', geo.status === 201 || geo.status === 200, geo.data.error || '')
  check('auto-assigned to nearest group (Ruringu)', geo.data.group_name === 'Harvest Ruringu' && geo.data.assigned_by === 'location', `got ${geo.data.group_name} via ${geo.data.assigned_by}`)

  // Non-GPS registration still works with chosen group.
  const plain = await j('POST', '/api/auth/register', null, { username: `plain${stamp}`, name: 'Plain Member', phone: `074${stamp}2`, password: 'password123', group_name: 'Harvest Skuta' })
  check('register without GPS uses chosen group', (plain.status === 201 || plain.status === 200) && plain.data.group_name === 'Harvest Skuta', `got ${plain.data.group_name}`)
  const MT = plain.data.token

  // ── Grants: admin grants post_media to a leader ──
  const grant = await j('PATCH', `/api/admin/users/plain${stamp}`, AT, { grants: ['post_media', 'manage_groups', 'create_groups'] })
  check('admin grants powers to leader', grant.status === 200 && grant.data.user?.grants === 'post_media,manage_groups,create_groups', JSON.stringify(grant.data.user?.grants))

  // Leader can now upload a post presign request (policy check only — R2 may be off).
  const lt = (await j('POST', '/api/auth/login', null, { username: `plain${stamp}`, password: 'password123' })).data.token
  const presign = await j('POST', '/api/media/presign', lt, { type: 'post', contentType: 'image/jpeg', bytes: 1000, ext: 'jpg' })
  // R2 is not enabled yet: presign may 500 on R2 config. Accept 200 OR the R2-not-ready error, but NOT 403.
  check('granted leader passes upload policy', presign.status !== 403, `got ${presign.status} ${presign.data.error || ''}`)

  // Member WITHOUT grants cannot.
  const mt = (await j('POST', '/api/auth/login', null, { username: `geo${stamp}`, password: 'password123' })).data.token
  const denied = await j('POST', '/api/media/presign', mt, { type: 'post', contentType: 'image/jpeg', bytes: 1000, ext: 'jpg' })
  check('ungranted member blocked from post upload (403)', denied.status === 403, `got ${denied.status}`)
  check('member can still request story upload (policy ok)', (await j('POST', '/api/media/presign', mt, { type: 'story', contentType: 'image/jpeg', bytes: 1000, ext: 'jpg' })).status !== 403)

  // ── One department per user ──
  const j1 = await j('POST', '/api/departments/ushering/join', mt)
  check('member joins ushering', j1.status === 200, j1.data.error || '')
  const j2 = await j('POST', '/api/departments/media/join', mt)
  check('second department blocked (one per user)', j2.status === 409, j2.data.error || '')
  await j('POST', '/api/departments/ushering/leave', mt)
  const j3 = await j('POST', '/api/departments/media/join', mt)
  check('after leaving, can join another', j3.status === 200)

  // Admin direct add overrides and moves the member.
  const am = await j('POST', '/api/departments/praise-worship/members', AT, { username: `geo${stamp}` })
  check('admin adds member to praise & worship (moves them)', am.status === 200, am.data.error || '')
  const mine = await j('GET', '/api/departments/mine', mt)
  check('member now only in praise & worship', mine.data.departments?.length === 1 && mine.data.departments[0].slug === 'praise-worship', JSON.stringify(mine.data.departments?.map(d => d.slug)))

  // ── Admin direct-add to a group (no request needed) ──
  const ga = await j('POST', '/api/groups/harvest_ruringu/members', AT, { username: `plain${stamp}` })
  check('admin adds member to specific group directly', ga.status === 200, ga.data.error || '')
  const gdet = await j('GET', '/api/groups/harvest_ruringu', AT)
  check('member visible in group roster', gdet.data.members?.some(m => m.username === `plain${stamp}`))

  // ── Leader with manage_groups can add directly too ──
  const ga2 = await j('POST', '/api/groups/harvest_skuta/members', lt, { username: `geo${stamp}` })
  check('granted leader adds member to group', ga2.status === 200, ga2.data.error || '')

  // ── create_groups cap ──
  const cg = await j('POST', '/api/groups', lt, { name: `LeaderGroup ${stamp}`, community: 'Harvest Central' })
  check('leader with create_groups creates a group', cg.status === 201, cg.data.error || '')
  const cgDeny = await j('POST', '/api/groups', mt, { name: `Nope ${stamp}` })
  check('ungranted member cannot create groups', cgDeny.status === 403, `got ${cgDeny.status}`)
  await j('DELETE', `/api/groups/${cg.data.group?.slug}`, AT)

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
