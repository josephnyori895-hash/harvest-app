// Proves the sponsored-advert feed contract against a LOCAL worker:
// placement after 6 organic items, per-member daily cap of 2, CTA passthrough.
//
// Requires the local D1 to be seeded (see docs/AUDIT_2026-10-29.md):
//   DELETE FROM advert_impressions;
//   site_content advert_settings = {"placement":"feed","interval":6,"daily_cap":2}
//   site_content sponsor_adverts = [{ id: "qa-ad-1", ... }]
import assert from 'node:assert/strict'

const API = process.env.API || 'http://127.0.0.1:8787'
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'harvest', pin: 'Kipsii@2026#' }) })
assert.equal(login.status, 200, `login failed: ${login.status}`)
const { token } = await login.json()
assert.ok(token, 'no token')

const feed = async () => {
  const r = await fetch(`${API}/api/feed?limit=30`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(r.status, 200, `feed failed: ${r.status}`)
  return r.json()
}

const first = await feed()
const posts = first.posts || []
const adIndexes = posts.map((p, i) => (p.kind === 'advert' ? i : -1)).filter(i => i >= 0)
console.log('page1 kinds:', posts.map(p => p.kind).join(','))
assert.ok(adIndexes.length > 0, 'no advert rendered')
// First advert must sit after 6 organic items (index 6 in a zero-based page).
assert.equal(adIndexes[0], 6, `first advert at ${adIndexes[0]}, expected 6`)

const ad = posts[adIndexes[0]]
assert.equal(ad.advert_id, 'qa-ad-1', 'wrong advert served')
assert.match(String(ad.caption), /QA advert body/, 'body not passed through')
assert.equal(ad.title, 'QA advert', 'title not passed through')
assert.equal(ad.image_url, 'https://example.org/qa.jpg', 'image_url must pass through unchanged')
assert.equal(ad.cta_url, 'https://example.org/qa', 'cta_url must pass through unchanged')
assert.equal(ad.name, 'Harvest Family', 'advert must be attributed to the church')

// Daily cap of two: the first two renders may serve it, the third must not.
const second = await feed()
const secondAds = (second.posts || []).filter(p => p.kind === 'advert').map(p => p.advert_id)
const third = await feed()
const thirdAds = (third.posts || []).filter(p => p.kind === 'advert').map(p => p.advert_id)
console.log('render 2 adverts:', secondAds, '| render 3 adverts:', thirdAds)
assert.ok(secondAds.includes('qa-ad-1'), 'cap of 2 should allow a second appearance')
assert.equal(thirdAds.length, 0, 'daily cap of 2 not enforced on the third render')

console.log('ADVERT FEED CONTRACT OK')
