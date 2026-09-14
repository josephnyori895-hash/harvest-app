import { query, pool } from '../db.js'
import { requireAdmin, requireMember } from '../middleware/auth.js'
import bcrypt from 'bcryptjs'

const GROUPS = new Set(['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'])
const ROLES = new Set(['member', 'admin'])
const PROFILE_FIELDS = new Set(['name', 'phone', 'location', 'constituency', 'faith'])

function cleanString(value, max = 120) {
  if (value === null) return null
  return String(value ?? '').trim().slice(0, max)
}

async function countAdmins(excludeId = null) {
  const params = []
  let sql = `SELECT COUNT(*)::int AS count FROM users WHERE role='admin' AND active=TRUE`
  if (excludeId) { params.push(excludeId); sql += ` AND id <> $1` }
  const { rows } = await query(sql, params)
  return rows[0].count
}

async function audit(actor, action, targetId, meta = {}) {
  await query(`INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES ($1,$2,$3,'user',$4,$5)`, [actor.id, actor.role, action, targetId, JSON.stringify(meta)])
}

export default async function usersRoutes(app) {
  app.get('/api/users', { preHandler: [requireMember] }, async (req, reply) => {
    const q = String(req.query.q || '').trim().toLowerCase()
    if (!q || q.length < 2) return reply.send({ users: [] })
    const { rows } = await query(`SELECT id, username, name, group_name, constituency, verified, role, active FROM users WHERE active=TRUE AND (lower(username) LIKE $1 OR lower(name) LIKE $1) ORDER BY verified DESC, username ASC LIMIT 20`, [`%${q}%`])
    return reply.send({ users: rows })
  })

  app.get('/api/users/map', { preHandler: [requireMember] }, async (req, reply) => {
    const viewerId = req.user.id
    const isAdmin = req.user.role === 'admin'
    const groupCentroids = { 'Harvest Central': [-0.4197, 36.9475], 'Harvest Ruringu': [-0.432, 36.95], 'Harvest Skuta': [-0.41, 36.94], 'Harvest Majengo': [-0.425, 36.945], 'Harvest Kamakwa': [-0.415, 36.955], 'Harvest Nyeri': [-0.4197, 36.9475] }
    // Phone numbers are admin-only: members never receive other people's numbers.
    const { rows } = await query(`SELECT id, username, name, group_name, location, verified, lat, lng${isAdmin ? ', phone, phone_normalized' : ''} FROM users WHERE active=TRUE ORDER BY group_name, username LIMIT 500`)
    const { rows: follows } = await query(`SELECT followee_id FROM follows WHERE follower_id=$1`, [viewerId])
    const followsSet = new Set(follows.map(r => r.followee_id))
    const { rows: followers } = await query(`SELECT follower_id FROM follows WHERE followee_id=$1`, [viewerId])
    const followersSet = new Set(followers.map(r => r.follower_id))
    const out = rows.map(u => {
      const mutual = isAdmin || (followsSet.has(u.id) && followersSet.has(u.id)) || u.id === viewerId
      if (mutual) return { ...u, ...(isAdmin ? { phone: u.phone || u.phone_normalized || null } : {}), lat: u.lat, lng: u.lng, hidden: false }
      const gc = groupCentroids[u.group_name] || [-0.4197, 36.9475]
      const [al, ag] = [gc[0] + (Math.random()-0.5)*0.008, gc[1] + (Math.random()-0.5)*0.008]
      return { id: u.id, username: u.username, name: u.name, group_name: u.group_name, location: null, verified: u.verified, role: undefined, lat: al, lng: ag, hidden: true, approx: true }
    })
    return reply.send({ users: out, viewer: req.user.username, isAdmin })
  })

  app.post('/api/admin/users', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { username, name, pin, role = 'member', group_name: groupName = 'Harvest Central', verified = false } = req.body || {}
    const uname = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32)
    const displayName = String(name || uname).trim().slice(0, 120)
    const p = String(pin || '').trim()
    if (!uname || uname.length < 2) return reply.code(400).send({ error: 'valid username required' })
    if (!/^\d{4,6}$/.test(p)) return reply.code(400).send({ error: 'PIN must be 4-6 digits' })
    if (!ROLES.has(role)) return reply.code(400).send({ error: 'role must be member or admin' })
    if (!GROUPS.has(groupName)) return reply.code(400).send({ error: 'invalid group' })
    if (typeof verified !== 'boolean') return reply.code(400).send({ error: 'verified must be boolean' })
    const exists = await query('SELECT 1 FROM users WHERE username=$1', [uname])
    if (exists.rows[0]) return reply.code(409).send({ error: 'username already exists' })
    const pinHash = await bcrypt.hash(p, 12)
    const created = await query(`INSERT INTO users (username,name,group_name,role,pin_hash,verified) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, name, group_name, role, verified, created_at`, [uname, displayName, groupName, role, pinHash, verified])
    await audit(req.user, 'user_provisioned', created.rows[0].id, { role, verified, group_name: groupName })
    return reply.code(201).send({ user: created.rows[0] })
  })

  app.post('/api/users/:username/follow', { preHandler: [requireMember] }, async (req, reply) => {
    const target = String(req.params.username || '').trim().toLowerCase()
    if (!target || target === req.user.username) return reply.code(400).send({ error: 'invalid target' })
    const t = await query('SELECT id, username FROM users WHERE username=$1 AND active=TRUE', [target])
    if (!t.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const targetId = t.rows[0].id
    const viewerId = req.user.id
    const existing = await query('SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2', [viewerId, targetId])
    if (existing.rows[0]) { await query('DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2', [viewerId, targetId]); return reply.send({ following: false, mutual: false }) }
    await query('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [viewerId, targetId])
    const rev = await query('SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2', [targetId, viewerId])
    return reply.send({ following: true, mutual: !!rev.rows[0] })
  })

  app.get('/api/users/:username/mutual', { preHandler: [requireMember] }, async (req, reply) => {
    const t = await query('SELECT id FROM users WHERE username=$1 AND active=TRUE', [req.params.username])
    if (!t.rows[0]) return reply.code(404).send({ error: 'not found' })
    const targetId = t.rows[0].id
    if (req.user.role === 'admin') return reply.send({ mutual: true, reason: 'admin' })
    if (targetId === req.user.id) return reply.send({ mutual: true, reason: 'self' })
    const { rows } = await query(`SELECT is_mutual($1,$2) AS mutual`, [req.user.id, targetId])
    return reply.send({ mutual: rows[0].mutual })
  })

  app.patch('/api/admin/users/:username', { preHandler: [requireAdmin] }, async (req, reply) => {
    const username = String(req.params.username || '').trim().toLowerCase()
    const body = req.body || {}
    const { role, verified, group_name: groupName } = body
    if (!username) return reply.code(400).send({ error: 'username required' })
    if (role !== undefined && !ROLES.has(role)) return reply.code(400).send({ error: 'role must be member or admin' })
    if (groupName !== undefined && groupName !== null && !GROUPS.has(groupName)) return reply.code(400).send({ error: 'invalid group' })
    if (verified !== undefined && typeof verified !== 'boolean') return reply.code(400).send({ error: 'verified must be boolean' })

    const target = await query(`SELECT id, username, name, phone, location, constituency, faith, role, verified, group_name, active FROM users WHERE username=$1`, [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const before = target.rows[0]
    if (before.username === req.user.username && role !== undefined && role !== 'admin') return reply.code(400).send({ error: 'cannot demote the current administrator' })
    if (before.username === req.user.username && body.active === false) return reply.code(400).send({ error: 'cannot deactivate the current administrator' })

    const profile = {}
    for (const field of PROFILE_FIELDS) if (Object.prototype.hasOwnProperty.call(body, field)) profile[field] = cleanString(body[field], field === 'name' ? 120 : 160)
    const nextRole = role === undefined ? before.role : role
    const nextVerified = verified === undefined ? before.verified : verified
    const nextGroup = groupName === undefined ? before.group_name : groupName
    const nextActive = body.active === undefined ? before.active : body.active
    if (typeof nextActive !== 'boolean') return reply.code(400).send({ error: 'active must be boolean' })
    if (before.role === 'admin' && nextRole !== 'admin' && await countAdmins(before.id) < 1) return reply.code(400).send({ error: 'cannot remove the last active administrator' })

    const values = [before.id, nextRole, nextVerified, nextGroup, nextActive]
    const assignments = ['role=$2', 'verified=$3', 'group_name=$4', 'active=$5']
    let i = 5
    for (const field of PROFILE_FIELDS) {
      if (profile[field] !== undefined) { values.push(profile[field]); assignments.push(`${field}=$${++i}`) }
    }
    if (nextActive && !before.active) { assignments.push('deactivated_at=NULL', 'deactivated_by=NULL') }
    if (!nextActive && before.active) { values.push(req.user.id); assignments.push(`deactivated_at=now()`, `deactivated_by=$${++i}`) }
    const updated = await query(`UPDATE users SET ${assignments.join(', ')} WHERE id=$1 RETURNING id, username, name, phone, location, group_name, constituency, faith, verified, role, active, deactivated_at, last_seen`, values)
    await audit(req.user, 'user_profile_update', before.id, {
      before: { name: before.name, phone: before.phone, location: before.location, constituency: before.constituency, faith: before.faith, role: before.role, verified: before.verified, group_name: before.group_name, active: before.active },
      after: updated.rows[0]
    })
    return reply.send({ user: updated.rows[0] })
  })

  app.post('/api/admin/users/:username/deactivate', { preHandler: [requireAdmin] }, async (req, reply) => {
    const username = String(req.params.username || '').trim().toLowerCase()
    const target = await query(`SELECT id, username, role, active FROM users WHERE username=$1`, [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const before = target.rows[0]
    if (before.id === req.user.id || before.username === req.user.username) return reply.code(400).send({ error: 'cannot deactivate the current administrator' })
    if (!before.active) return reply.send({ ok: true, already_inactive: true })
    if (before.role === 'admin' && await countAdmins(before.id) < 1) return reply.code(400).send({ error: 'cannot deactivate the last active administrator' })
    const updated = await query(`UPDATE users SET active=FALSE, deactivated_at=now(), deactivated_by=$2 WHERE id=$1 RETURNING id, username, active, deactivated_at`, [before.id, req.user.id])
    await audit(req.user, 'user_deactivated', before.id, { before: { active: true, role: before.role }, after: { active: false } })
    return reply.send({ user: updated.rows[0] })
  })

  app.post('/api/admin/users/:username/restore', { preHandler: [requireAdmin] }, async (req, reply) => {
    const username = String(req.params.username || '').trim().toLowerCase()
    const target = await query(`SELECT id, username, active FROM users WHERE username=$1`, [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
    if (target.rows[0].active) return reply.send({ ok: true, already_active: true })
    const updated = await query(`UPDATE users SET active=TRUE, deactivated_at=NULL, deactivated_by=NULL WHERE id=$1 RETURNING id, username, active`, [target.rows[0].id])
    await audit(req.user, 'user_restored', target.rows[0].id, { before: { active: false }, after: { active: true } })
    return reply.send({ user: updated.rows[0] })
  })

  app.delete('/api/admin/users/:username', { preHandler: [requireAdmin] }, async (req, reply) => {
    const username = String(req.params.username || '').trim().toLowerCase()
    const target = await query(`SELECT id, username, name, role, active FROM users WHERE username=$1`, [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const before = target.rows[0]
    if (before.id === req.user.id || before.username === req.user.username) return reply.code(400).send({ error: 'cannot delete the current administrator' })
    if (before.role === 'admin' && await countAdmins(before.id) < 1) return reply.code(400).send({ error: 'cannot delete the last active administrator' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: deleted } = await client.query('DELETE FROM users WHERE id=$1 RETURNING id, username, name, role, active', [before.id])
      if (!deleted[0]) throw new Error('user could not be deleted')
      await client.query(`INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES ($1,$2,'user_deleted','user',$3,$4)`, [req.user.id, req.user.role, before.id, JSON.stringify({ deleted_user: { username: before.username, name: before.name, role: before.role, active: before.active } })])
      await client.query('COMMIT')
      return reply.send({ ok: true, deleted: { username: before.username } })
    } catch (err) {
      await client.query('ROLLBACK')
      req.log.error(err)
      return reply.code(409).send({ error: 'account cannot be deleted because dependent data could not be removed' })
    } finally {
      client.release()
    }
  })

  app.get('/api/admin/audit', { preHandler: [requireAdmin] }, async (req, reply) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
    const { rows } = await query(`SELECT a.id, a.action, a.target_type, a.target_id, a.meta, a.created_at, u.username AS actor_username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT $1`, [limit])
    return reply.send({ audit: rows })
  })

  app.get('/api/me', async (req, reply) => {
    if (!req.user || req.user.id === '00000000-0000-0000-0000-000000000000') return reply.send({ user: null, role: 'guest' })
    const { rows } = await query('SELECT id, username, name, group_name, constituency, faith, verified, role, active, last_seen FROM users WHERE id=$1', [req.user.id])
    const user = rows[0]
    if (!user || !user.active) return reply.send({ user: null, role: 'guest' })
    return reply.send({ user, role: user.role })
  })
}
