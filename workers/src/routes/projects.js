import { query, uuid } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'

function projectRow(row, mine = null) {
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
    mine: mine ? {
      commitment_kes: Number(mine.commitment_kes) || 0,
      paid_kes: Number(mine.paid_kes) || 0,
      remaining_kes: Math.max((Number(mine.commitment_kes) || 0) - (Number(mine.paid_kes) || 0), 0),
      reminder_enabled: Boolean(mine.reminder_enabled),
    } : null,
  }
}

async function baseProjects(env, userId = null) {
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
  return rows.map(r => projectRow(r, mine.get(String(r.id)) || null))
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
    const all = await baseProjects(env, fresh.id)
    const p = all.find(x => x.id === match[1])
    return p ? jsonResponse({ project: p }) : errorResponse('project not found', 404)
  }

  const participate = path.match(/^\/api\/projects\/([^/]+)\/participate$/)
  if (participate && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const body = await readJson(request)
    const id = participate[1]
    const p = (await query(env, 'SELECT id,status,deadline FROM projects WHERE id=?', [id])).rows[0]
    if (!p) return errorResponse('project not found', 404)
    if (!['active','upcoming'].includes(p.status)) return errorResponse('project is not accepting participation', 409)
    const commitment = Number(body.commitment_kes)
    if (!Number.isFinite(commitment) || commitment < 0 || commitment > 100000000) return errorResponse('commitment must be between KES 0 and KES 100,000,000', 400)
    const reminder = body.reminder_enabled === false ? 0 : 1
    const now = new Date().toISOString()
    await query(env, `INSERT INTO project_participants(project_id,user_id,commitment_kes,reminder_enabled,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(project_id,user_id) DO UPDATE SET commitment_kes=excluded.commitment_kes, reminder_enabled=excluded.reminder_enabled, updated_at=excluded.updated_at`,
      [id, fresh.id, commitment, reminder, now, now])
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

  return null
}
