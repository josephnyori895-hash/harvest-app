// Guardrails for the 2026 admin rebuild. These are source-contract tests: the
// admin screens are made of fetch calls and confirmations that a browser test
// would have to mock heavily, so we pin the exact behaviour that must survive
// future restyles — endpoints, gating, confirmations, loading and error states.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [admin, map, badge, app, auth, users, pending, departments, contentRoute, healthRoute, home, migration] = await Promise.all([
  read('src/components/Admin.tsx'),
  read('src/components/HarvestMap.tsx'),
  read('src/components/VerifiedBadge.tsx'),
  read('src/App.jsx'),
  read('src/state/auth.tsx'),
  read('workers/src/routes/users.js'),
  read('workers/src/routes/pending.js'),
  read('workers/src/routes/departments.js'),
  read('workers/src/routes/content.js'),
  read('workers/src/routes/adminHealth.js'),
  read('src/components/Home.tsx'),
  read('workers/migrations/0037_department_visibility.sql'),
])

test('admin centre is one redesigned shell with grouped, accessible navigation', () => {
  assert.match(admin, /data-testid="admin-shell"/, 'admin shell is missing')
  assert.match(admin, /data-testid="admin-nav"/, 'admin navigation is missing')
  for (const panel of ['dashboard', 'accounts', 'ministries', 'moderation', 'announce', 'chat', 'audit', 'content']) {
    assert.match(admin, new RegExp(`data-testid="admin-${panel}"`), `${panel} panel is missing`)
  }
  assert.match(admin, /role="tablist"/, 'sections must be exposed as a tablist')
  assert.match(admin, /aria-selected=\{tab === value\}/, 'active section must be announced')
  assert.match(admin, /min-h-11/, 'controls must keep 44px touch targets')
  assert.match(admin, /rounded-card/, 'cards must use the design-system token')
})

test('admin can move a member into a ministry without leaving one first', () => {
  assert.match(admin, /data-testid="member-ministry"/, 'member ministry selector is missing')
  assert.match(
    admin,
    /api\/departments\/\$\{encodeURIComponent\(slug\)\}\/members/,
    'ministry assignment must call the department members endpoint',
  )
  assert.match(admin, /body: JSON\.stringify\(\{ username: u\.username, role: 'member' \}\)/, 'admin transfer payload is missing')
  assert.match(admin, /Changing this transfers the member straight away/, 'the transfer promise must be explained to the admin')
})

test('admin can rename a ministry (e.g. to HYP) directly from the control centre', () => {
  assert.match(admin, /renameMinistry/, 'ministry rename handler is missing')
  assert.match(admin, /method: 'PATCH'/, 'ministry rename must PATCH the department')
  assert.match(admin, /Ministry renamed to/, 'rename success feedback is missing')
  assert.match(admin, /Delete the ministry/, 'ministry deletion must require confirmation')
  assert.match(admin, /Ministry teams/, 'ministry manager heading is missing')
})

test('ministry visibility is admin-controlled and hidden teams stay private', () => {
  assert.match(migration, /ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1/, 'existing ministries must stay visible after migration')
  assert.match(admin, /toggleMinistryVisibility/, 'admin visibility control is missing')
  assert.match(admin, /is_public: next/, 'visibility toggle must send the new state')
  assert.match(admin, /Hidden from members/, 'hidden state must be explicit')
  assert.match(departments, /only the system admin can change ministry visibility/, 'visibility must be admin-only server-side')
  assert.match(departments, /d\.is_public=1 OR EXISTS/, 'members must see public ministries plus their own hidden team')
  assert.match(departments, /if \(!dep\.is_public && fresh\.role !== 'admin'\)/, 'hidden ministry detail must be protected')
})

test('support centre exposes safe, read-only operational checks', () => {
  assert.match(admin, /data-testid="admin-support"/, 'support panel is missing')
  assert.match(admin, /apiGet<any>\('\/api\/admin\/health'\)/, 'support panel must call the health endpoint')
  assert.match(admin, /Health & help/, 'support navigation is missing')
  assert.match(admin, /setTab\(check\.action\.tab as Tab\)/, 'health actions must link to the fixing workflow')
  assert.match(admin, /Counts contain no member data|counts contain no member data/i, 'diagnostics must explain what they share')
  assert.match(healthRoute, /if \(!user \|\| user\.role !== 'admin'\) return errorResponse\('admin required', 403\)/, 'health checks must be admin-only')
  assert.match(healthRoute, /request\.method !== 'GET'/, 'health checks must stay read-only')
  assert.doesNotMatch(healthRoute, /\b(INSERT|UPDATE|DELETE)\b/, 'health checks must never mutate data')
  for (const id of ['database', 'media', 'approvals', 'publishing', 'notifications']) {
    assert.match(healthRoute, new RegExp(`id: '${id}'`), `${id} check is missing`)
  }
  assert.match(admin, /dashboard\.health\.status !== 'ok'/, 'dashboard must surface failing checks')
})

test('logo and welcome artwork are editable, public and safely validated', () => {
  assert.match(contentRoute, /logo_url: 500/, 'logo URL key is missing')
  assert.match(contentRoute, /landing_hero_url: 500/, 'welcome photo key is missing')
  assert.match(contentRoute, /must be an http\(s\) image URL/, 'brand URLs must be validated')
  assert.match(admin, /data-testid="admin-brand-images"/, 'brand editor is missing')
  assert.match(admin, /setContentValue\('logo_url'/, 'logo editor is not wired to content')
  assert.match(admin, /setContentValue\('landing_hero_url'/, 'welcome photo editor is not wired to content')
  assert.match(app, /const brandLogo = siteArt\.logo_url \|\| '\/logo\.png'/, 'landing logo must use the saved artwork with a safe fallback')
  assert.match(app, /const landingHero = siteArt\.landing_hero_url \|\| '\/landing-worship\.jpg'/, 'landing photo must use the saved artwork with a safe fallback')
  assert.match(home, /content\.logo_url \|\| '\/logo\.png'/, 'signed-in Home must use the saved logo')
})

test('member verification is a first-class admin action with busy and error states', () => {
  assert.match(admin, /data-testid="member-verify"/)
  assert.match(admin, /verified: !u\.verified/, 'verify toggle must send the inverse flag')
  assert.match(admin, /disabled=\{busy === u\.username\}/, 'member actions must disable while saving')
  assert.match(admin, /Remove verification/, 'unverify action must be explicit')
  assert.match(admin, /Verification unlocks posts, reels, music and sermon uploads/, 'verification consequences must be explained')
})

test('member pagination cannot strand the admin on a page the filter removed', () => {
  assert.match(admin, /useEffect\(\(\) => \{ setAccountsPage\(1\) \}, \[q, accountFilter\]\)/,
    'search and filters both return to page one')
  assert.match(admin, /setAccountsPage\(Math.max\(1, safeAccountsPage - 1\)\)/,
    'Prev moves from the page actually displayed')
  assert.match(admin, /setAccountsPage\(Math.min\(accountsPages, safeAccountsPage \+ 1\)\)/,
    'Next moves from the page actually displayed')
})

test('admin dashboard shows live presence and new-member counts that actually load', () => {
  assert.match(admin, /online: \(u\.users \|\| \[\]\)\.filter\(\(member: any\) => member\.online\)\.length/)
  assert.match(admin, /verified: \(u\.users \|\| \[\]\)\.filter\(\(member: any\) => member\.verified\)\.length/)
  assert.match(admin, /Active now/)
  assert.match(admin, /Live member map/)
})

test('map gives admins a live summary, refresh and exact pins', () => {
  assert.match(map, /data-testid="admin-live-summary"/, 'admin live summary is missing')
  assert.match(map, /function formatPresence/, 'presence labels are missing')
  assert.match(map, /Active now/)
  assert.match(map, /onRefresh/, 'the map must expose a manual refresh')
  assert.match(map, /icon=\{memberPin\(u\)\}/, 'custom member pins are missing')
  assert.match(map, /match\(\/\[a-zA-Z0-9\]\/\)/, 'pin initials must be sanitised before HTML injection')
})

test('map API marks presence and ministry, and gives exact pins only to admins/mutual follows', () => {
  assert.match(users, /u\.last_seen, u\.created_at/, 'presence timestamps must reach the map')
  assert.match(users, /department_name/, 'member ministry must reach the admin directory')
  assert.match(users, /online: isOnline\(u\)/, 'online flag is missing')
  assert.match(users, /isAdmin \? \{ phone/, 'phone must remain admin-only')
  assert.match(users, /hidden: true, approx: true/, 'non-mutual members must stay approximate')
  assert.match(users, /location_updated_at=\?/, 'admin coordinate corrections must refresh location age')
})

test('the live directory covers every account type, including ordinary members', () => {
  assert.match(users, /FROM users u WHERE u\.active=1 ORDER BY u\.group_name/, 'all active accounts must be listed')
  assert.doesNotMatch(users, /WHERE u\.active=1 AND u\.verified/, 'normal members must not be filtered out')
  assert.match(admin, /accounts\.filter\(u => u\.verified\)\.length/, 'the verified count is only a filter, not the list source')
  assert.match(admin, /const filteredAccounts = accounts\.filter/, 'the member list must start from every account')
})

test('verification toggles write a well-formed audit row', () => {
  assert.match(pending, /VALUES \(\?,\?,\?, 'user', \?,\?,\?\)/, 'audit insert must match the audit_log columns')
  assert.match(pending, /user_verified/, 'verification audit action is missing')
  assert.match(pending, /user_unverified/, 'unverification audit action is missing')
  assert.doesNotMatch(pending, /\('verify_toggle'/, 'actor_role must not be used for the action name')
})

test('verification is server-authoritative and re-syncs without re-login', () => {
  assert.match(auth, /const USE_API/, 'auth must know when the API is authoritative')
  assert.match(auth, /if \(!USE_API\) \{/, 'legacy local verification must be offline-only')
  assert.match(app, /syncIdentity/, 'the app must re-read the member identity')
  assert.match(app, /window\.setInterval\(syncIdentity, 60_000\)/, 'identity must re-sync periodically')
  assert.match(app, /setVerified\(Boolean\(u\.verified\)\)/, 'server verification must update the session')
})

test('one premium verification seal is used everywhere', () => {
  assert.match(badge, /useId\(\)/, 'badge gradients must get a unique id')
  assert.match(badge, /linearGradient/, 'badge must use the brand gradient seal')
  assert.match(badge, /<title>\{label\}<\/title>/, 'badge must expose a readable title')
})

console.log('Admin, map, ministry and verification contract tests passed.')

test('the project sheet is a full campaign: progress, backers and share', async () => {
  const give = await readFile(new URL('../src/components/Give.tsx', import.meta.url), 'utf8')
  assert.match(give, /data-testid="campaign-progress"/, 'progress block is missing')
  assert.match(give, /role="progressbar"/, 'progress must be announced to assistive tech')
  assert.match(give, /function projectStats/, 'campaign maths must be shared by card and sheet')
  assert.ok(give.includes('Share project'), 'the share action is missing')
  assert.match(give, /navigator\.share/, 'native share must be attempted first')
  assert.match(give, /Project link copied/, 'the clipboard fallback must report success')
  assert.ok(give.includes('Backers'), 'the backers block is missing')
  assert.ok(give.includes('How do you want to take this?'), 'taking part must survive the new layout')
})

test('the admin map accounts for every member, including those who never shared', () => {
  assert.match(map, /function pinPosition/, 'unplaced members must still get a pin')
  assert.match(map, /Location not shared/, 'unshared locations must be labelled, not faked')
  assert.match(map, /const notSharing = users\.filter/, 'the header must explain missing pins')
  assert.ok(map.includes("!hasCoords(m) ? 'No pin'"), 'the member list must show the pin state')
})

test('no legacy emoji or dark card survives the swept screens', async () => {
  const swept = [
    'src/components/Toast.tsx', 'src/components/Protected.tsx',
    'src/components/VideoThumb.tsx', 'src/components/UploadPill.tsx', 'src/components/EditProfile.tsx',
    'src/components/Search.tsx', 'src/components/ViewUser.tsx', 'src/components/AdminMedia.tsx',
    'src/components/Admin.tsx', 'src/components/Departments.tsx',
    'src/components/SocialEditor.tsx', 'src/components/NotificationsScreen.jsx', 'src/App.jsx',
  ]
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
  for (const path of swept) {
    const src = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, EMOJI, `${path} still renders an emoji glyph`)
    assert.doesNotMatch(src, /bg-stone-(800|900|950)|border-stone-(700|800)/, `${path} still uses the old dark palette`)
  }
})

test('the floating message bubble is unread-only and replies in the compact card', () => {
  assert.match(app, /data-testid="chat-fab"/, 'the floating chat button is missing')
  assert.match(app, /chatUnread\.count > 0/, 'the bubble must only exist while messages are unread')
  assert.match(app, /const openChatBubble = \(\) => \{[\s\S]{0,500}setDmSheet\(true\)/, 'the bubble must open the compact reply card')
  assert.match(app, /onClick=\{openChatBubble\}/, 'the bubble must not navigate to the Chat tab')
  assert.match(app, /New messages, \$\{chatUnread\.count\} unread/, 'the bubble must announce its unread count')
  assert.match(app, /data-testid="dm-layer"/, 'the compact in-place reply card is missing')
})
