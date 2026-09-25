import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

// PBKDF2 (not plaintext) password verification on login.
assert.match(auth, /pbkdf2Verify/)

// Admin PIN bootstrap stays bcrypt-hashed — never plaintext comparison.
assert.match(auth, /bcrypt\.compare/)
assert.doesNotMatch(auth, /pin\s*===\s*env\.ADMIN_PIN/)
assert.match(media, /if \(!signed\) return errorResponse\('signed media URL required', 401\)/)
assert.match(media, /x-amz-meta-ownerid/)
assert.match(chat, /canAccessConversation/)
assert.doesNotMatch(chat, /conversation_key\.startsWith\('group:'\).*\n.*conversation_key\.startsWith\('department:'/s)
assert.match(departments, /leaders cannot demote themselves/)
assert.match(departments, /only the system admin can remove a department leader/)
assert.match(departments, /cannot remove the only department leader/)
assert.match(securityMigration, /password_hash = NULL/)
assert.match(securityMigration, /pin_hash = NULL/)

console.log('Security hardening contract tests passed (Cloudflare Workers backend).')
