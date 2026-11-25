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
const usersRoute = await readFile(new URL('../workers/src/routes/users.js', import.meta.url), 'utf8')

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
assert.match(securityMigration, /password_hash = NULL/)
assert.match(securityMigration, /pin_hash = NULL/)

// Single administrator + one phone/one browser policy.
assert.match(adminMigration, /role = 'member'[\s\S]{0,80}username <> 'harvest_nyeri'/, 'other admins must be demoted')
assert.match(adminMigration, /CREATE TABLE IF NOT EXISTS admin_devices/)
assert.match(adminMigration, /UNIQUE \(user_id, kind\)/, 'one device per kind')
assert.match(adminMigration, /admin_login_challenges/)
assert.match(adminDevices, /primaryAdminUsername/)
assert.match(adminDevices, /ADMIN_OTP_DEV/, 'local-only code fallback must be explicit')
assert.match(adminDevices, /installation_id=\?[\s\S]{0,600}sendToDevice\(env,[\s\S]{0,300}admin_login_code/, 'code must be pushed to the bound phone only')
assert.match(adminDevices, /pbkdf2Verify\(code, challenge\.code_hash\)/, 'code must be verified from its hash')
assert.match(adminDevices, /MAX_ATTEMPTS = 5/)
assert.match(adminDevices, /admin_web_epoch=admin_web_epoch\+1/, 'new browser must revoke the old browser token')
assert.match(auth, /admin_web_epoch, admin_mobile_epoch/)
assert.match(auth, /admin session was replaced by a newer sign-in/)
assert.match(routesAuth, /verification_required: true/)
assert.match(routesAuth, /only HFC Nyeri can sign in as admin/)
assert.match(usersRoute, /only \$\{primaryAdminUsername\(env\)\} can hold the administrator role/)

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
