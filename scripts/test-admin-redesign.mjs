// Guardrails for the 2026 admin rebuild. These are source-contract tests: the
// admin screens are made of fetch calls and confirmations that a browser test
// would have to mock heavily, so we pin the exact behaviour that must survive
// future restyles — endpoints, gating, confirmations, loading and error states.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [admin, map, badge, app, auth, users, pending, departments, contentRoute, healthRoute, home, migration, realtime, adminDevices, groupsScreen, payments, groupsRoute, authRoute, protectedScreen] = await Promise.all([
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
  read('workers/src/realtime.js'),
  read('workers/src/lib/adminDevices.js'),
  read('src/components/Groups.tsx'),
  read('src/components/GivingPaymentEditor.tsx'),
  read('workers/src/routes/groups.js'),
  read('workers/src/routes/auth.js'),
  read('src/components/Protected.tsx'),
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

test('admin is six destinations, each with its own workspace sections', () => {
  assert.match(admin, /const WORKSPACES/, 'the six-destination map is missing')
  for (const label of ['Dashboard', 'People & Structure', 'Content & Publishing', 'Giving & Finance', 'Community', 'App Settings & Security']) {
    assert.ok(admin.includes(label), `${label} destination is missing`)
  }
  assert.match(admin, /aria-label="Administration destinations"/, 'the destination list needs an accessible name')
  assert.match(admin, /data-testid="admin-workspace"/, 'each destination needs its workspace header')
  assert.match(admin, /aria-label=\{`\$\{active\.label\} sections`\}/, 'workspace sub-sections must be a labelled tablist')
  assert.match(admin, /aria-haspopup="menu"/, 'the central Create action needs a menu affordance')
  assert.match(admin, /role="menuitem"/, 'Create must offer real creation routes')
  // Every pre-existing screen stays reachable: no feature was dropped in the
  // consolidation, only regrouped.
  for (const section of ['dashboard', 'accounts', 'moderation', 'ministries', 'publishing', 'announce', 'home', 'content', 'media', 'give', 'chat', 'adverts', 'audit', 'support']) {
    assert.ok(admin.includes(`['${section}'`), `section ${section} is no longer reachable`)
  }
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
  assert.match(contentRoute, /landing_background_url: 1400/, 'landing background photo key is missing')
  assert.match(contentRoute, /must be an http\(s\) image URL/, 'brand URLs must be validated')
  assert.match(contentRoute, /k === 'landing_background_url'[\s\S]{0,600}at most 8 photos/, 'the rotating background list must be validated too')
  assert.match(admin, /data-testid="admin-brand-images"/, 'brand editor is missing')
  assert.match(admin, /setContentValue\('logo_url'/, 'logo editor is not wired to content')
  assert.match(admin, /setContentValue\('landing_hero_url'/, 'welcome photo editor is not wired to content')
  assert.match(admin, /setContentValue\('landing_background_url'/, 'landing background editor is not wired to content')
  assert.match(app, /landing_background_url: String\(d\?\.content\?\.landing_background_url \|\| ''\)/, 'the landing must read the saved background photo')
  assert.match(app, /const brandLogo = siteArt\.logo_url \|\| '\/logo\.png'/, 'landing logo must use the saved artwork with a safe fallback')
  assert.match(app, /const landingHero = siteArt\.landing_hero_url \|\| '\/landing\/hero\.jpg'/, 'landing photo must use the saved artwork with a safe fallback')
  assert.match(home, /content\.logo_url \|\| '\/logo\.png'/, 'signed-in Home must use the saved logo')
})

test('social media links are admin-managed and rendered on the landing page', () => {
  assert.match(contentRoute, /social_instagram_url: 300/, 'Instagram link key is missing')
  assert.match(contentRoute, /social_youtube_url: 300/, 'YouTube link key is missing')
  assert.match(contentRoute, /social_tiktok_url: 300/, 'TikTok link key is missing')
  assert.match(contentRoute, /must be a full http\(s\) link or a @handle/, 'social links must reject unsafe values')
  assert.match(admin, /data-testid="admin-social-links"/, 'social link editor is missing')
  assert.match(admin, /key: 'social_instagram_url'/, 'Instagram editor is missing from the social card')
  assert.match(admin, /key: 'social_tiktok_url'[\s\S]{0,1400}setContentValue\(f\.key/, 'social inputs are not wired to content')
  assert.match(admin, /Share profile \/ Copy profile link/, 'the Instagram instructions must tell the admin where the link lives')
  assert.match(admin, /Copy channel link/, 'the YouTube instructions must tell the admin where the link lives')
  assert.match(admin, /Share profile, then Copy link/, 'the TikTok instructions must tell the admin where the link lives')
  assert.match(app, /social_instagram_url: String\(d\?\.content\?\.social_instagram_url \|\| ''\)/, 'the landing must read the saved social links')
  assert.match(app, /target="_blank"/, 'social icons must open in a new tab')
  assert.match(app, /rel="noopener noreferrer"/, 'external social links must not leak the opener')
  assert.match(app, /aria-label=\{`\$\{churchName\} on \$\{l\.label\}`\}/, 'each social icon needs an accessible label')
  assert.match(app, /fallback: 'https:\/\/instagram\.com\/'/, 'an unset Instagram link must still point at Instagram')
  assert.match(app, /fallback: 'https:\/\/youtube\.com\/'/, 'an unset YouTube link must still point at YouTube')
  assert.match(app, /fallback: 'https:\/\/tiktok\.com\/'/, 'an unset TikTok link must still point at TikTok')
})

test('admin sign-in approval actually reaches the admin phone', () => {
  // The DO's /publish route used to replay the frame through handleEvent,
  // which expects a verified token payload. A username string has no user.id,
  // so every server-published event was dropped and no approval popup or code
  // ever reached the phone.
  assert.match(realtime, /pathname === '\/publish'[\s\S]{0,900}sendToUser\(username/, 'server-published events must be delivered straight to the member sockets')
  assert.doesNotMatch(realtime, /handleEvent\(frame\.user/, 'a publish frame must not be replayed as a client event')
  const listener = app.indexOf("onSocket('admin:login-request'")
  const nav = app.indexOf('function Nav(')
  assert.ok(listener > 0, 'the phone must listen for admin sign-in requests')
  assert.ok(listener < nav, 'the approval listener must live on the signed-in screen, not inside Nav')
  assert.ok(app.indexOf('const decideAdminLogin') < nav, 'the approval handler must share scope with the modal state')
  assert.match(app, /data\.device_kind === me\.device_kind && data\.device_id === me\.device_id/, 'a device must never approve its own sign-in request')
  assert.match(realtime, /sendToUser\(username, \{ event: String\(frame\.event\)/, 'the phone must get the approval event over its socket')
  assert.doesNotMatch(auth, /approve sign-ins from the admin phone, not a browser/, 'a trusted browser session must be able to approve too')
  assert.match(adminDevices, /this is the device asking to sign in/, 'the server must refuse a self-approval even if a client asks')
})

test('admin sign-in never waits for a code no channel can deliver', () => {
  // A phone with no push token (permission denied, token not yet issued, FCM
  // unconfigured) makes the server answer delivery 'unavailable'. The screen
  // used to keep saying a code was on its way, so the admin waited forever for
  // a message that could never arrive. That branch must always be handled.
  assert.match(app, /data\.delivery === 'unavailable' && Boolean\(data\.recovery_available\)/, 'the screen must react to an undeliverable code')
  assert.match(app, /setShowRecovery\(noDelivery\)/, 'an undeliverable code must open the recovery route immediately')
  assert.match(app, /adminChallenge\.delivery === 'push'/, 'only a real push may promise a sent code')
  assert.match(app, /Open the Harvest app on the phone bound to/, 'the no-push path must say where the code appears')
  assert.match(protectedScreen, /if \(data\.verification_required\)/, 'the admin gate must not report a device challenge as a failed login')
  assert.match(protectedScreen, /sign out and sign in again to approve it/, 'the admin gate must point at the screen that can approve a device')
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

test('the map re-measures its container instead of trusting the mount size', () => {
  // Leaflet measures once on mount. A lazy chunk mounted into a column that had
  // not settled, and a WebView resized by rotation or by returning from the
  // background, both left tiles drawn into part of the box with pins offset.
  assert.match(map, /function KeepMapSized/, 'the map needs a container-size keeper')
  assert.match(map, /map\.invalidateSize\(\{ animate: false \}\)/, 'resizing must re-measure Leaflet')
  assert.match(map, /new ResizeObserver\(measure\)/, 'the container itself must be observed')
  assert.match(map, /window\.addEventListener\('orientationchange', measure\)/, 'rotation must re-measure')
  assert.match(map, /document\.addEventListener\('visibilitychange', measure\)/, 'returning from the background must re-measure')
  assert.match(map, /<KeepMapSized \/>/, 'the keeper must be mounted inside the map')
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

test('the area an admin saves for a group is what the map uses', () => {
  assert.match(users, /group_lat: centre\[0\], group_lng: centre\[1\]/, 'the map API must send the saved group centre with each member')
  assert.match(users, /group_locations/, 'the API must expose the saved centres')
  assert.match(map, /function groupCentresOf/, 'the client must use the saved centres')
  assert.match(map, /groupCentresOf\(users\)/, 'pin positions must be built from the live centres')
  assert.match(map, /u\.group_lat === null/, 'a missing centre must not be read as 0,0')
  assert.match(map, /Location not shared — shown at/, 'an area pin must not claim an exact location')
  assert.match(groupsScreen, /GroupLocationPicker/, 'admins must be able to pick the area on a map')
  assert.match(groupsScreen, /Pick the area on a map/, 'the picker needs a visible entry point')
  assert.match(users, /group_location_radius/, 'the saved radius must travel with each member')
  assert.match(map, /radius=\{centre\.radius \|\| 400\}/, 'the map circle must use the group radius')
  assert.match(groupsScreen, /AREA RADIUS \(METRES\)/, 'admins must be able to edit the radius')
  assert.match(groupsScreen, /body\.location_radius = Math\.round\(radius\)/, 'the radius must be saved with the location')
  assert.match(groupsScreen, /onPick=\{\(lat, lng, radius\)/, 'the picker must return the chosen radius')
  // The settings screen returns early, so a picker mounted in the list branch
  // could never open (the bug fixed after live testing). Keep it inside the
  // open-group branch, before the list return.
  const detailBranch = groupsScreen.indexOf('if (openSlug)')
  const pickerBlock = groupsScreen.indexOf('{pickerOpen &&')
  const listReturn = groupsScreen.indexOf('  return (\n    <div className="min-h-[70vh]')
  assert.ok(detailBranch !== -1 && pickerBlock > detailBranch, 'the picker modal must live in the open-group branch')
  assert.ok(listReturn === -1 || pickerBlock < listReturn, 'the picker modal must not be left in the group list branch')
})

test('signup resolves GPS validity before the group branch uses it in the insert', () => {
  // hasGps used to be declared inside the else block, so choosing a group made
  // every registration throw "hasGps is not defined" and return 500.
  assert.match(authRoute, /^ {6}const hasGps =/m, 'hasGps must be declared before the group branch, not inside it')
  assert.match(authRoute, /hasGps \? Number\(lat\) : null/, 'the insert must still store GPS only when it is valid')
})

test('group community is chosen from existing communities or added deliberately', () => {
  assert.match(groupsScreen, /＋ New community…/, 'a new community must be an explicit choice')
  assert.match(groupsScreen, /const communities = Array\.from\(new Set/, 'the select must be built from real communities')
  assert.match(groupsScreen, /group-community-options/, 'the create form should suggest existing communities too')
  assert.match(groupsScreen, /Rename this community on all its groups/, 'admins need a deliberate bulk community rename')
  assert.match(groupsRoute, /communities\/rename/, 'the worker needs a community rename endpoint')
  assert.match(groupsRoute, /UPDATE groups SET community=\? WHERE community=\?/, 'a community rename must update every group at once')
  assert.match(groupsRoute, /location_radius=/, 'the worker must persist the area radius')
  assert.match(groupsRoute, /area radius must be between 50 and 10000 metres/, 'the radius must be bounded')
  assert.match(groupsRoute, /fresh\.role !== 'admin'/, 'only a system admin may rename a community')
})

test('admin sets a till, paybill or bank destination for every giving purpose', () => {
  assert.match(admin, /GivingPaymentEditor/, 'the per-purpose destination editor must be mounted')
  assert.match(admin, /paymentProblem\(adminFunds, adminPayments\)/, 'an incomplete destination must block the save with a clear message')
  assert.match(admin, /Fallback method/, 'the fallback must say whether its number is a paybill or a till')
  assert.match(payments, /M-Pesa Till \(Buy Goods\)/, 'till must be a first-class method')
  assert.match(payments, /payment_number: e\.target\.value\.replace/, 'the number field must reject non-digits')
  assert.match(contentRoute, /giving_fallback_method/, 'the server must accept the fallback method')
  assert.match(contentRoute, /must be 'paybill' or 'till'/, 'the server must validate the fallback method')
})
