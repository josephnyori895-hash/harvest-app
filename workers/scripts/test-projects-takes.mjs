// E2E: team takes — take a project as a group/department/community, others
// opt in to help. No duplicate helper rows, per-take totals verified.
// Usage: node scripts/test-projects-takes.mjs [baseUrl]   (default http://localhost:8787)
// LOCAL:/ wrangler dev --port 8787: team takes — take as group/department/
// community, others opt in to help, no duplicate helper rows, individual
// flow untouched. Cleans up: deletes the probe project (cascades).
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
check('admin login', admin.status === 200 && !!admin.data?.token)
const AT = admin.data.token

const created = await j('POST', '/api/projects/admin', AT, { name: `TakeProbe ${stamp}`, description: 'probe', goal_kes: 50000, status: 'active' })
check('create project', created.status === 201 && !!created.data?.project?.id, created.data?.error || '')
const pid = created.data.project.id

const reg1 = await j('POST', '/api/auth/register', null, { username: `tst.t1${stamp}`, phone: `0721${stamp.slice(-6)}`, password: 'Passw0rd!x', name: 'Take One', group_name: 'Harvest Central' })
const reg2 = await j('POST', '/api/auth/register', null, { username: `tst.t2${stamp}`, phone: `0722${stamp.slice(-6)}`, password: 'Passw0rd!x', name: 'Take Two', group_name: 'Harvest Central' })
check('two members registered', reg1.status === 201 && reg2.status === 201, `${reg1.status}/${reg2.status}`)
const T1 = reg1.data.token, T2 = reg2.data.token

// 1) Take as a group
const take1 = await j('POST', `/api/projects/${pid}/participate`, T1, { take: { kind: 'group', name: 'Harvest Ruringu' }, commitment_kes: 5000, note: 'Sunday pledge' })
check('take as group', take1.status === 200 && !!take1.data?.take?.id, take1.data?.error || String(take1.status))
check('taker recorded', take1.data?.take?.taken_by?.username === `tst.t1${stamp}`, JSON.stringify(take1.data?.take?.taken_by))
const takeId = take1.data?.take?.id

// 2) Help an existing take
const help = await j('POST', `/api/projects/${pid}/participate`, T2, { take: { take_id: takeId }, commitment_kes: 2000 })
check('member opts to help', help.status === 200 && help.data?.helper?.take_id === takeId, help.data?.error || String(help.status))
check('helpers_count = 2', help.data?.take?.helpers_count === 2, String(help.data?.take?.helpers_count))
check('total committed = 7000', Number(help.data?.take?.total_committed_kes) === 7000, String(help.data?.take?.total_committed_kes))

// 3) Duplicate-help check: same member again updates, never double-rows
const again = await j('POST', `/api/projects/${pid}/participate`, T2, { take: { take_id: takeId }, commitment_kes: 3000 })
check('second help updates, no dup row', again.status === 200 && again.data?.take?.helpers_count === 2, String(again.data?.take?.helpers_count))
check('total committed = 8000 after update', Number(again.data?.take?.total_committed_kes) === 8000, String(again.data?.take?.total_committed_kes))

// 4) get-or-create on same entity by name returns the SAME take
const sameName = await j('POST', `/api/projects/${pid}/participate`, T2, { take: { kind: 'group', name: 'Harvest Ruringu' }, commitment_kes: 0 })
check('participate by same (kind,name) hits same take', sameName.data?.take?.id === takeId, String(sameName.data?.take?.id))

// 5) Department + community takes
const dep = await j('POST', `/api/projects/${pid}/participate`, T1, { take: { kind: 'department', name: 'Praise & Worship' }, commitment_kes: 1000 })
check('take as department', dep.status === 200 && dep.data?.take?.kind === 'department')
const com = await j('POST', `/api/projects/${pid}/participate`, T1, { take: { kind: 'community', name: 'Harvest Central' }, commitment_kes: 500 })
check('take as community', com.status === 200 && com.data?.take?.kind === 'community')

// 6) Individual flow untouched
const individual = await j('POST', `/api/projects/${pid}/participate`, T2, { commitment_kes: 1000, reminder_enabled: true })
check('individual participation still works', individual.status === 200 && !!individual.data?.project?.mine, individual.data?.error || '')
const list = await j('GET', `/api/projects/${pid}`, T2)
check('project exposes takes in GET', (list.data?.project?.takes || []).length === 3, String(list.data?.project?.takes?.length))
check('mine_take exposes helper state', list.data?.project?.mine_take?.take_id === takeId, JSON.stringify(list.data?.project?.mine_take))

// 7) Bad kinds rejected
const badKind = await j('POST', `/api/projects/${pid}/participate`, T1, { take: { kind: 'everyone', name: 'x' }, commitment_kes: 1 })
check('invalid take kind 400', badKind.status === 400, String(badKind.status))

// 8) Cleanup — cascade removes takes/helpers
const del = await j('DELETE', `/api/projects/admin/${pid}`, AT)
check('cleanup delete project', del.status === 200, del.data?.error || '')
const after = await j('GET', `/api/projects/${pid}`, T2)
check('project gone', after.status === 404, String(after.status))

console.log(fail ? '\n🔴 takes flow FAILED' : '\n🟢 team-take + help flow OK')
process.exit(fail ? 1 : 0)
