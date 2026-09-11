import { query } from '../db.js'
import { requireAdmin, requireMember } from '../middleware/auth.js'
import bcrypt from 'bcryptjs'

const GROUPS = new Set(['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu'])
const ROLES = new Set(['member', 'admin'])

export default async function usersRoutes(app) {
  app.get('/api/users', { preHandler: [requireMember] }, async (req, reply) => {
    const q = String(req.query.q || '').trim().toLowerCase()
    if (!q || q.length < 2) return reply.send({ users: [] })
    const { rows } = await query(`SELECT id, username, name, group_name, constituency, verified, role FROM users WHERE lower(username) LIKE $1 OR lower(name) LIKE $1 ORDER BY verified DESC, username ASC LIMIT 20`, [`%${q}%`])
    return reply.send({ users: rows })
  })

  app.get('/api/users/map', { preHandler: [requireMember] }, async (req, reply) => {
    const viewerId = req.user.id
    const isAdmin = req.user.role === 'admin'
    const groupCentroids = { 'Harvest Central': [-0.4197, 36.9475], 'Harvest Ruringu': [-0.432, 36.95], 'Harvest Skuta': [-0.41, 36.94], 'Harvest Majengo': [-0.425, 36.945], 'Harvest Kamakwa': [-0.415, 36.955], 'Harvest Nyeri': [-0.4197, 36.9475] }
    const { rows } = await query(`SELECT id, username, name, group_name, location, verified, lat, lng FROM users ORDER BY group_name, username LIMIT 500`)
    const { rows: follows } = await query(`SELECT followee_id FROM follows WHERE follower_id=$1`, [viewerId])
    const followsSet = new Set(follows.map(r => r.followee_id))
    const { rows: followers } = await query(`SELECT follower_id FROM follows WHERE followee_id=$1`, [viewerId])
    const followersSet = new Set(followers.map(r => r.follower_id))
    const out = rows.map(u => {
      const mutual = isAdmin || (followsSet.has(u.id) && followersSet.has(u.id)) || u.id === viewerId
      if (mutual) return { ...u, lat: u.lat, lng: u.lng, hidden: false }
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
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'user_provisioned','user',$2,$3)`, [req.user.id, created.rows[0].id, JSON.stringify({ role, verified, group_name: groupName })])
    return reply.code(201).send({ user: created.rows[0] })
  })

  app.post('/api/users/:username/follow', { preHandler: [requireMember] }, async (req, reply) => {
    const target = req.params.username
    if (!target || target === req.user.username) return reply.code(400).send({ error: 'invalid target' })
    const t = await query('SELECT id, username FROM users WHERE username=$1', [target])
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
    const t = await query('SELECT id FROM users WHERE username=$1', [req.params.username])
    if (!t.rows[0]) return reply.code(404).send({ error: 'not found' })
    const targetId = t.rows[0].id
    if (req.user.role === 'admin') return reply.send({ mutual: true, reason: 'admin' })
    if (targetId === req.user.id) return reply.send({ mutual: true, reason: 'self' })
    const { rows } = await query(`SELECT is_mutual($1,$2) AS mutual`, [req.user.id, targetId])
    return reply.send({ mutual: rows[0].mutual })
  })

  app.patch('/api/admin/users/:username', { preHandler: [requireAdmin] }, async (req, reply) => {
    const username = String(req.params.username || '').trim().toLowerCase()
    const { role, verified, group_name: groupName } = req.body || {}
    if (!username) return reply.code(400).send({ error: 'username required' })
    if (username === req.user.username && role && role !== 'admin') return reply.code(400).send({ error: 'cannot demote the current administrator' })
    if (role !== undefined && !ROLES.has(role)) return reply.code(400).send({ error: 'role must be member or admin' })
    if (groupName !== undefined && groupName !== null && !GROUPS.has(groupName)) return reply.code(400).send({ error: 'invalid group' })
    if (verified !== undefined && typeof verified !== 'boolean') return reply.code(400).send({ error: 'verified must be boolean' })
    const target = await query('SELECT id, username, role, verified, group_name FROM users WHERE username=$1', [username])
    if (!target.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const before = target.rows[0]
    const nextRole = role === undefined ? before.role : role
    const nextVerified = verified === undefined ? before.verified : verified
    const nextGroup = groupName === undefined ? before.group_name : groupName
    const updated = await query(`UPDATE users SET role=$2, verified=$3, group_name=$4 WHERE id=$1 RETURNING id, username, name, group_name, constituency, faith, verified, role, last_seen`, [before.id, nextRole, nextVerified, nextGroup])
    await query(`INSERT INTO audit_log (actor_id,action,target_type,target_id,meta) VALUES ($1,'user_privilege_update','user',$2,$3)`, [req.user.id, before.id, JSON.stringify({ before: { role: before.role, verified: before.verified, group_name: before.group_name }, after: { role: nextRole, verified: nextVerified, group_name: nextGroup } })])
    return reply.send({ user: updated.rows[0] })
  })

  app.get('/api/me', async (req, reply) => {
    if (!req.user || req.user.id === '00000000-0000-0000-0000-000000000000') return reply.send({ user: null, role: 'guest' })
    const { rows } = await query('SELECT id, username, name, group_name, constituency, faith, verified, role, last_seen FROM users WHERE id=$1', [req.user.id])
    const user = rows[0]
    if (!user) return reply.send({ user: null, role: 'guest' })
    return reply.send({ user, role: user.role })
  })
}
