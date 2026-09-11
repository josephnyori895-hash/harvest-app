import { query } from '../db.js'
import { requireMember } from '../middleware/auth.js'

export default async function usersRoutes(app) {
  // GET /api/users?q=harvest — search (limited, auth required)
  app.get('/api/users', { preHandler: [requireMember] }, async (req, reply) => {
    const q = String(req.query.q || '').trim().toLowerCase()
    if (!q || q.length < 2) return reply.send({ users: [] })
    const { rows } = await query(
      `SELECT id, username, name, group_name, constituency, verified, role
       FROM users WHERE lower(username) LIKE $1 OR lower(name) LIKE $1
       ORDER BY verified DESC, username ASC LIMIT 20`,
      [`%${q}%`]
    )
    return reply.send({ users: rows })
  })

  // GET /api/users/map — coords gated by mutual OR admin
  app.get('/api/users/map', { preHandler: [requireMember] }, async (req, reply) => {
    const viewerId = req.user.id
    const isAdmin = req.user.role === 'admin'
    const groupCentroids = {
      'Harvest Central': [-0.4197, 36.9475],
      'Harvest Ruringu': [-0.432, 36.95],
      'Harvest Skuta': [-0.41, 36.94],
      'Harvest Majengo': [-0.425, 36.945],
      'Harvest Kamakwa': [-0.415, 36.955],
      'Harvest Nyeri': [-0.4197, 36.9475],
    }
    const { rows } = await query(
      `SELECT id, username, name, group_name, location, verified, lat, lng FROM users ORDER BY group_name, username LIMIT 500`
    )
    const { rows: follows } = await query(`SELECT followee_id FROM follows WHERE follower_id=$1`, [viewerId])
    const followsSet = new Set(follows.map(r => r.followee_id))
    const { rows: followers } = await query(`SELECT follower_id FROM follows WHERE followee_id=$1`, [viewerId])
    const followersSet = new Set(followers.map(r => r.follower_id))

    const out = rows.map(u => {
      const mutual = isAdmin || (followsSet.has(u.id) && followersSet.has(u.id)) || u.id === viewerId
      if (mutual) return { ...u, lat: u.lat, lng: u.lng, hidden: false }
      const gc = groupCentroids[u.group_name] || [-0.4197, 36.9475]
      const jitter = () => [gc[0] + (Math.random()-0.5)*0.008, gc[1] + (Math.random()-0.5)*0.008]
      const [al, ag] = jitter()
      return { id: u.id, username: u.username, name: u.name, group_name: u.group_name, location: null, verified: u.verified, role: undefined, lat: al, lng: ag, hidden: true, approx: true }
    })
    return reply.send({ users: out, viewer: req.user.username, isAdmin })
  })

  app.post('/api/users/:username/follow', { preHandler: [requireMember] }, async (req, reply) => {
    const target = req.params.username
    if (!target || target === req.user.username) return reply.code(400).send({ error: 'invalid target' })
    const t = await query('SELECT id, username FROM users WHERE username=$1', [target])
    if (!t.rows[0]) return reply.code(404).send({ error: 'user not found' })
    const targetId = t.rows[0].id
    const viewerId = req.user.id
    const existing = await query('SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2', [viewerId, targetId])
    if (existing.rows[0]) {
      await query('DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2', [viewerId, targetId])
      return reply.send({ following: false, mutual: false })
    }
    await query('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [viewerId, targetId])
    const rev = await query('SELECT 1 FROM follows WHERE follower_id=$1 AND followee_id=$2', [targetId, viewerId])
    return reply.send({ following: true, mutual: !!rev.rows[0] })
  })

  app.get('/api/users/:username/mutual', { preHandler: [requireMember] }, async (req, reply) => {
    const target = req.params.username
    const t = await query('SELECT id FROM users WHERE username=$1', [target])
    if (!t.rows[0]) return reply.code(404).send({ error: 'not found' })
    const targetId = t.rows[0].id
    const viewerId = req.user.id
    const isAdmin = req.user.role === 'admin'
    if (isAdmin) return reply.send({ mutual: true, reason: 'admin' })
    if (targetId === viewerId) return reply.send({ mutual: true, reason: 'self' })
    const { rows } = await query(`SELECT is_mutual($1,$2) AS mutual`, [viewerId, targetId])
    return reply.send({ mutual: rows[0].mutual })
  })

  // GET /api/me — DB-backed identity; never report a stale JWT role.
  app.get('/api/me', async (req, reply) => {
    if (!req.user || req.user.id === '00000000-0000-0000-0000-000000000000') return reply.send({ user: null, role: 'guest' })
    const { rows } = await query('SELECT id, username, name, group_name, constituency, faith, verified, role, last_seen FROM users WHERE id=$1', [req.user.id])
    const user = rows[0]
    if (!user) return reply.send({ user: null, role: 'guest' })
    return reply.send({ user, role: user.role })
  })
}
