import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../server/src/app.js', import.meta.url), 'utf8')
const auth = await readFile(new URL('../server/src/middleware/auth.js', import.meta.url), 'utf8')
const realtime = await readFile(new URL('../server/src/realtime/io.js', import.meta.url), 'utf8')

assert.match(app, /const JWT_SECRET = process\.env\.JWT_SECRET\s*$/m)
assert.doesNotMatch(app, /JWT_SECRET\s*\|\|\s*['\"]dev-jwt-secret-change-in-prod/)
assert.match(app, /credentials:\s*false/)
assert.match(app, /CORS_ORIGINS/)
assert.match(app, /X-Content-Type-Options/)
assert.match(app, /X-Frame-Options/)
assert.match(app, /Strict-Transport-Security/)
assert.match(app, /user\.active === false/)

assert.doesNotMatch(auth, /jwtSecret\s*\|\|\s*['\"]dev-jwt-secret-change-in-prod/)
assert.match(auth, /current\.active === false/)
assert.match(auth, /algorithms:\s*\[['\"]HS256['\"]\]/)

assert.doesNotMatch(realtime, /process\.env\.JWT_SECRET\s*\|\|\s*['\"]dev-jwt-secret-change-in-prod/)
assert.match(realtime, /credentials:\s*false/)
assert.match(realtime, /recipient_id=\$2/)
assert.match(realtime, /requireFreshUser\(socket, ack\)/)

console.log('Phase 1 security hardening contract tests passed.')
