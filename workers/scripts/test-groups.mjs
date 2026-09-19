#!/usr/bin/env node
// End-to-end test for the Groups feature against a running worker.
// Usage: node scripts/test-groups.mjs [baseUrl]   (default http://localhost:8787)
const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')

let failures = 0
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

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
  // ── Setup: tokens ──
  const admin = await j('POST', '/api/auth/login', null, { username: 'harvest', password: 'Kipsii@2026#' })
  check('admin login (harvest)', admin.status === 200 && !!admin.data.token, admin.data.error || '')
  const AT = admin.data.token

  const stamp = Date.now().toString().slice(-6)
  const memberReg = await j('POST', '/api/auth/register', null, {
    username: `gtest${stamp}`, name: 'Grace Tester', phone: `07${stamp}12`, password: 'password123', group_name: 'Harvest Central',
  })
  const MT = memberReg.data.token || (await j('POST', '/api/auth/login', null, { username: `gtest${stamp}`, password: 'password123' })).data.token
  check('member registered + login', !!MT)

  // ── Community rule: max 10 groups per community ──
  const list0 = await j('GET', '/api/groups', AT)
  check('group list includes communities map', list0.status === 200 && typeof list0.data.communities === 'object', JSON.stringify(list0.data.communities || {}))
  const centralCount = list0.data.communities['Harvest Central'] || 0
  check('seeded groups assigned to communities', centralCount >= 2, `Harvest Central has ${centralCount}`)

  // Create until limit (max 10) is hit — but only a couple of extra groups needed.
  const over = await j('POST', '/api/groups', AT, { name: `LimitProbe ${stamp}`, community: 'Harvest Central', admin_username: '', creator_participation: 'none' })
  check('create group within limit succeeds', over.status === 201, over.data.error || '')

  // ── Core flow: admin creates + appoints group admin, stays OUT (none) ──
  const created = await j('POST', '/api/groups', AT, {
    name: `FlowTest ${stamp}`, community: 'Harvest Central',
    admin_username: `gtest${stamp}`, creator_participation: 'none',
  })
  check('create group + appoint group admin + creator stays out', created.status === 201, created.data.error || '')
  const slug = created.data.group?.slug

  const mine0 = await j('GET', '/api/groups/mine', AT)
  check('creator not a member (participation none)', !mine0.data.groups?.some(g => g.slug === slug))

  // ── Join request flow (creator requests, group admin approves) ──
  const jr = await j('POST', `/api/groups/${slug}/join`, AT)
  check('system admin can request to join', jr.status === 201 || jr.status === 200, jr.data.error || '')
  const reqs = await j('GET', `/api/groups/${slug}/requests`, MT)
  check('group admin sees pending requests', reqs.status === 200 && reqs.data.requests?.length >= 1, reqs.data.error || '')
  const rid = reqs.data.requests?.[0]?.id
  const ap = await j('POST', `/api/groups/${slug}/requests/${rid}/approve`, MT, { approve: true })
  check('group admin approves request', ap.status === 200 && ap.data.status === 'approved', ap.data.error || '')
  const det = await j('GET', `/api/groups/${slug}`, AT)
  check('approver + requester both now members', det.data.members?.some(m => m.username === 'harvest') && det.data.members?.some(m => m.username === `gtest${stamp}`))

  // ── Participation variants: stay as member ──
  const created2 = await j('POST', '/api/groups', AT, {
    name: `StayMember ${stamp}`, community: 'Harvest Central', admin_username: `gtest${stamp}`, creator_participation: 'member',
  })
  check('create group staying as member', created2.status === 201, created2.data.error || '')
  const mine1 = await j('GET', '/api/groups/mine', AT)
  check('creator stayed as plain member', mine1.data.groups?.some(g => g.slug === created2.data.group?.slug && g.my_role === 'member'))

  // ── Role management ──
  const promo = await j('POST', `/api/groups/${slug}/role`, MT, { username: 'harvest', role: 'admin' })
  check('group admin promotes member to admin', promo.status === 200 && promo.data.role === 'admin', promo.data.error || '')
  const demo = await j('POST', `/api/groups/${slug}/role`, MT, { username: 'harvest', role: 'member' })
  check('group admin demotes back to member', demo.status === 200 && demo.data.role === 'member', demo.data.error || '')

  // ── Leave rules ──
  const leaveGA = await j('POST', `/api/groups/${slug}/leave`, MT)
  check('only group admin cannot leave (guard)', leaveGA.status === 400, leaveGA.data.error || '')
  const leaveMem = await j('POST', `/api/groups/${slug}/leave`, AT)
  check('normal member can leave', leaveMem.status === 200, leaveMem.data.error || '')
  const rejoin = await j('POST', `/api/groups/${slug}/join`, AT)
  check('can re-request after leaving', rejoin.status === 200 || rejoin.status === 201)
  const reqs2 = await j('GET', `/api/groups/${slug}/requests`, MT)
  const ap2 = await j('POST', `/api/groups/${slug}/requests/${reqs2.data.requests?.[0]?.id}/approve`, MT, { approve: true })
  check('group admin re-approves', ap2.status === 200)

  // ── Guards ──
  const noauth = await j('POST', `/api/groups/${slug}/role`, null, { username: 'x', role: 'admin' })
  check('unauthenticated blocked (401)', noauth.status === 401)
  const demoteSelf = await j('POST', `/api/groups/${slug}/role`, AT, { username: `gtest${stamp}`, role: 'member' })
  check('system admin can demote last group admin (by design)', demoteSelf.status === 200, demoteSelf.data.error || '')

  // ── Member permissions ──
  const memberCreate = await j('POST', '/api/groups', MT, { name: 'Hack Group' })
  check('member cannot create groups', memberCreate.status === 403 || memberCreate.status === 401, `got ${memberCreate.status}`)

  // ── Cleanup: delete created groups ──
  const del1 = await j('DELETE', `/api/groups/${slug}`, AT)
  const del2 = await j('DELETE', `/api/groups/${over.data.group?.slug}`, AT)
  const del3 = await j('DELETE', `/api/groups/${created2.data.group?.slug}`, AT)
  check('system admin deletes test groups', del1.status === 200 && del2.status === 200 && del3.status === 200)

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
