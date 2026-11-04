// Guardrails for the 2026 admin rebuild. These are source-contract tests: the
// admin screens are made of fetch calls and confirmations that a browser test
// would have to mock heavily, so we pin the exact behaviour that must survive
// future restyles — endpoints, gating, confirmations, loading and error states.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [admin, map, badge, icons, app, auth, users, pending] = await Promise.all([
  read('src/components/Admin.tsx'),
  read('src/components/HarvestMap.tsx'),
  read('src/components/VerifiedBadge.tsx'),
  read('src/components/Icons.jsx'),
  read('src/App.jsx'),
  read('src/state/auth.tsx'),
  read('workers/src/routes/users.js'),
  read('workers/src/routes/pending.js'),
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

test('member verification is a first-class admin action with busy and error states', () => {
  assert.match(admin, /data-testid="member-verify"/)
  assert.match(admin, /verified: !u\.verified/, 'verify toggle must send the inverse flag')
  assert.match(admin, /disabled=\{busy === u\.username\}/, 'member actions must disable while saving')
  assert.match(admin, /Remove verification/, 'unverify action must be explicit')
  assert.match(admin, /Verification unlocks posts, reels, music and sermon uploads/, 'verification consequences must be explained')
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
  assert.match(icons, /export \{ VerifiedBadge \} from '\.\/VerifiedBadge'/, 'the legacy badge must be the same component')
  assert.doesNotMatch(icons, /text-green-600/, 'the old green badge must be gone')
})

console.log('Admin, map, ministry and verification contract tests passed.')
