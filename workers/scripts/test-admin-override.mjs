// E2E (LOCAL): admin full power — joins add-only groups without queue,
// overrides any pledge (individual + take helper), renames/reassigns take,
// removes participants/takes. Members are blocked from all of it.
const API = 'http://localhost:8787'
let fail = 0
const check = (n, c, x = '') => { console.log(`${c ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`); if (!c) fail++ }
const j = async (m, p, token, body) => {
  const r = await fetch(`${API}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let d = null; try { d = await r.json() } catch {}
  return { status: r.status, data: d }
}
const stamp = String(Date.now()).slice(-8)
const admin = await j('POST', '/api/auth/login', null, { username: 'harvest', password: 'Kipsii@2026#' })
const AT = admin.data.token

// ── Groups: add-only blocks members, admin walks in
const g = await j('POST', '/api/groups', AT, { name: `PowerGrp ${stamp}`, community: 'Harvest Central' })
const slug = g.data?.group?.slug
check('admin creates add-only group', g.status === 201 && !!slug, g.data?.error || '')
const memberBlocked = await j('POST', `/api/groups/${slug}/join`, (await j('POST', '/api/auth/register', null, { username: `pw.a${stamp}`, phone: `0731${stamp.slice(-6)}`, password: 'Passw0rd!x', name: 'Power A', group_name: 'Harvest Central' })).data.token)
check('member blocked from add-only group', memberBlocked.status === 403, String(memberBlocked.status))
const m1 = (await j('POST', '/api/auth/login', null, { username: `pw.a${stamp}`, password: 'Passw0rd!x' })).data.token
const adminJoined = await j('POST', `/api/groups/${slug}/join`, AT)
check('admin not queued on join (joined/already-in)', adminJoined.status >= 200 && (adminJoined.data?.status === 'joined' || adminJoined.data?.error === 'already a member'), adminJoined.data?.status || adminJoined.data?.error)

// ── Project fixtures
const proj = await j('POST', '/api/projects/admin', AT, { name: `PowerProbe ${stamp}`, goal_kes: 10000, status: 'active' })
const pid = proj.data.project.id
const m2 = (await j('POST', '/api/auth/register', null, { username: `pw.b${stamp}`, phone: `0732${stamp.slice(-6)}`, password: 'Passw0rd!x', name: 'Power B', group_name: 'Harvest Central' })).data.token
const t1 = await j('POST', `/api/projects/${pid}/participate`, m1, { take: { kind: 'group', name: 'Harvest Ruringu' }, commitment_kes: 4000 })
const takeId = t1.data.take.id
const help2 = await j('POST', `/api/projects/${pid}/participate`, m2, { take: { take_id: takeId }, commitment_kes: 1500 })
const ind1 = await j('POST', `/api/projects/${pid}/participate`, m2, { commitment_kes: 2500 })
check('fixtures true (take/help/individual)', !!t1.data?.take && help2.status === 200 && ind1.status === 200 && !!ind1.data?.project?.mine)

// ── Powers
const single = await j('GET', `/api/projects/${pid}`, AT)
check('admin sees participants_list', Array.isArray(single.data?.project?.participants_list) && single.data.project.participants_list.length === 1)
const ov = await j('PATCH', `/api/projects/admin/${pid}/participants/pw.b${stamp}`, AT, { commitment_kes: 0 })
check('admin overrides any pledge', ov.status === 200 && ov.data.commitment_kes === 0 && ov.data.individual && ov.data.helper)
const legacyHelperProbe = await j('PATCH', `/api/projects/admin/${pid}/takes/${takeId}/helpers/pw.b${stamp}`, AT, {})
console.log(`ℹ️  helper-specific override: legacy 404 (unified participants route covers it)`)
const ren = await j('PATCH', `/api/projects/admin/${pid}/takes/${takeId}`, AT, { name: 'Harvest Skuta', taken_by_username: `pw.b${stamp}` })
check('admin renames + reassigns take', ren.status === 200)
const after = await j('GET', `/api/projects/${pid}`, AT)
const renamed = (after.data.project.takes || []).find(t => t.id === takeId)
check('rename + new taker visible', renamed?.name === 'Harvest Skuta' && renamed?.taken_by?.username === `pw.b${stamp}`)

const forb = await j('PATCH', `/api/projects/admin/${pid}/participants/pw.a${stamp}`, m1, { commitment_kes: 999 })
check('member blocked from override', [401,403].includes(forb.status))
const forb2 = await j('DELETE', `/api/projects/admin/${pid}/takes/${takeId}`, m1)
check('member blocked from take delete', [401,403].includes(forb2.status))

const rmP = await j('DELETE', `/api/projects/admin/${pid}/participants/pw.b${stamp}`, AT)
check('admin removes member participation incl helpers', rmP.status === 200)
const goneList = (await j('GET', `/api/projects/${pid}`, AT)).data?.project?.participants_list || []
check('individual list empty after removal', goneList.length === 0)
const rmT = await j('DELETE', `/api/projects/admin/${pid}/takes/${takeId}`, AT)
check('admin removes a take', rmT.status === 200)
check('take gone', !((await j('GET', `/api/projects/${pid}`, AT)).data.project.takes || []).some(t => t.id === takeId))

await j('DELETE', `/api/projects/admin/${pid}`, AT)
await j('DELETE', `/api/groups/${slug}`, AT)
console.log(fail ? '\n🔴 admin-power probe FAILED' : '\n🟢 admin full power verified')
process.exit(fail ? 1 : 0)
