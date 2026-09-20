import { jsonResponse, errorResponse } from '../lib/http.js'
import { query } from '../lib/db.js'

export async function handleAdminAudit(request, env, { user }) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/admin/audit')) return null
  if (request.method !== 'GET') return errorResponse('method not allowed', 405)
  if (!user || user.role !== 'admin') return errorResponse('admin required', 403)

  const rawLimit = Number(url.searchParams.get('limit') || 60)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 60, 1), 200)
  const action = (url.searchParams.get('action') || '').trim()
  const actor = (url.searchParams.get('actor') || '').trim()

  const where = []
  const params = []
  if (action) { where.push('action=?'); params.push(action) }
  if (actor) { where.push('actor_username=?'); params.push(actor) }

  const sql = 'SELECT id, actor_id, actor_username, action, target_type, target_id, metadata, created_at FROM admin_audit' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY created_at DESC, id DESC LIMIT ?'
  params.push(limit)

  const result = await query(env, sql, params)
  return jsonResponse({ audit: result.rows.map(row => ({
    ...row,
    metadata: (() => { try { return row.metadata ? JSON.parse(row.metadata) : null } catch { return null } })(),
  })) })
}
