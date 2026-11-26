// Departments (ministry teams): praise & worship, ushering, media, etc.
// Members see the list, self-join/leave, and can list their own memberships.
// Admins create departments and assign/remove members + department leaders.
import { query, uuid } from '../lib/db.js'
import { requireMember, requireAdmin } from '../lib/auth.js'
import { hasCap } from '../lib/capabilities.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'
import { mediaUrlOrNull, isReadableKey } from '../lib/media.js'

async function getDepartment(env, slug) {
  const { rows } = await query(env, 'SELECT id, slug, name, description, is_public, avatar_key, chat_background_key, created_at FROM departments WHERE slug=?', [String(slug).slice(0, 80)])
  return rows[0] || null
}

const publicDepartment = row => row ? { ...row, is_public: row.is_public !== 0 } : row

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

async function audit(env, actor, action, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,'department',?,?,?)`,
    [actor.id, actor.role, action, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

export async function handleDepartments(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const user = ctx.user

  // GET /api/departments — list ministries with member counts. Members see
  // public ministries plus any hidden team they already serve on; admins see
  // every ministry so visibility can be managed from the control centre.
  if (path === '/api/departments' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const isAdmin = fresh.role === 'admin'
    const { rows } = await query(
      env,
      `SELECT d.id, d.slug, d.name, d.description, d.is_public,
              COUNT(dm.user_id) AS member_count
         FROM departments d
         LEFT JOIN department_members dm ON dm.department_id = d.id
        ${isAdmin ? '' : 'WHERE d.is_public=1 OR EXISTS (SELECT 1 FROM department_members own WHERE own.department_id=d.id AND own.user_id=?)'}
        GROUP BY d.id ORDER BY d.created_at ASC, d.name ASC`,
      isAdmin ? [] : [fresh.id],
    )
    const mine = await query(env, 'SELECT department_id, role FROM department_members WHERE user_id=?', [fresh.id])
    const mineMap = new Map(mine.rows.map(r => [r.department_id, r.role]))
    const out = rows.map(r => ({ ...publicDepartment(r), member_count: Number(r.member_count) || 0, joined: mineMap.has(r.id), leader: mineMap.get(r.id) === 'leader' }))
    return jsonResponse({ departments: out })
  }

  // POST /api/departments — system admin, or a leader granted "create_departments".
  if (path === '/api/departments' && method === 'POST') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'create_departments')) return errorResponse('department creation is granted by the admin', 403)
    const body = await readJson(request)
    const name = String(body.name || '').trim().slice(0, 80)
    const description = String(body.description || '').trim().slice(0, 300) || null
    if (name.length < 2) return errorResponse('department name required', 400)
    const slug = slugify(body.slug || name)
    if (!slug) return errorResponse('invalid department name', 400)
    const exists = await getDepartment(env, slug)
    if (exists) return errorResponse('department already exists', 409)
    const isPublic = body.is_public === false && fresh.role === 'admin' ? 0 : 1
    const id = uuid()
    await query(env, 'INSERT INTO departments (id, slug, name, description, is_public, created_at) VALUES (?,?,?,?,?,?)', [id, slug, name, description, isPublic, new Date().toISOString()])
    // The creator becomes the first department leader so the person who
    // creates a ministry team can manage it immediately.
    await query(env, `INSERT INTO department_members (department_id, user_id, role, joined_at) VALUES (?,?,'leader',?) ON CONFLICT (department_id, user_id) DO UPDATE SET role='leader'`, [id, fresh.id, new Date().toISOString()])
    await audit(env, fresh, 'department_created', id, { name, creator: fresh.username, is_public: !!isPublic })
    return jsonResponse({ department: { id, slug, name, description, is_public: !!isPublic, member_count: 1 }, creator_role: 'leader' }, 201)
  }

  // GET /api/departments/mine — the viewer's own memberships.
  if (path === '/api/departments/mine' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT d.id, d.slug, d.name, d.description, dm.role, dm.joined_at
         FROM department_members dm JOIN departments d ON d.id = dm.department_id
        WHERE dm.user_id=? ORDER BY dm.joined_at ASC`,
      [fresh.id],
    )
    return jsonResponse({ departments: rows })
  }

  // Everything below is /api/departments/:slug...
  const m = path.match(/^\/api\/departments\/([^/]+)(?:\/(.*))?$/)
  if (!m) return null
  const slug = decodeURIComponent(m[1])
  const sub = m[2] ? decodeURIComponent(m[2]) : null

  // GET /api/departments/:slug — one department with its member list.
  if (!sub && method === 'GET') {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    if (!dep.is_public && fresh.role !== 'admin') {
      const membership = await query(env, 'SELECT 1 AS ok FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
      if (!membership.rows[0]) return errorResponse('department not found', 404)
    }
    const { rows } = await query(
      env,
      `SELECT u.id, u.username, u.name, u.group_name, u.verified, dm.role, dm.joined_at
         FROM department_members dm JOIN users u ON u.id = dm.user_id
        WHERE dm.department_id=? AND u.active=1
        ORDER BY CASE dm.role WHEN 'leader' THEN 0 ELSE 1 END, u.username ASC LIMIT 200`,
      [dep.id],
    )
    rows.forEach(r => { r.verified = !!r.verified })
    return jsonResponse({
      department: publicDepartment({
        ...dep,
        avatar_url: await mediaUrlOrNull(env, dep.avatar_key, 3600),
        chat_background_url: await mediaUrlOrNull(env, dep.chat_background_key, 3600),
      }),
      members: rows,
    })
  }

  // POST /api/departments/:slug/join — self-join (one department per user).
  if (sub === 'join' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    // Rule: a user serves in exactly one department. Leaving is instant, so this
    // is a switch, not a lock-in — but only after an explicit confirm from the UI.
    const current = await query(env, 'SELECT d.slug, d.name FROM department_members dm JOIN departments d ON d.id=dm.department_id WHERE dm.user_id=?', [fresh.id])
    if (current.rows[0] && current.rows[0].slug !== dep.slug) {
      return errorResponse(`you already serve in ${current.rows[0].name} — leave it first, then join this one`, 409)
    }
    await query(
      env,
      `INSERT INTO department_members (department_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)
       ON CONFLICT (department_id, user_id) DO NOTHING`,
      [dep.id, fresh.id, new Date().toISOString()],
    )
    return jsonResponse({ ok: true, joined: true, department: dep.slug })
  }

  // POST /api/departments/:slug/members (admin) — direct add, replacing any
  // existing department (admin overrides the one-department rule).
  const am = sub === 'members' && method === 'POST'
  if (am) {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    const actor = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
    if (fresh.role !== 'admin' && actor.rows[0]?.role !== 'leader') return errorResponse('department leader required', 403)
    const body = await readJson(request)
    const uname = String(body.username || '').trim().toLowerCase()
    const role = body.role === 'leader' ? 'leader' : 'member'
    if (!uname) return errorResponse('username required', 400)
    const t = await query(env, 'SELECT id, username FROM users WHERE username=? AND active=1', [uname])
    if (!t.rows[0]) return errorResponse('user not found', 404)
    const existing = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, t.rows[0].id])
    if (role === 'member' && existing.rows[0]?.role === 'leader' && fresh.role !== 'admin') {
      if (t.rows[0].id === fresh.id) return errorResponse('leaders cannot demote themselves — appoint another leader first', 400)
      const { rows } = await query(env, `SELECT COUNT(*) AS n FROM department_members WHERE department_id=? AND role='leader'`, [dep.id])
      if (Number(rows[0]?.n || 0) <= 1) return errorResponse('cannot demote the only department leader', 400)
      const targetIsLeader = existing.rows[0]?.role === 'leader'
      if (targetIsLeader) return errorResponse('only the system admin can change another leader', 403)
    }
    // Only a system admin may transfer someone out of another department.
    // Department leaders can add users who are not already serving elsewhere,
    // but cannot silently override the one-department-per-user rule.
    const other = await query(
      env,
      `SELECT d.name FROM department_members dm
         JOIN departments d ON d.id=dm.department_id
        WHERE dm.user_id=? AND dm.department_id <> ?
        LIMIT 1`,
      [t.rows[0].id, dep.id],
    )
    if (other.rows[0] && fresh.role !== 'admin') {
      return errorResponse(`user already serves in ${other.rows[0].name} — only the system admin can transfer them`, 409)
    }
    if (fresh.role === 'admin' && other.rows[0]) {
      await query(env, 'DELETE FROM department_members WHERE user_id=? AND department_id <> ?', [t.rows[0].id, dep.id])
    }
    await query(
      env,
      `INSERT INTO department_members (department_id, user_id, role, joined_at) VALUES (?,?,?,?)
       ON CONFLICT (department_id, user_id) DO UPDATE SET role=excluded.role`,
      [dep.id, t.rows[0].id, role, new Date().toISOString()],
    )
    await audit(env, fresh, role === 'leader' ? 'department_leader_set' : 'department_member_added', dep.id, { username: uname })
    return jsonResponse({ ok: true, username: uname, role })
  }

  // POST /api/departments/:slug/leave — self-leave.
  if (sub === 'leave' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    const actor = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
    if (!actor.rows[0]) return errorResponse('you are not in this department', 400)
    if (actor.rows[0].role === 'leader') {
      const { rows } = await query(env, `SELECT COUNT(*) AS n FROM department_members WHERE department_id=? AND role='leader'`, [dep.id])
      if (Number(rows[0]?.n || 0) <= 1) return errorResponse('you are the only department leader — appoint another leader first', 400)
    }
    await query(env, 'DELETE FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
    return jsonResponse({ ok: true, joined: false })
  }

  // (admin direct add handled above)

  // DELETE /api/departments/:slug/members/:username (admin) — remove a member.
  const mm = sub && sub.match(/^members\/([^/]+)$/)
  if (mm && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    const actor = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
    if (fresh.role !== 'admin' && actor.rows[0]?.role !== 'leader') return errorResponse('department leader required', 403)
    const uname = String(decodeURIComponent(mm[1])).trim().toLowerCase()
    const t = await query(env, 'SELECT id FROM users WHERE username=?', [uname])
    if (!t.rows[0]) return errorResponse('user not found', 404)
    const target = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, t.rows[0].id])
    if (!target.rows[0]) return errorResponse('member not found', 404)
    if (target.rows[0].role === 'leader') {
      if (fresh.role !== 'admin') return errorResponse('only the system admin can remove a department leader', 403)
      const { rows } = await query(env, `SELECT COUNT(*) AS n FROM department_members WHERE department_id=? AND role='leader'`, [dep.id])
      if (Number(rows[0]?.n || 0) <= 1) return errorResponse('cannot remove the only department leader — appoint another leader first', 400)
    }
    await query(env, 'DELETE FROM department_members WHERE department_id=? AND user_id=?', [dep.id, t.rows[0].id])
    await audit(env, fresh, 'department_member_removed', dep.id, { username: uname })
    return jsonResponse({ ok: true, removed: uname })
  }

  // PATCH /api/departments/:slug (admin) — rename / re-describe a department.
  // The slug stays stable so links and existing memberships keep working.
  if (!sub && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    const actor = await query(env, 'SELECT role FROM department_members WHERE department_id=? AND user_id=?', [dep.id, fresh.id])
    if (fresh.role !== 'admin' && actor.rows[0]?.role !== 'leader') return errorResponse('department leader required', 403)
    const body = await readJson(request)
    if (body.is_public !== undefined && fresh.role !== 'admin') return errorResponse('only the system admin can change ministry visibility', 403)
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : dep.name
    const description = body.description !== undefined ? (String(body.description).trim().slice(0, 300) || null) : dep.description
    const isPublic = body.is_public !== undefined ? (body.is_public ? 1 : 0) : dep.is_public
    // The department photo and chat background belong to its leaders (the
    // creator is the first leader), same rule as renaming the team.
    let avatarKey = dep.avatar_key || null
    let backgroundKey = dep.chat_background_key || null
    for (const field of ['avatar_key', 'chat_background_key']) {
      if (body[field] === undefined) continue
      const key = String(body[field] || '').trim()
      if (key && !isReadableKey(key)) return errorResponse(`${field} must be an uploaded image`, 400)
      if (field === 'avatar_key') avatarKey = key || null
      else backgroundKey = key || null
    }
    if (name.length < 2) return errorResponse('department name required', 400)
    if (name === dep.name && description === dep.description && isPublic === dep.is_public && avatarKey === (dep.avatar_key || null) && backgroundKey === (dep.chat_background_key || null)) {
      return jsonResponse({ ok: true, department: publicDepartment(dep), unchanged: true })
    }
    await query(env, 'UPDATE departments SET name=?, description=?, is_public=?, avatar_key=?, chat_background_key=? WHERE id=?', [name, description, isPublic, avatarKey, backgroundKey, dep.id])
    await audit(env, fresh, 'department_updated', dep.id, { slug: dep.slug, before: { name: dep.name, description: dep.description, is_public: !!dep.is_public }, after: { name, description, is_public: !!isPublic, avatar: !!avatarKey, background: !!backgroundKey } })
    const avatar_url = await mediaUrlOrNull(env, avatarKey, 3600)
    const chat_background_url = await mediaUrlOrNull(env, backgroundKey, 3600)
    return jsonResponse({ ok: true, department: publicDepartment({ ...dep, name, description, is_public: isPublic, avatar_key: avatarKey, chat_background_key: backgroundKey, avatar_url, chat_background_url }) })
  }

  // DELETE /api/departments/:slug (admin) — remove the department itself.
  if (!sub && method === 'DELETE') {
    const fresh = await requireAdmin(env, user)
    const dep = await getDepartment(env, slug)
    if (!dep) return errorResponse('department not found', 404)
    await query(env, 'DELETE FROM departments WHERE id=?', [dep.id])
    await audit(env, fresh, 'department_deleted', dep.id, { slug: dep.slug })
    return jsonResponse({ ok: true, deleted: dep.slug })
  }

  return null
}
