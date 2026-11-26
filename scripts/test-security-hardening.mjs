import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'

// Port of the Phase-1 hardening contract tests to the Cloudflare Workers backend.
// The old assertions targeted server/src (Fastify); equivalents live in workers/src.

const http = await readFile(new URL('../workers/src/lib/http.js', import.meta.url), 'utf8')
const auth = await readFile(new URL('../workers/src/lib/auth.js', import.meta.url), 'utf8')
const routesAuth = await readFile(new URL('../workers/src/routes/auth.js', import.meta.url), 'utf8')
const index = await readFile(new URL('../workers/src/index.js', import.meta.url), 'utf8')
const media = await readFile(new URL('../workers/src/lib/media.js', import.meta.url), 'utf8')
const chat = await readFile(new URL('../workers/src/routes/chat.js', import.meta.url), 'utf8')
const securityMigration = await readFile(new URL('../workers/migrations/0013_security_hardening.sql', import.meta.url), 'utf8')
const departments = await readFile(new URL('../workers/src/routes/departments.js', import.meta.url), 'utf8')
const adminDevices = await readFile(new URL('../workers/src/lib/adminDevices.js', import.meta.url), 'utf8')
const adminMigration = await readFile(new URL('../workers/migrations/0035_admin_device_auth.sql', import.meta.url), 'utf8')
const adminRestore = await readFile(new URL('../workers/migrations/0038_restore_hfc_nyeri_admin.sql', import.meta.url), 'utf8')
const workerConfig = await readFile(new URL('../workers/wrangler.toml', import.meta.url), 'utf8')
const usersRoute = await readFile(new URL('../workers/src/routes/users.js', import.meta.url), 'utf8')
const mediaRoute = await readFile(new URL('../workers/src/routes/media.js', import.meta.url), 'utf8')
const realtime = await readFile(new URL('../workers/src/realtime.js', import.meta.url), 'utf8')
const groups = await readFile(new URL('../workers/src/routes/groups.js', import.meta.url), 'utf8')
const capabilities = await readFile(new URL('../workers/src/lib/capabilities.js', import.meta.url), 'utf8')

// No insecure JWT fallback anywhere in the worker.
for (const [name, src] of Object.entries({ http, auth, routesAuth, index })) {
  assert.doesNotMatch(src, /JWT_SECRET\s*\|\|\s*['"]dev-jwt-secret/, `${name}: insecure JWT_SECRET fallback`)
}

// Security headers ship on every response via corsFor().
assert.match(http, /X-Content-Type-Options/)
assert.match(http, /X-Frame-Options/)
assert.match(http, /Referrer-Policy/)

// CORS allowlist is env-driven, not hardcoded.
assert.match(http, /CORS_ORIGINS/)

// Deactivated accounts are rejected on both JWT auth and fresh-role re-check.
assert.match(auth, /!\s*current\.active/)
assert.match(auth, /requireRole/)

// JWT algorithm pinned to HS256.
assert.match(await readFile(new URL('../workers/src/lib/crypto.js', import.meta.url), 'utf8'), /HS256/)

// PBKDF2 (not plaintext) password verification on login. The check lives in
// the login route; the middleware lib should not be importing a password hash.
assert.match(routesAuth, /pbkdf2Verify\(p, user\.password_hash\)/)
assert.doesNotMatch(auth, /pbkdf2Verify/, 'auth middleware must not verify passwords')

// Admin PIN bootstrap stays bcrypt-hashed — never plaintext comparison.
assert.match(auth, /bcrypt\.compare/)
assert.doesNotMatch(auth, /pin\s*===\s*env\.ADMIN_PIN/)
assert.match(routesAuth, /adminCredential && !user\.password_hash && !user\.pin_hash/, 'bootstrap PIN must not reopen a provisioned admin account')
assert.match(media, /if \(!signed\) return errorResponse\('signed media URL required', 401\)/)
assert.match(media, /x-amz-meta-ownerid/)
assert.match(chat, /canAccessConversation/)
// Delegated chat moderation is confined to conversations the moderator can
// reach: the capability check must be followed by the membership check, or a
// moderate_chat grant would let someone delete messages in rooms they are not in.
assert.match(
  chat,
  /if \(!hasChatModeration\(fresh\)\)[\s\S]{0,240}?canAccessConversation\(env, fresh, m\.rows\[0\]\.conversation_key\)/,
  'chat delete must check conversation membership after the capability check',
)
assert.doesNotMatch(chat, /conversation_key\.startsWith\('group:'\).*\n.*conversation_key\.startsWith\('department:'/s)
assert.match(departments, /leaders cannot demote themselves/)
assert.match(departments, /only the system admin can remove a department leader/)
assert.match(departments, /cannot remove the only department leader/)

// Creation is admin-only unless the admin delegates it per account. Editing an
// existing group/department stays available to its group admin/leader and to
// the system admin (who must be able to correct any team).
assert.match(capabilities, /'create_groups'[\s\S]{0,120}'create_departments'/)
assert.match(departments, /hasCap\(fresh, 'create_departments'\)/, 'department creation must honour the delegated grant')
assert.match(departments, /department creation is granted by the admin/)
assert.match(departments, /if \(fresh\.role !== 'admin' && actor\.rows\[0\]\?\.role !== 'leader'\) return errorResponse\('department leader required', 403\)[\s\S]{0,1700}?UPDATE departments SET name=\?/, 'system admin and department leader can edit a department')
assert.match(groups, /hasCap\(fresh, 'create_groups'\)/, 'group creation must honour the delegated grant')
assert.match(groups, /const isAdmin = fresh\.role === 'admin' \|\| actorRole === 'admin' \|\| hasCap\(fresh, 'manage_groups'\)/, 'system admin can edit any group')
assert.match(securityMigration, /password_hash = NULL/)
assert.match(securityMigration, /pin_hash = NULL/)

// Single administrator + one phone/one browser policy.
assert.match(adminMigration, /role = 'member'[\s\S]{0,80}username <> 'harvest_nyeri'/, 'other admins must be demoted')
assert.match(adminMigration, /CREATE TABLE IF NOT EXISTS admin_devices/)
assert.match(adminMigration, /UNIQUE \(user_id, kind\)/, 'one device per kind')
assert.match(adminMigration, /admin_login_challenges/)
assert.match(adminRestore, /WHERE id = 'f1000000-0000-4000-8000-000000000009'/, 'the real admin must be restored by immutable id')
assert.match(adminRestore, /role = 'admin', verified = 1/, 'restore both admin role and verification')
assert.match(workerConfig, /ADMIN_USER_ID = "f1000000-0000-4000-8000-000000000009"/, 'the primary admin id must be configured')
assert.match(workerConfig, /ADMIN_USERNAME = "hfcnyeri"/, 'the readable admin label must match the church account')
assert.match(adminDevices, /primaryAdminUsername/)
assert.match(adminDevices, /ADMIN_OTP_DEV/, 'local-only code fallback must be explicit')

// Break-glass recovery: the single admin must not be permanently locked out
// when the bound phone cannot receive a push code. The recovery secret is
// long, compared in constant time, and only usable after the password check.
assert.match(adminDevices, /ADMIN_RECOVERY_CODE/, 'a server-held recovery code must exist')
assert.match(adminDevices, /length >= 12/, 'the recovery code must be long enough to resist guessing')
assert.match(adminDevices, /secretMatches\(recovery, String\(env\.ADMIN_RECOVERY_CODE/, 'the recovery code must be compared in constant time')
assert.match(adminDevices, /if \(adminRecoveryConfigured\(env\)\) return \{ ok: true, challengeId: id, expiresAt, delivery: 'unavailable' \}/, 'an undeliverable code must keep the challenge alive for recovery')
assert.match(adminDevices, /recovery \? 'that recovery code is not right/, 'wrong recovery codes must be rate-limited like wrong phone codes')
assert.match(routesAuth, /recovery_available: adminRecoveryConfigured\(env\)/, 'the client must know whether recovery is offered')

// The primary admin is identified by id. Renaming the account must not remove
// admin access or verification.
const { isPrimaryAdmin } = await import('../workers/src/lib/adminDevices.js')
assert.equal(isPrimaryAdmin({ ADMIN_USER_ID: 'stable-id' }, { id: 'stable-id', username: 'renamed-admin' }), true, 'a renamed primary admin keeps access')
assert.equal(isPrimaryAdmin({ ADMIN_USER_ID: 'stable-id' }, { id: 'other-id', username: 'hfcnyeri' }), false, 'a username alone cannot claim the primary admin')
assert.doesNotMatch(usersRoute, /isPrimaryAdmin\(env, [^)]*\.username\)/, 'role checks must not depend on a mutable username')
assert.match(adminDevices, /installation_id=\?[\s\S]{0,1400}sendToDevice\(env, pushRows\[0\]\.fcm_token,[\s\S]{0,300}admin_login_code/, 'code must be pushed to the bound phone only')
assert.match(adminDevices, /pbkdf2Verify\(code, challenge\.code_hash\)/, 'code must be verified from its hash')
assert.match(adminDevices, /MAX_ATTEMPTS = 5/)
assert.match(adminDevices, /DELETE FROM admin_devices[\s\S]{0,220}ORDER BY last_seen_at DESC LIMIT \?/, 'approving past the two-device allowance evicts the device used longest ago')
assert.match(adminDevices, /MAX_TRUSTED_DEVICES = 2/, 'the allowance is two devices in total')
assert.match(auth, /SELECT 1 FROM admin_devices WHERE user_id=\? AND kind=\? AND device_id=\?/, 'an evicted device token must stop working immediately')
assert.match(auth, /admin_web_epoch, admin_mobile_epoch/)
assert.match(auth, /admin session was replaced by a newer sign-in/)
assert.match(routesAuth, /verification_required: true/)
assert.match(routesAuth, /only HFC Nyeri can sign in as admin/)
assert.match(usersRoute, /only \$\{primaryAdminUsername\(env\)\} can hold the administrator role/)

// Sensitive admin mutations and browser challenges are rate limited.
assert.match(auth, /adminOperationRateLimit/)
assert.match(auth, /adminop:\$\{user\.id\}/)
assert.match(auth, /too many administrative changes/)
assert.match(index, /adminOperationRateLimit\(env, request, user\)/)
assert.match(adminDevices, /admchallenge:\$\{user\.id\}/)
assert.match(adminDevices, /too many admin sign-in codes/)
assert.match(adminDevices, /String\(ip \|\| ''\)\.slice\(0, 64\)/, 'challenge rows record the requesting IP')
assert.match(routesAuth, /createBrowserChallenge\(env, user, device, ip\)/)
assert.match(auth, /username NOT LIKE 'adminop:%'/, 'admin-operation sentinels do not count as login failures')

// The primary admin can never be dropped to a 4–6 digit PIN.
assert.match(usersRoute, /isPrimaryAdmin\(env, before\)[\s\S]{0,80}password, not a PIN/)
assert.match(usersRoute, /isPrimaryAdmin\(env, target\.rows\[0\]\)[\s\S]{0,80}password, not a PIN/)

// Multipart abort requires the same per-account upload token as every other
// multipart call; leaked key/uploadId alone must not cancel an upload.
assert.match(mediaRoute, /multipart\/abort[\s\S]{0,700}timingSafeEqualStr\(await multipartToken\(fresh, uploadId, key\), token\)/)

// WebSocket sessions honour admin device epochs and clean up typing timers.
assert.match(realtime, /admin_web_epoch, admin_mobile_epoch/)
assert.match(realtime, /admin session expired — sign in again/)
assert.match(realtime, /k\.endsWith\(suffix\)/, 'typing timers are cleared on close')
assert.match(realtime, /async webSocketError\(ws\)/)

// Chat/notification fan-out skips deactivated accounts.
assert.match(chat, /JOIN users u ON u\.id=gm\.user_id[\s\S]{0,80}COALESCE\(u\.active,1\)=1/)
assert.match(chat, /COALESCE\(u\.active,1\)=1/)

// No live credential is committed in any script: logins take E2E_USERNAME /
// E2E_PIN from the environment (recursive scan of scripts/ AND workers/scripts/).
{
  const scriptDirs = ['../scripts/', '../workers/scripts/']
  const scriptRoots = new Set(['scripts', 'workers/scripts'])
  for (const dirLevel of scriptDirs) {
    const dir = new URL(dirLevel, import.meta.url)
    let files
    try { files = readdirSync(dir, { recursive: true }) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.mjs')) continue
      if (f.includes('test-security-hardening.mjs')) continue
      const src = await readFile(new URL(f.replace(/^[./]+/, ''), dir), 'utf8')
      assert.doesNotMatch(src, /(?:pin|password):\s*['"][^'"]{4,}['"]/, `${f}: hardcoded credential literal`)
      assert.doesNotMatch(src, /\.type\(['"][^'"]*['"],\s*['"][^'"]{4,}['"]\)(?!.*E2E_)/, `${f}: hardcoded typed password`)
      assert.doesNotMatch(src, /username:\s*['"][A-Za-z0-9_.@-]{3,}['"]/, `${f}: hardcoded username literal`)
    }
  }
  void scriptRoots
}

console.log('Security hardening contract tests passed (Cloudflare Workers backend).')
