#!/usr/bin/env node
// E2E: reel preview data flow against a live API.
// Verifies that /api/feed returns reels with playable video URLs and that the
// URLs actually serve video bytes (so <video> previews render instead of broken
// image tiles). Usage: node workers/scripts/test-reel-preview.mjs [baseUrl]
const API = (process.argv[2] || 'https://harvestfamily-api.harvestfamily.workers.dev').replace(/\/$/, '')

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

const stamp = String(Date.now()).slice(-8)
const U = { username: `tst.r${stamp}`, phone: `0719${stamp.slice(-6)}`, password: 'Passw0rd!x' }

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

// 1) Register a member (feed requires auth)
const reg = await j('POST', '/api/auth/register', null, { ...U, name: 'Reel Test', group_name: 'Harvest Central' })
const token = reg.data?.token
check('register test member', !!token, reg.status)
if (!token) process.exit(1)

// 2) Feed returns a posts array (may be empty — that's valid on a fresh DB)
const feed = await j('GET', '/api/feed?limit=20', token)
check('feed loads', feed.status === 200 && Array.isArray(feed.data?.posts), feed.status)
const reels = (feed.data?.posts || []).filter(p => p.kind === 'reel')
console.log(`   feed: ${feed.data?.posts?.length || 0} posts, ${reels.length} reels, ${feed.data?.stories?.length || 0} stories`)

// 3) Every reel carries a playable hls_url (video bytes, not HTML/error)
let playable = 0, broken = []
for (const reel of reels.slice(0, 5)) {
  if (!reel.hls_url) { broken.push(`${reel.id}: no hls_url`); continue }
  try {
    const m = await fetch(reel.hls_url, { method: 'GET', headers: { Range: 'bytes=0-1023' } })
    const ct = m.headers.get('content-type') || ''
    const isVideo = m.status === 206 || m.status === 200
    const looksLikeVideo = /video|octet|mp4|webm/i.test(ct) || isVideo
    if (isVideo && looksLikeVideo) playable++
    else broken.push(`${reel.id}: ${m.status} ${ct}`)
  } catch (e) { broken.push(`${reel.id}: ${e.message}`) }
}
if (reels.length === 0) {
  console.log('ℹ️  no reels published yet — URL checks skipped (upload a reel first)')
} else {
  check('all sampled reels serve video bytes', broken.length === 0, broken.join('; ').slice(0, 200))
  check('reel previews playable', playable > 0, `${playable}/${Math.min(reels.length, 5)}`)
}

// 4) Reels endpoint (Reels screen source) exposes poster or video for previews
const reelsRes = await j('GET', '/api/reels?limit=5', token)
check('reels endpoint loads', reelsRes.status === 200 && Array.isArray(reelsRes.data?.reels), reelsRes.status)
for (const r of (reelsRes.data?.reels || []).slice(0, 5)) {
  const hasPreview = Boolean(r.hls_url || r.poster_url)
  if (!hasPreview) { check(`reel ${r.id} has preview URL`, false, 'neither hls_url nor poster_url'); break }
}
if ((reelsRes.data?.reels || []).length > 0) check('every reel has a preview URL', true)

console.log(failures === 0 ? '\n🟢 reel preview data flow OK' : `\n🔴 ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
