// Auth routes — port of the register/login/health part of server/src/app.js.
import { query, uuid, bool } from '../lib/db.js'
import { pbkdf2Hash, pbkdf2Verify, jwtSign } from '../lib/crypto.js'
import { jsonResponse, errorResponse, readJson, httpError } from '../lib/http.js'
import { loginRateLimit, clearLoginRateLimit, recordLoginAttempt, verifyAdminPin, isValidMemberPin, requireJwtSecretForRoute } from '../lib/auth.js'
import { nearestCommunity, nearestFromRows } from '../lib/geo.js'

const RESERVED_USERNAMES = new Set(['allan', 'admin', 'administrator', 'harvest', 'harvestfamily', 'harvestfamilychurch', 'support', 'help', 'root', 'moderator', 'pst.simon', 'youth_harvest', 'worship_team'])
const REG_GROUPS = new Set(['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'])

// Kenyan mobile normalization: 07xx/01xx/+2547xx/+2541xx -> +2547xxxxxxxx
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '')
  const m = digits.match(/^(?:\+?254|0)?([17]\d{8})$/)
  return m ? `+254${m[1]}` : null
}

export async function handleAuth(request, env, ctx) {
  requireJwtSecretForRoute(env)
  const path = new URL(request.url).pathname
  const method = request.method

  // POST /api/auth/register
  if (path === '/api/auth/register' && method === 'POST') {
    let identity = null
    try {
      const body = await readJson(request)
      identity = await loginRateLimit(env, request, body.username)
      const { username, name, phone, password, group_name: groupName, lat, lng } = body
      const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
      const fullName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
      const normPhone = normalizePhone(phone)
      const pass = String(password || '')

      if (!uname || uname.length < 3) return errorResponse('username must be at least 3 characters (letters, numbers, dots, dashes)', 400)
      if (RESERVED_USERNAMES.has(uname)) return errorResponse('that username is reserved — please choose another', 409)
      if (!fullName || fullName.length < 2) return errorResponse('your full name is required', 400)
      if (!normPhone) return errorResponse('enter a valid Safaricom/Airtel number, e.g. 0712 345 678', 400)
      if (pass.length < 8) return errorResponse('password must be at least 8 characters', 400)
      // Location-based auto-assignment: if the device shares GPS at signup,
      // the member joins the nearest congregation group automatically.
      // Priority: explicit member choice → admin-set group locations (D1)
      // → built-in centroids. A member who deliberately picked a group is
      // never overridden by a GPS guess; GPS only fills in when the choice
      // is empty, missing, or no longer exists. A chosen/nearest name is
      // only used if that group actually EXISTS — deleted congregations
      // must never come back as profile ghosts.
      const exists = async (name) => {
        if (!name) return false
        try {
          const r = await query(env, 'SELECT id FROM groups WHERE name=? LIMIT 1', [name])
          return !!r.rows[0]
        } catch { return false }
      }
      let group = null
      const pickedGroup = String(groupName || '').trim()
      if (pickedGroup && await exists(pickedGroup)) {
        // Honour the member's explicit choice — GPS is ignored on purpose.
        group = pickedGroup
      } else {
        // Choice missing/invalid: try GPS nearest, then the pick again
        // (belt-and-braces), then the first congregation group.
        let near = null
        const hasGps = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        if (hasGps) {
          try {
            const located = await query(env, 'SELECT name, lat, lng FROM groups WHERE lat IS NOT NULL AND lng IS NOT NULL')
            near = nearestFromRows(located.rows, Number(lat), Number(lng))
          } catch { /* groups table may be empty — fall through */ }
          if (!near) near = nearestCommunity(Number(lat), Number(lng))
        }
        if (near && await exists(near)) group = near
        else {
          try {
            const r = await query(env, "SELECT name FROM groups WHERE slug LIKE 'harvest_%' ORDER BY slug LIMIT 1")
            group = r.rows[0]?.name || ''
          } catch { group = '' }
        }
      }

      const dup = await query(env, 'SELECT username, phone_normalized FROM users WHERE username=? OR phone_normalized=? LIMIT 2', [uname, normPhone])
      if (dup.rows.some(row => row.username === uname)) return errorResponse('that username is already taken', 409)
      if (dup.rows.some(row => row.phone_normalized === normPhone)) return errorResponse('this phone number already has an account — sign in instead', 409)

      const hash = await pbkdf2Hash(pass, 100000)
      const id = uuid()
      const now = new Date().toISOString()
      await query(
        env,
        `INSERT INTO users (id, username, name, phone, phone_normalized, group_name, role, verified, password_hash, lat, lng, created_at)
         VALUES (?,?,?,?,?,?, 'member', 0, ?, ?, ?, ?)`,
        [id, uname, fullName, String(phone || '').trim().slice(0, 32), normPhone, group, hash,
         Number.isFinite(Number(lat)) ? Number(lat) : null, Number.isFinite(Number(lng)) ? Number(lng) : null, now],
      )
      await query(
        env,
        `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,'member','self_register','user',?,?,?)`,
        [id, id, JSON.stringify({ username: uname, group }), now],
      ).catch(() => {})

      const token = await jwtSign({ id, username: uname, role: 'member', group_name: group, verified: false }, env.JWT_SECRET, '24h')
      await clearLoginRateLimit(env, identity)
      return jsonResponse({ token, role: 'member', username: uname, verified: false, group_name: group, assigned_by: pickedGroup && group === pickedGroup ? 'choice' : 'location', expiresIn: '24h' }, 201)
    } catch (e) {
      if (e?.status) throw e
      return errorResponse('registration failed', 500)
    }
  }

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(request)
    const identity = await loginRateLimit(env, request, body.username)
    const ip = identity.ip
    const { pin, password, username } = body
    const p = String(password ?? pin ?? '').trim()
    const identifier = String(username || '').trim().toLowerCase()
    const uname = identifier.replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    const phoneNorm = normalizePhone(identifier)
    const adminCredential = p ? await verifyAdminPin(env, p) : false
    const memberPinOk = p ? isValidMemberPin(p) : false

    const denied = async (code, message) => {
      await recordLoginAttempt(env, ip, uname || 'guest', false)
      return errorResponse(message, code)
    }

    if (!p || (!uname && !phoneNorm)) {
      if (!p) await clearLoginRateLimit(env, identity)
      return errorResponse('username/phone and password are required', 401)
    }

    const r = await query(
      env,
      'SELECT id, username, role, group_name, constituency, faith, verified, active, pin_hash, password_hash FROM users WHERE username=? OR (? IS NOT NULL AND phone_normalized=?)',
      [uname, phoneNorm, phoneNorm],
    )
    const found = r.rows[0] || null
    if (!found) return denied(401, 'invalid username/phone or password')
    const user = bool(found, 'verified', 'active')
    if (!user.active) return denied(403, 'this account has been deactivated — contact the admin')

    const role = user.role
    if (!['member', 'admin'].includes(role)) return denied(403, 'account role is invalid')

    // Password (any printable secret) or legacy 4-6 digit PIN both authenticate.
    let ok = false
    if (user.password_hash) ok = await pbkdf2Verify(p, user.password_hash)
    if (!ok && memberPinOk && user.pin_hash) ok = await pbkdf2Verify(p, user.pin_hash)

    if (role === 'admin' && !ok) {
      // Admin accounts are bound to their own credential once provisioned. ADMIN_PIN_HASHES
      // is a bootstrap credential only: it can claim an account that has no pin_hash yet.
      if (adminCredential && !user.pin_hash) {
        const hash = await pbkdf2Hash(p, 100000)
        await query(env, 'UPDATE users SET pin_hash=? WHERE id=? AND pin_hash IS NULL', [hash, user.id])
        ok = true
      }
    }
    if (!ok) return denied(401, 'invalid username/phone or password')

    await recordLoginAttempt(env, ip, uname || user.username, true)
    await clearLoginRateLimit(env, identity)
    const expiresIn = role === 'member' ? '24h' : '7d'
    const token = await jwtSign(
      {
        id: user.id,
        username: user.username,
        role,
        group_name: user.group_name,
        constituency: user.constituency,
        faith: user.faith,
        verified: !!user.verified,
      },
      env.JWT_SECRET,
      expiresIn,
    )
    return jsonResponse({ token, role, username: user.username, verified: !!user.verified, expiresIn })
  }

  return null
}
