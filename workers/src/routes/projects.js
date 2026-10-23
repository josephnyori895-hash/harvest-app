import { query, uuid } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'
import { recordNotificationsSafe } from '../lib/notif.js'

async function auditLog(env, actor, action, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,'project',?,?,?)`,
    [actor.id, actor.role, action, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

function projectRow(row, mine = null, takes = [], mineTake = null) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description || '',
    goal_kes: Number(row.goal_kes) || 0,
    raised_kes: Number(row.raised_kes) || 0,
    committed_kes: Number(row.committed_kes) || 0,
    participants: Number(row.participants) || 0,
    remaining_kes: Math.max((Number(row.goal_kes) || 0) - (Number(row.raised_kes) || 0), 0),
    deadline: row.deadline || null,
    status: row.status,
    auto_advertise: Boolean(row.auto_advertise),
    icon: row.icon || '🤲',
    created_at: row.created_at,
    takes,
    mine_take: mineTake,
    mine: mine ? {
      commitment_kes: Number(mine.commitment_kes) || 0,
      paid_kes: Number(mine.paid_kes) || 0,
      remaining_kes: Math.max((Number(mine.commitment_kes) || 0) - (Number(mine.paid_kes) || 0), 0),
      reminder_enabled: Boolean(mine.reminder_enabled),
    } : null,
  }
}

const KINDS = ['group','department','community']

async function takesForProjects(env, projectIds, { details = false } = {}) {
  const map = new Map(projectIds.map(id => [String(id), []]))
  if (!projectIds.length) return map
  const placeholders = projectIds.map(() => '?').join(',')
  const { rows } = await query(env, `SELECT t.id, t.project_id, t.kind, t.name, t.taken_by,
      u.username AS taken_by_username, u.name AS taken_by_name, t.created_at,
      (SELECT COUNT(*) FROM project_take_helpers h WHERE h.take_id=t.id) AS helpers_count,
      COALESCE((SELECT SUM(h.commitment_kes) FROM project_take_helpers h WHERE h.take_id=t.id),0) AS helpers_committed_kes
    FROM project_takes t LEFT JOIN users u ON u.id=t.taken_by
    WHERE t.project_id IN (${placeholders}) ORDER BY t.created_at ASC`, [...projectIds])
  let helperDetail = new Map()
  if (details && rows.length) {
    const tIds = rows.map(r => r.id)
    const ph = tIds.map(() => '?').join(',')
    const { rows: hd } = await query(env, `SELECT h.take_id, h.commitment_kes, h.note, u.username, u.name
      FROM project_take_helpers h LEFT JOIN users u ON u.id=h.user_id WHERE h.take_id IN (${ph}) ORDER BY h.created_at ASC`, tIds)
    for (const r of hd) {
      const list = helperDetail.get(String(r.take_id)) || []
      list.push({ username: r.username, name: r.name, commitment_kes: Number(r.commitment_kes) || 0, note: r.note || '' })
      helperDetail.set(String(r.take_id), list)
    }
  }
  for (const r of rows) {
    // The taker is themselves recorded as a helper on first pledge, so the
    // running total is the helper sum — the take row's committed_kes is the
    // taker's original pledge, already inside the helpers table.
    const helpers = Number(r.helpers_committed_kes) || 0
    map.get(String(r.project_id))?.push({
      id: String(r.id),
      kind: r.kind,
      name: r.name,
      taken_by: r.taken_by ? { username: r.taken_by_username, name: r.taken_by_name } : null,
      created_at: r.created_at,
      helpers_count: Number(r.helpers_count) || 0,
      helpers_committed_kes: helpers,
      total_committed_kes: helpers,
      ...(details ? { helpers_detail: helperDetail.get(String(r.id)) || [] } : {}),
    })
  }
  return map
}

async function baseProjects(env, userId = null, { includeMembers = false } = {}) {
  const { rows } = await query(env, `SELECT p.*,
    COALESCE((SELECT SUM(pc.amount_kes) FROM project_contributions pc WHERE pc.project_id=p.id),0) AS raised_kes,
    COALESCE((SELECT SUM(pp.commitment_kes) FROM project_participants pp WHERE pp.project_id=p.id),0) AS committed_kes,
    (SELECT COUNT(*) FROM project_participants pp WHERE pp.project_id=p.id) AS participants
    FROM projects p ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, p.created_at DESC`)
  let mine = new Map()
  if (userId) {
    const { rows: m } = await query(env, `SELECT pp.project_id, pp.commitment_kes, pp.reminder_enabled,
      COALESCE((SELECT SUM(pc.amount_kes) FROM project_contributions pc WHERE pc.project_id=pp.project_id AND pc.user_id=pp.user_id),0) AS paid_kes
      FROM project_participants pp WHERE pp.user_id=?`, [userId])
    mine = new Map(m.map(x => [String(x.project_id), x]))
  }
  const takeMap = await takesForProjects(env, rows.map(r => r.id), { details: includeMembers })
  let takeMine = new Map()
  if (userId) {
    const { rows: tm } = await query(env, `SELECT h.take_id, h.commitment_kes FROM project_take_helpers h WHERE h.user_id=?`, [userId])
    takeMine = new Map(tm.map(x => [String(x.take_id), { commitment_kes: Number(x.commitment_kes) || 0 }]))
  }
  let memberLists = new Map()
  if (includeMembers && rows.length) {
    const placeholders = rows.map(() => '?').join(',')
    const { rows: mm } = await query(env, `SELECT pp.project_id, pp.commitment_kes, pp.user_id, u.username, u.name
      FROM project_participants pp LEFT JOIN users u ON u.id=pp.user_id WHERE pp.project_id IN (${placeholders})`, rows.map(r => r.id))
    for (const r of mm) {
      const list = memberLists.get(String(r.project_id)) || []
      list.push({ username: r.username, name: r.name, commitment_kes: Number(r.commitment_kes) || 0 })
      memberLists.set(String(r.project_id), list)
    }
  }
  return rows.map(r => {
    const takes = (takeMap.get(String(r.id)) || []).map(t => ({ ...t, mine_helper: takeMine.get(t.id) || null }))
    const mineTakeRow = takes.find(t => t.mine_helper)
    const mineTake = mineTakeRow ? { take_id: mineTakeRow.id, kind: mineTakeRow.kind, name: mineTakeRow.name, commitment_kes: mineTakeRow.mine_helper.commitment_kes } : null
    const out = projectRow(r, mine.get(String(r.id)) || null, takes, mineTake)
    if (includeMembers) out.participants_list = memberLists.get(String(r.id)) || []
    return out
  })
}

export async function handleProjects(request, env, ctx) {
  const path = new URL(request.url).pathname
  const user = ctx.user
  if (path === '/api/projects' && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    return jsonResponse({ projects: await baseProjects(env, fresh.id) })
  }

  const match = path.match(/^\/api\/projects\/([^/]+)$/)
  if (match && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const all = await baseProjects(env, fresh.id, { includeMembers: fresh.role === 'admin' })
    const p = all.find(x => x.id === match[1])
    return p ? jsonResponse({ project: p }) : errorResponse('project not found', 404)
  }

  // ── Admin override endpoints: the admin runs the app, so he can correct
  // any pledge, rename/reassign a take, and remove anyone from anything.
  // Money already moved stays untouched (project_contributions) — only
  // pledges are overridable, with the audit protecting the real cash.
  const overrideParticipant = path.match(/^\/api\/projects\/admin\/([^/]+)\/participants\/([^/]+)$/)
  if (overrideParticipant && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const fresh = await requireAdmin(env, user)
    const projectId = overrideParticipant[1]
    const target = overrideParticipant[2]
    if (request.method === 'DELETE') {
      await query(env, `DELETE FROM project_participants WHERE project_id=? AND user_id IN (SELECT id FROM users WHERE username=?)`, [projectId, target])
      // helpers too — removing a member removes him from team takes
      await query(env, `DELETE FROM project_take_helpers WHERE user_id IN (SELECT id FROM users WHERE username=?) AND take_id IN (SELECT id FROM project_takes WHERE project_id=?)`, [target, projectId])
      return jsonResponse({ removed: true, project_id: projectId, user: target })
    }
    const body = await readJson(request)
    const commitment = Number(body.commitment_kes)
    if (!Number.isFinite(commitment) || commitment < 0 || commitment > 100000000) return errorResponse('commitment must be between KES 0 and KES 100,000,000', 400)
    const ind = (await query(env, `SELECT pp.rowid AS rid, pp.user_id, pp.commitment_kes FROM project_participants pp
      LEFT JOIN users u ON u.id=pp.user_id WHERE pp.project_id=? AND u.username=?`, [projectId, String(target)])).rows[0]
    const helper = (await query(env, `SELECT h.rowid AS rid, h.commitment_kes FROM project_take_helpers h
      LEFT JOIN users u ON u.id=h.user_id WHERE u.username=?
        AND h.take_id IN (SELECT id FROM project_takes WHERE project_id=?)`, [String(target), projectId])).rows[0]
    if (!ind && !helper) return errorResponse('participant not found', 404)
    if (ind) {
      await query(env, 'UPDATE project_participants SET commitment_kes=?, updated_at=? WHERE rowid=?', [commitment, new Date().toISOString(), ind.rid])
      await auditLog(env, fresh, 'project_pledge_override', projectId, { user: target, before: Number(ind.commitment_kes), after: commitment })
    }
    if (helper) {
      await query(env, 'UPDATE project_take_helpers SET commitment_kes=?, updated_at=? WHERE rowid=?', [commitment, new Date().toISOString(), helper.rid])
      await auditLog(env, fresh, 'project_take_pledge_override', projectId, { user: target, before: Number(helper.commitment_kes), after: commitment })
    }
    return jsonResponse({ updated: true, commitment_kes: commitment, individual: !!ind, helper: !!helper })
  }

  const overrideTake = path.match(/^\/api\/projects\/admin\/([^/]+)\/takes\/([^/]+)$/)
  if (overrideTake && request.method === 'DELETE') {
    const fresh = await requireAdmin(env, user)
    const projectId = overrideTake[1]
    const t = (await query(env, 'SELECT id FROM project_takes WHERE id=? AND project_id=?', [overrideTake[2], projectId])).rows[0]
    if (!t) return errorResponse('take not found', 404)
    await query(env, 'DELETE FROM project_takes WHERE id=?', [t.id])
    return jsonResponse({ removed: true, take_id: t.id })
  }
  if (overrideTake && request.method === 'PATCH') {
    const fresh = await requireAdmin(env, user)
    const projectId = overrideTake[1]
    const body = await readJson(request)
    const t = (await query(env, 'SELECT id, kind, name, taken_by FROM project_takes WHERE id=? AND project_id=?', [overrideTake[2], projectId])).rows[0]
    if (!t) return errorResponse('take not found', 404)
    const sets = [], vals = []
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0,120)
      if (!name) return errorResponse('name required', 400)
      sets.push('name=?'); vals.push(name)
    }
    if (body.taken_by_username !== undefined) {
      const owner = (await query(env, 'SELECT id FROM users WHERE username=?', [String(body.taken_by_username)])).rows[0]
      if (!owner) return errorResponse('member not found', 404)
      sets.push('taken_by=?'); vals.push(owner.id)
    }
    if (!sets.length) return errorResponse('no changes to apply', 400)
    await query(env, `UPDATE project_takes SET ${sets.join(',')}, updated_at=? WHERE id=?`, [...vals, new Date().toISOString(), t.id])
    return jsonResponse({ updated: true, take_id: t.id })
  }

  const participate = path.match(/^\/api\/projects\/([^/]+)\/participate$/)
  if (participate && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const id = participate[1]
    const p = (await query(env, 'SELECT id,status,deadline FROM projects WHERE id=?', [id])).rows[0]
    if (!p) return errorResponse('project not found', 404)
    if (!['active','upcoming'].includes(p.status)) return errorResponse('project is not accepting participation', 409)
    const now = new Date().toISOString()

    // Collective take/help: the commitment lands on a group, department or
    // community ("take"). Helping again updates, never duplicates: the row
    // is upserted on (take, user). A brand-new entity names this member as
    // the one who took it (taken_by).
    const take = body.take
    if (take && (take.take_id || take.kind)) {
      let takeRow = null
      const kind = String(take.kind || '')
      const name = String(take.name || '').trim().slice(0,120)
      if (take.take_id) {
        takeRow = (await query(env, 'SELECT id,project_id FROM project_takes WHERE id=? AND project_id=?', [String(take.take_id), id])).rows[0]
        if (!takeRow) return errorResponse('take not found for this project', 404)
      } else {
        if (!KINDS.includes(kind)) return errorResponse('take kind must be group, department or community', 400)
        if (!name) return errorResponse('a group, department or community must be picked', 400)
        takeRow = (await query(env, 'SELECT id,project_id FROM project_takes WHERE project_id=? AND kind=? AND name=?', [id, kind, name])).rows[0]
      }
      const commitment = Number(body.commitment_kes)
      if (!Number.isFinite(commitment) || commitment < 0 || commitment > 100000000) return errorResponse('commitment must be between KES 0 and KES 100,000,000', 400)
      const note = String(body.note || take.note || '').trim().slice(0, 200)
      if (!takeRow) {
        takeRow = (await query(env, `INSERT INTO project_takes(id,project_id,kind,name,taken_by,committed_kes,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(project_id,kind,name) DO NOTHING
          RETURNING id,project_id`,
          [uuid(), id, kind, name, fresh.id, commitment, now, now])).rows?.[0]
        if (!takeRow) takeRow = (await query(env, 'SELECT id,project_id FROM project_takes WHERE project_id=? AND kind=? AND name=?', [id, kind, name])).rows[0]
      }
      await query(env, `INSERT INTO project_take_helpers(take_id,user_id,commitment_kes,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(take_id,user_id) DO UPDATE SET commitment_kes=excluded.commitment_kes, note=excluded.note, updated_at=excluded.updated_at`,
        [takeRow.id, fresh.id, commitment, note, now, now])
      const all = await baseProjects(env, fresh.id)
      const project = all.find(x => x.id === id)
      const takeOut = project?.takes?.find(t => t.id === String(takeRow.id))
      return jsonResponse({ project, take: takeOut, helper: { take_id: String(takeRow.id), commitment_kes: commitment } })
    }

    const commitment = Number(body.commitment_kes)
    if (!Number.isFinite(commitment) || commitment < 0 || commitment > 100000000) return errorResponse('commitment must be between KES 0 and KES 100,000,000', 400)
    const reminder = body.reminder_enabled === false ? 0 : 1
    await query(env, `INSERT INTO project_participants(project_id,user_id,commitment_kes,reminder_enabled,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(project_id,user_id) DO UPDATE SET commitment_kes=excluded.commitment_kes, reminder_enabled=excluded.reminder_enabled, updated_at=excluded.updated_at`,
      [id, fresh.id, commitment, reminder, now, now])
    // Notify the project creator + existing participants that someone joined.
    const proj = (await query(env, 'SELECT name, created_by FROM projects WHERE id=?', [id])).rows[0]
    if (proj) {
      const watchers = new Set([
        ...(await query(env, 'SELECT user_id FROM project_participants WHERE project_id=?', [id])).rows.map(r => r.user_id),
        proj.created_by,
      ].filter(Boolean))
      watchers.delete(fresh.id)
      if (watchers.size) {
        const rec = recordNotificationsSafe(env, [...watchers].map(uid => ({
          userId: uid,
          type: 'project',
          category: 'all',
          title: `${fresh.name || '@' + fresh.username} joined ${proj.name}`,
          body: Number(body.commitment_kes) > 0 ? `Pledged KES ${Number(body.commitment_kes).toLocaleString()} toward ${proj.name}.` : 'Committed to helping complete this project.',
          preview: 'Church project',
          target: { type: 'project', id, actor_user_id: fresh.id },
        })))
        if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(rec)
        else rec.catch(() => {})
      }
    }
    const all = await baseProjects(env, fresh.id)
    return jsonResponse({ project: all.find(x => x.id === id) })
  }

  if (path === '/api/projects/admin' && request.method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const body = await readJson(request)
    const name = String(body.name || '').trim().slice(0,120)
    const description = String(body.description || '').trim().slice(0,1000)
    const goal = Number(body.goal_kes)
    if (!name || !Number.isFinite(goal) || goal <= 0) return errorResponse('name and positive goal required',400)
    const status = ['upcoming','active','paused','completed','closed'].includes(body.status) ? body.status : 'active'
    const id = uuid()
    const now = new Date().toISOString()
    await query(env, `INSERT INTO projects(id,name,description,goal_kes,deadline,status,auto_advertise,advertise_from,advertise_until,advertise_frequency_days,icon,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,name,description,goal,body.deadline || null,status,body.auto_advertise === false ? 0 : 1,body.advertise_from || now,body.advertise_until || null,Math.max(1,Math.min(30,Number(body.advertise_frequency_days)||3)),String(body.icon||'🤲').slice(0,8),fresh.id,now,now])
    return jsonResponse({ project: (await baseProjects(env, fresh.id)).find(x => x.id === id) }, 201)
  }

  const adminProject = path.match(/^\/api\/projects\/admin\/([^/]+)$/)
  const PROJECT_STATUSES = ['upcoming','active','paused','completed','closed']
  if (adminProject && request.method === 'PATCH') {
    const fresh = await requireAdmin(env, user)
    const id = adminProject[1]
    const existing = (await query(env, 'SELECT id FROM projects WHERE id=?', [id])).rows[0]
    if (!existing) return errorResponse('project not found', 404)
    const body = await readJson(request)
    const updates = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0,120)
      if (!name) return errorResponse('name required', 400)
      updates.name = name
    }
    if (body.description !== undefined) updates.description = String(body.description).trim().slice(0,1000)
    if (body.goal_kes !== undefined) {
      const goal = Number(body.goal_kes)
      if (!Number.isFinite(goal) || goal <= 0) return errorResponse('goal must be a positive amount', 400)
      updates.goal_kes = goal
    }
    if (body.deadline !== undefined) updates.deadline = body.deadline || null
    if (body.status !== undefined) {
      if (!PROJECT_STATUSES.includes(body.status)) return errorResponse('invalid status', 400)
      updates.status = body.status
    }
    if (body.auto_advertise !== undefined) updates.auto_advertise = body.auto_advertise === false ? 0 : 1
    if (body.advertise_frequency_days !== undefined) updates.advertise_frequency_days = Math.max(1, Math.min(30, Number(body.advertise_frequency_days) || 3))
    if (body.icon !== undefined) updates.icon = String(body.icon || '').slice(0,8) || '🤲'
    if (!Object.keys(updates).length) return errorResponse('no changes to apply', 400)
    const now = new Date().toISOString()
    const keys = Object.keys(updates)
    await query(env, `UPDATE projects SET ${keys.map(k => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, [...keys.map(k => updates[k]), now, id])
    return jsonResponse({ project: (await baseProjects(env, fresh.id)).find(x => x.id === id) })
  }
  if (adminProject && request.method === 'DELETE') {
    const fresh = await requireAdmin(env, user)
    const id = adminProject[1]
    const existing = (await query(env, 'SELECT id FROM projects WHERE id=?', [id])).rows[0]
    if (!existing) return errorResponse('project not found', 404)
    await query(env, 'DELETE FROM project_takes WHERE project_id=?', [id])
    await query(env, 'DELETE FROM project_participants WHERE project_id=?', [id])
    // Participation rows follow the project out; contribution rows are kept
    // as the audit trail for money already moved against this project.
    await query(env, 'DELETE FROM projects WHERE id=?', [id])
    return jsonResponse({ deleted: true, id })
  }

  return null
}
