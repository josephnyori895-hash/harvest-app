// Port of server/src/routes/users.js (pg → D1).
import { query, uuid, bool } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson, searchParams, httpError } from '../lib/http.js'
import { pbkdf2Hash } from '../lib/crypto.js'
import { ALL_CAPS, parseGrants } from '../lib/capabilities.js'
import { nearestCommunity } from '../lib/geo.js'

const GROUPS = new Set(['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'])
const ROLES = new Set(['member', 'admin'])
const PROFILE_FIELDS = new Set(['name', 'phone', 'location', 'constituency', 'faith'])

function cleanString(value, max = 120) {
  if (value === null) return null
  return String(value ?? '').trim().slice(0, max)
}

async function countAdmins(env, excludeId = null) {
  const { rows } = excludeId
    ? await query(env, `SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND id <> ?`, [excludeId])
    : await query(env, `SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1`)
  return Number(rows[0]?.count || 0)
}

async function audit(env, actor, action, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,'user',?,?,?)`,
    [actor.id, actor.role, action, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

export async function handleUsers(request, env, ctx, params) {
  const url = new URL(request.url)
  const path = url.pathname
  const user = ctx.user
  const method = request.method

  // GET /api/users?q=
  if (path === '/api/users' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const q = String(searchParams(url).q || '').trim().toLowerCase()
    if (!q || q.length < 2) return jsonResponse({ users: [] })
    const { rows } = await query(
      env,
      `SELECT id, username, name, group_name, constituency, verified, role, active FROM users
        WHERE active=1 AND (lower(username) LIKE ? OR lower(name) LIKE ?)
        ORDER BY verified DESC, username ASC LIMIT 20`,
      [`%${q}%`, `%${q}%`],
    )
    rows.forEach(r => bool(r, 'verified', 'active'))
    return jsonResponse({ users: rows })
  }

  // GET /api/users/map
  if (path === '/api/users/map' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const isAdmin = fresh.role === 'admin'
    const groupCentroids = {
      'Harvest Central': [-0.4197, 36.9475], 'Harvest Ruringu': [-0.432, 36.95],
      'Harvest Skuta': [-0.41, 36.94], 'Harvest Majengo': [-0.425, 36.945],
      'Harvest Kamakwa': [-0.415, 36.955], 'Harvest Nyeri': [-0.4197, 36.9475],
    }
    // Phone numbers are admin-only: members never receive other people's numbers.
    const { rows } = await query(
      env,
      `SELECT id, username, name, group_name, location, verified, role, lat, lng${isAdmin ? ', phone, phone_normalized, grants' : ''} FROM users WHERE active=1 ORDER BY group_name, username LIMIT 500`,
    )
    const { rows: follows } = await query(env, `SELECT followee_id FROM follows WHERE follower_id=?`, [fresh.id])
    const followsSet = new Set(follows.map(r => r.followee_id))
    const { rows: followers } = await query(env, `SELECT follower_id FROM follows WHERE followee_id=?`, [fresh.id])
    const followersSet = new Set(followers.map(r => r.follower_id))
    const out = rows.map(u => {
      bool(u, 'verified')
      const mutual = isAdmin || (followsSet.has(u.id) && followersSet.has(u.id)) || u.id === fresh.id
      if (mutual) return { ...u, ...(isAdmin ? { phone: u.phone || u.phone_normalized || null } : {}), hidden: false }
      const gc = groupCentroids[u.group_name] || [-0.4197, 36.9475]
      const [al, ag] = [gc[0] + (Math.random() - 0.5) * 0.008, gc[1] + (Math.random() - 0.5) * 0.008]
      return { id: u.id, username: u.username, name: u.name, group_name: u.group_name, location: null, verified: u.verified, role: undefined, lat: al, lng: ag, hidden: true, approx: true }
    })
    return jsonResponse({ users: out, viewer: fresh.username, isAdmin })
  }

  // POST /api/admin/users
  if (path === '/api/admin/users' && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const body = await readJson(request)
    const { username, name, pin, role = 'member', group_name: groupName = 'Harvest Central', verified = false } = body
    const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    const displayName = String(name || uname).trim().slice(0, 120)
    const p = String(pin || '').trim()
    if (!uname || uname.length < 2) return errorResponse('valid username required', 400)
    if (!/^\d{4,6}$/.test(p)) return errorResponse('PIN must be 4-6 digits', 400)
    if (!ROLES.has(role)) return errorResponse('role must be member or admin', 400)
    if (!GROUPS.has(groupName)) return errorResponse('invalid group', 400)
    if (typeof verified !== 'boolean') return errorResponse('verified must be boolean', 400)
    const exists = await query(env, 'SELECT 1 FROM users WHERE username=?', [uname])
    if (exists.rows[0]) return errorResponse('username already exists', 409)
    const pinHash = await pbkdf2Hash(p, 100000)
    const id = uuid()
    await query(
      env,
      `INSERT INTO users (id, username, name, group_name, role, pin_hash, verified) VALUES (?,?,?,?,?,?,?)`,
      [id, uname, displayName, groupName, role, pinHash, verified ? 1 : 0],
    )
    await audit(env, fresh, 'user_provisioned', id, { role, verified, group_name: groupName })
    return jsonResponse({ user: { id, username: uname, name: displayName, group_name: groupName, role, verified, created_at: new Date().toISOString() } }, 201)
  }

  // POST /api/users/:username/follow
  if (params.username && path.endsWith('/follow') && method === 'POST') {
    const fresh = await requireMember(env, user)
    const target = String(params.username || '').trim().toLowerCase()
    if (!target || target === fresh.username) return errorResponse('invalid target', 400)
    const t = await query(env, 'SELECT id, username FROM users WHERE username=? AND active=1', [target])
    if (!t.rows[0]) return errorResponse('user not found', 404)
    const targetId = t.rows[0].id
    const existing = await query(env, 'SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?', [fresh.id, targetId])
    if (existing.rows[0]) {
      await query(env, 'DELETE FROM follows WHERE follower_id=? AND followee_id=?', [fresh.id, targetId])
      return jsonResponse({ following: false, mutual: false })
    }
    await query(env, 'INSERT INTO follows (follower_id, followee_id) VALUES (?,?) ON CONFLICT DO NOTHING', [fresh.id, targetId])
    const rev = await query(env, 'SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?', [targetId, fresh.id])
    return jsonResponse({ following: true, mutual: !!rev.rows[0] })
  }

  // GET /api/users/:username/mutual
  if (params.username && path.endsWith('/mutual') && method === 'GET') {
    const fresh = await requireMember(env, user)
    const t = await query(env, 'SELECT id, verified FROM users WHERE username=? AND active=1', [params.username])
    if (!t.rows[0]) return errorResponse('not found', 404)
    const targetId = t.rows[0].id
    if (fresh.role === 'admin') return jsonResponse({ mutual: true, reason: 'admin', following: true, follows_you: true })
    if (targetId === fresh.id) return jsonResponse({ mutual: true, reason: 'self', following: true, follows_you: true })
    const { rows } = await query(
      env,
      `SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?) AS a,
              EXISTS (SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?) AS b`,
      [fresh.id, targetId, targetId, fresh.id],
    )
    const following = !!rows[0]?.a
    const followsYou = !!rows[0]?.b
    return jsonResponse({ mutual: following && followsYou, following, follows_you: followsYou })
  }

  // PATCH /api/admin/users/:username
  if (params.username && method === 'PATCH') {
    const fresh = await requireAdmin(env, user)
    const username = String(params.username || '').trim().toLowerCase()
    const body = await readJson(request)
    const { role, verified, group_name: groupName } = body
    if (!username) return errorResponse('username required', 400)
    if (role !== undefined && !ROLES.has(role)) return errorResponse('role must be member or admin', 400)
    if (groupName !== undefined && groupName !== null && !GROUPS.has(groupName)) return errorResponse('invalid group', 400)
    if (verified !== undefined && typeof verified !== 'boolean') return errorResponse('verified must be boolean', 400)

    const target = await query(env, `SELECT id, username, name, phone, location, constituency, faith, role, verified, group_name, active FROM users WHERE username=?`, [username])
    if (!target.rows[0]) return errorResponse('user not found', 404)
    const before = bool(target.rows[0], 'verified', 'active')
    if (before.username === fresh.username && role !== undefined && role !== 'admin') return errorResponse('cannot demote the current administrator', 400)
    if (before.username === fresh.username && body.active === false) return errorResponse('cannot deactivate the current administrator', 400)

    const profile = {}
    for (const field of PROFILE_FIELDS) if (Object.prototype.hasOwnProperty.call(body, field)) profile[field] = cleanString(body[field], field === 'name' ? 120 : 160)
    const nextRole = role === undefined ? before.role : role
    const nextVerified = verified === undefined ? before.verified : verified
    const nextGroup = groupName === undefined ? before.group_name : groupName
    const nextActive = body.active === undefined ? !!before.active : body.active
    if (typeof nextActive !== 'boolean') return errorResponse('active must be boolean', 400)
    if (before.role === 'admin' && nextRole !== 'admin' && (await countAdmins(env, before.id)) < 1) return errorResponse('cannot remove the last active administrator', 400)

    const sets = ['role=?', 'verified=?', 'group_name=?', 'active=?']
    const values = [nextRole, nextVerified ? 1 : 0, nextGroup, nextActive ? 1 : 0]
    for (const field of PROFILE_FIELDS) {
      if (profile[field] !== undefined) { sets.push(`${field}=?`); values.push(profile[field]) }
    }
    // Per-leader power grants: admin chooses exactly what each leader can do.
    if (body.grants !== undefined) {
      if (!Array.isArray(body.grants)) return errorResponse('grants must be an array', 400)
      const clean = body.grants.filter(g => ALL_CAPS.includes(g))
      sets.push('grants=?')
      values.push(clean.join(','))
    }
    // Admin can reset a member's PIN inline (also accepted via POST /reset-pin).
    if (body.pin_reset !== undefined) {
      const pin = String(body.pin_reset).trim()
      if (!/^\d{4,6}$/.test(pin)) return errorResponse('PIN must be 4-6 digits', 400)
      sets.push('pin_hash=?')
      values.push(await pbkdf2Hash(pin, 100000))
    }
    // Admin can also set exact coordinates for a member (map correction).
    if (body.lat !== undefined && body.lng !== undefined) {
      const lat = Number(body.lat), lng = Number(body.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return errorResponse('invalid coordinates', 400)
      sets.push('lat=?, lng=?')
      values.push(lat, lng)
    }
    if (nextActive && !before.active) { sets.push('deactivated_at=NULL', 'deactivated_by=NULL') }
    if (!nextActive && before.active) { sets.push('deactivated_at=?', 'deactivated_by=?'); values.push(new Date().toISOString(), fresh.id) }
    values.push(before.id)
    const updated = await query(
      env,
      `UPDATE users SET ${sets.join(', ')} WHERE id=? RETURNING id, username, name, phone, location, group_name, constituency, faith, verified, role, active, grants, deactivated_at, last_seen`,
      values,
    )
    const u0 = bool(updated.rows[0], 'verified', 'active')
    await audit(env, fresh, 'user_profile_update', before.id, {
      before: { name: before.name, phone: before.phone, location: before.location, constituency: before.constituency, faith: before.faith, role: before.role, verified: before.verified, group_name: before.group_name, active: before.active },
      after: u0,
    })
    return jsonResponse({ user: u0 })
  }

  // POST /api/admin/users/:username/reset-pin — admin sets a new PIN or password
  // for any account (forgotten credentials, account handover, new leader onboarding).
  if (params.username && path.endsWith('/reset-pin') && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const username = String(params.username || '').trim().toLowerCase()
    const body = await readJson(request)
    const pin = body.pin !== undefined ? String(body.pin).trim() : undefined
    const password = body.password !== undefined ? String(body.password) : undefined
    if ((pin === undefined) === (password === undefined)) return errorResponse('provide either pin or password', 400)
    if (pin !== undefined && !/^\d{4,6}$/.test(pin)) return errorResponse('PIN must be 4-6 digits', 400)
    if (password !== undefined && password.length < 8) return errorResponse('password must be at least 8 characters', 400)
    const target = await query(env, 'SELECT id, username FROM users WHERE username=?', [username])
    if (!target.rows[0]) return errorResponse('user not found', 404)
    if (pin !== undefined) await query(env, 'UPDATE users SET pin_hash=? WHERE id=?', [await pbkdf2Hash(pin, 100000), target.rows[0].id])
    else await query(env, 'UPDATE users SET password_hash=? WHERE id=?', [await pbkdf2Hash(password, 100000), target.rows[0].id])
    await audit(env, fresh, 'credential_reset', target.rows[0].id, { kind: pin !== undefined ? 'pin' : 'password' })
    return jsonResponse({ ok: true, kind: pin !== undefined ? 'pin' : 'password' })
  }

  // POST /api/admin/users/:username/deactivate | /restore
  if (params.username && (path.endsWith('/deactivate') || path.endsWith('/restore')) && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const username = String(params.username || '').trim().toLowerCase()
    const restore = path.endsWith('/restore')
    const target = await query(env, 'SELECT id, username, role, active FROM users WHERE username=?', [username])
    if (!target.rows[0]) return errorResponse('user not found', 404)
    const before = bool(target.rows[0], 'active')
    if (!restore) {
      if (before.id === fresh.id || before.username === fresh.username) return errorResponse('cannot deactivate the current administrator', 400)
      if (!before.active) return jsonResponse({ ok: true, already_inactive: true })
      if (before.role === 'admin' && (await countAdmins(env, before.id)) < 1) return errorResponse('cannot deactivate the last active administrator', 400)
      const updated = await query(env, `UPDATE users SET active=0, deactivated_at=?, deactivated_by=? WHERE id=? RETURNING id, username, active, deactivated_at`, [new Date().toISOString(), fresh.id, before.id])
      await audit(env, fresh, 'user_deactivated', before.id, { before: { active: true, role: before.role }, after: { active: false } })
      return jsonResponse({ user: bool(updated.rows[0], 'active') })
    }
    if (before.active) return jsonResponse({ ok: true, already_active: true })
    const updated = await query(env, `UPDATE users SET active=1, deactivated_at=NULL, deactivated_by=NULL WHERE id=? RETURNING id, username, active`, [before.id])
    await audit(env, fresh, 'user_restored', before.id, { before: { active: false }, after: { active: true } })
    return jsonResponse({ user: bool(updated.rows[0], 'active') })
  }

  // DELETE /api/admin/users/:username
  if (params.username && method === 'DELETE') {
    const fresh = await requireAdmin(env, user)
    const username = String(params.username || '').trim().toLowerCase()
    const target = await query(env, 'SELECT id, username, name, role, active FROM users WHERE username=?', [username])
    if (!target.rows[0]) return errorResponse('user not found', 404)
    const before = bool(target.rows[0], 'active')
    if (before.id === fresh.id || before.username === fresh.username) return errorResponse('cannot delete the current administrator', 400)
    if (before.role === 'admin' && (await countAdmins(env, before.id)) < 1) return errorResponse('cannot delete the last active administrator', 400)
    try {
      // ON DELETE CASCADE handles dependent rows; audit_log keeps the trail (SET NULL).
      await query(env, 'DELETE FROM users WHERE id=?', [before.id])
      await query(
        env,
        `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?, 'user_deleted','user',?,?,?)`,
        [fresh.id, fresh.role, before.id, JSON.stringify({ deleted_user: { username: before.username, name: before.name, role: before.role, active: before.active } }), new Date().toISOString()],
      )
      return jsonResponse({ ok: true, deleted: { username: before.username } })
    } catch {
      return errorResponse('account cannot be deleted because dependent data could not be removed', 409)
    }
  }

  // GET /api/admin/audit
  if (path === '/api/admin/audit' && method === 'GET') {
    await requireAdmin(env, user)
    const qp = searchParams(url)
    const limit = Math.min(Math.max(Number.parseInt(qp.limit, 10) || 50, 1), 100)
    const { rows } = await query(
      env,
      `SELECT a.id, a.action, a.target_type, a.target_id, a.meta, a.created_at, u.username AS actor_username
         FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT ?`,
      [limit],
    )
    return jsonResponse({ audit: rows })
  }

  // GET /api/activity — new members + follows involving the viewer
  if (path === '/api/activity' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows: members } = await query(
      env,
      `SELECT username, name, group_name, verified, created_at FROM users WHERE active=1 ORDER BY created_at DESC LIMIT 20`,
    )
    const { rows: fIn } = await query(
      env,
      `SELECT u.username, u.name, f.created_at FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followee_id=? ORDER BY f.created_at DESC LIMIT 20`,
      [fresh.id],
    )
    const { rows: fOut } = await query(
      env,
      `SELECT u.username, u.name, f.created_at FROM follows f JOIN users u ON u.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 20`,
      [fresh.id],
    )
    members.forEach(m => bool(m, 'verified'))
    return jsonResponse({ new_members: members, follows_in: fIn, follows_out: fOut })
  }

  // PATCH /api/me — self-service updates: group choice + sharing device location.
  // Location powers the map and nearest-group assignment; admins may also set it.
  if (path === '/api/me' && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    if (body.group_name !== undefined) {
      if (!GROUPS.has(body.group_name)) return errorResponse('invalid group', 400)
      await query(env, 'UPDATE users SET group_name=? WHERE id=?', [body.group_name, fresh.id])
      await audit(env, fresh, 'group_self_join', fresh.id, { group_name: body.group_name })
    }
    if (body.lat !== undefined && body.lng !== undefined) {
      const lat = Number(body.lat), lng = Number(body.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return errorResponse('invalid coordinates', 400)
      }
      await query(env, 'UPDATE users SET lat=?, lng=? WHERE id=?', [lat, lng, fresh.id])
    }
    const { rows } = await query(env, 'SELECT id, username, name, group_name, verified, role FROM users WHERE id=?', [fresh.id])
    return jsonResponse({ user: bool(rows[0], 'verified') })
  }

  // GET /api/me
  if (path === '/api/me' && method === 'GET') {
    if (!user || user.id === '00000000-0000-0000-0000-000000000000') return jsonResponse({ user: null, role: 'guest' })
    const { rows } = await query(env, 'SELECT id, username, name, group_name, constituency, faith, verified, role, active, last_seen FROM users WHERE id=?', [user.id])
    const u = bool(rows[0], 'verified', 'active')
    if (!u || !u.active) return jsonResponse({ user: null, role: 'guest' })
    return jsonResponse({ user: u, role: u.role })
  }

  return null
}
