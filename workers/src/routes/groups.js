// Small Groups — system-admin creates groups, appoints a group admin, and
// stays as group admin, group member, or leaves entirely (their choice).
// Group admins: approve join requests, promote/demote members, remove members.
// Members: request to join, leave, see who's in the group.
import { query, uuid } from '../lib/db.js'
import { requireMember, requireAdmin } from '../lib/auth.js'
import { hasCap } from '../lib/capabilities.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

async function getGroup(env, slug) {
  const { rows } = await query(env, 'SELECT id, slug, name, description, created_at FROM groups WHERE slug=?', [String(slug).slice(0, 80)])
  return rows[0] || null
}

async function myGroupRole(env, groupId, userId) {
  const { rows } = await query(env, `SELECT role FROM group_members WHERE group_id=? AND user_id=?`, [groupId, userId])
  return rows[0]?.role || null
}

async function audit(env, actor, action, targetId, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at) VALUES (?,?,?,'group',?,?,?)`,
    [actor.id, actor.role, action, targetId, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

// A community (congregation) hosts between 3 and 10 small groups.
// MAX is a hard rule enforced at creation; MIN is advisory status shown in the UI.
const COMMUNITY_MAX_GROUPS = 10
const COMMUNITY_MIN_GROUPS = 3

async function communityGroupCounts(env) {
  const { rows } = await query(env, `SELECT community, COUNT(*) AS n FROM groups WHERE community <> '' GROUP BY community`)
  const map = {}
  for (const r of rows) map[r.community] = Number(r.n) || 0
  return map
}

export async function handleGroups(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const user = ctx.user

  // GET /api/groups — all groups with member counts + viewer's role in each,
  // plus per-community counts (each community hosts 3-10 groups).
  if (path === '/api/groups' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT g.id, g.slug, g.name, g.description, g.community, g.invite_only, g.lat, g.lng, g.location_label, COUNT(gm.user_id) AS member_count
         FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
        GROUP BY g.id ORDER BY g.community ASC, g.name ASC`,
    )
    const mine = await query(env, 'SELECT group_id, role FROM group_members WHERE user_id=?', [fresh.id])
    const mineMap = new Map(mine.rows.map(r => [r.group_id, r.role]))
    const out = rows.map(r => ({ ...r, member_count: Number(r.member_count) || 0, my_role: mineMap.get(r.id) || null, joined: mineMap.has(r.id), is_group_admin: mineMap.get(r.id) === 'admin', add_only: !!r.invite_only }))
    const communities = await communityGroupCounts(env)
    return jsonResponse({ groups: out, communities })
  }

  // GET /api/groups/mine — only groups the viewer belongs to.
  if (path === '/api/groups/mine' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const { rows } = await query(
      env,
      `SELECT g.id, g.slug, g.name, g.description, gm.role AS my_role
         FROM group_members gm JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id=? ORDER BY g.name ASC`,
      [fresh.id],
    )
    return jsonResponse({ groups: rows })
  }

  // POST /api/groups — system admin, or a leader granted "create_groups".
  if (path === '/api/groups' && method === 'POST') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'create_groups')) return errorResponse('group creation is granted by the admin', 403)
    const body = await readJson(request)
    const name = String(body.name || '').trim().slice(0, 80)
    const description = String(body.description || '').trim().slice(0, 300) || ''
    const adminUsername = String(body.admin_username || '').trim().toLowerCase()
    const stayAs = body.creator_participation // 'admin' | 'member' | 'none'
    const community = String(body.community || '').trim().slice(0, 80)
    if (name.length < 2) return errorResponse('group name required', 400)
    const slug = slugify(body.slug || name)
    if (!slug) return errorResponse('invalid group name', 400)
    if (await getGroup(env, slug)) return errorResponse('group already exists', 409)
    // Community rule: a community hosts at most 10 groups (3 is the healthy minimum).
    if (community) {
      const counts = await communityGroupCounts(env)
      if ((counts[community] || 0) >= COMMUNITY_MAX_GROUPS) {
        return errorResponse(`"${community}" already has the maximum of ${COMMUNITY_MAX_GROUPS} groups`, 400)
      }
    }

    const id = uuid()
    await query(env, 'INSERT INTO groups (id, slug, name, description, community, invite_only, created_by, created_at) VALUES (?,?,?,?,?,1,?,?)', [id, slug, name, description, community, fresh.id, new Date().toISOString()])

    // Appoint the group admin (must be an existing active member).
    if (adminUsername) {
      const t = await query(env, 'SELECT id, username FROM users WHERE username=? AND active=1', [adminUsername])
      if (!t.rows[0]) return errorResponse(`user "${adminUsername}" not found`, 404)
      await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,'admin') ON CONFLICT (group_id, user_id) DO UPDATE SET role='admin'`, [id, t.rows[0].id])
    }

    // Creator's own participation: stay as group admin, plain member, or leave.
    if (stayAs === 'admin') {
      await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,'admin') ON CONFLICT (group_id, user_id) DO NOTHING`, [id, fresh.id])
    } else if (stayAs === 'member') {
      await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,'member') ON CONFLICT (group_id, user_id) DO NOTHING`, [id, fresh.id])
    }
    // 'none' (or omitted) → creator stays out of the membership list.

    await audit(env, fresh, 'group_created', id, { name, admin_username: adminUsername || null, creator_participation: stayAs || 'none', community: community || null })
    return jsonResponse({ group: { id, slug, name, description, community, member_count: adminUsername ? 1 : 0 } }, 201)
  }

  // Everything below is /api/groups/:slug...
  const m = path.match(/^\/api\/groups\/([^/]+)(?:\/(.*))?$/)
  if (!m) return null
  const slug = decodeURIComponent(m[1])
  const sub = m[2] ? decodeURIComponent(m[2]) : null

  // GET /api/groups/:slug — group info + member list (leaders first).
  if (!sub && method === 'GET') {
    await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const { rows } = await query(
      env,
      `SELECT u.id, u.username, u.name, u.group_name, u.verified, gm.role, gm.joined_at
         FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id=? AND u.active=1
        ORDER BY CASE gm.role WHEN 'admin' THEN 0 ELSE 1 END, u.username ASC LIMIT 200`,
      [g.id],
    )
    rows.forEach(r => { r.verified = !!r.verified })
    return jsonResponse({ group: g, members: rows })
  }

  // POST /api/groups/:slug/leave — any member (incl. group admin) can leave.
  if (sub === 'leave' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const role = await myGroupRole(env, g.id, fresh.id)
    if (!role) return errorResponse('you are not in this group', 400)
    if (role === 'admin') {
      const { rows } = await query(env, `SELECT COUNT(*) AS n FROM group_members WHERE group_id=? AND role='admin'`, [g.id])
      if (Number(rows[0]?.n || 0) <= 1) return errorResponse('you are the only admin of this group — appoint another admin first (or ask the system admin)', 400)
    }
    await query(env, 'DELETE FROM group_members WHERE group_id=? AND user_id=?', [g.id, fresh.id])
    return jsonResponse({ ok: true, left: true })
  }

  // POST /api/groups/:slug/join — member asks to join (creates a pending invite).
  if (sub === 'join' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    if (await myGroupRole(env, g.id, fresh.id)) return errorResponse('already a member', 409)
    // Add-only groups: members cannot self-join at all. The admin adds them
    // directly (POST /api/groups/:slug/members) or from Group Settings.
    if (g.invite_only && fresh.role !== 'admin') {
      return errorResponse('this group is add-only — ask the admin to add you', 403)
    }
    // Reuse the pending-requests table: an approved request = membership.
    const existing = await query(env, `SELECT id, status FROM group_invites WHERE group_id=? AND invited_user_id=? ORDER BY created_at DESC LIMIT 1`, [g.id, fresh.id])
    if (existing.rows[0]?.status === 'pending') return jsonResponse({ status: 'pending', invite_id: existing.rows[0].id })
    const id = uuid()
    await query(
      env,
      `INSERT INTO group_invites (id, group_id, invited_username, invited_user_id, inviter_id, status, created_at) VALUES (?,?,?,?,?,'pending',?)`,
      [id, g.id, fresh.username, fresh.id, fresh.id, new Date().toISOString()],
    )
    return jsonResponse({ status: 'pending', invite_id: id }, 201)
  }

  // GET /api/groups/:slug/requests — pending join requests (group admin only).
  if (sub === 'requests' && method === 'GET') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const role = await myGroupRole(env, g.id, fresh.id)
    if (fresh.role !== 'admin' && role !== 'admin' && !hasCap(fresh, 'manage_groups')) return errorResponse('group admin required', 403)
    const { rows } = await query(
      env,
      `SELECT i.id, i.invited_username AS username, u.name, i.created_at
         FROM group_invites i LEFT JOIN users u ON u.id = i.invited_user_id
        WHERE i.group_id=? AND i.status='pending' ORDER BY i.created_at ASC LIMIT 100`,
      [g.id],
    )
    return jsonResponse({ requests: rows })
  }

  // POST /api/groups/:slug/requests/:id/approve — approve or reject a request.
  if (sub && sub.match(/^requests\/[^/]+\/approve$/) && method === 'POST') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const role = await myGroupRole(env, g.id, fresh.id)
    if (fresh.role !== 'admin' && role !== 'admin' && !hasCap(fresh, 'manage_groups')) return errorResponse('group admin required', 403)
    const inviteId = sub.split('/')[1]
    const body = await readJson(request).catch(() => ({}))
    const approve = body.approve !== false
    const inv = await query(env, `SELECT * FROM group_invites WHERE id=? AND group_id=?`, [inviteId, g.id])
    if (!inv.rows[0]) return errorResponse('request not found', 404)
    if (inv.rows[0].status !== 'pending') return errorResponse(`already ${inv.rows[0].status}`, 409)
    await query(env, `UPDATE group_invites SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`, [approve ? 'approved' : 'rejected', fresh.id, new Date().toISOString(), inviteId])
    if (approve && inv.rows[0].invited_user_id) {
      await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,'member') ON CONFLICT (group_id, user_id) DO NOTHING`, [g.id, inv.rows[0].invited_user_id])
    }
    return jsonResponse({ ok: true, status: approve ? 'approved' : 'rejected' })
  }

  // POST /api/groups/:slug/members (system admin or manage_groups leader) —
  // direct add without a request (admin overrides invite-only).
  if (sub === 'members' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'manage_groups')) return errorResponse('not permitted — needs manage_groups', 403)
    const body = await readJson(request)
    const uname = String(body.username || '').trim().toLowerCase()
    const role = body.role === 'admin' ? 'admin' : 'member'
    if (!uname) return errorResponse('username required', 400)
    const t = await query(env, 'SELECT id, username FROM users WHERE username=? AND active=1', [uname])
    if (!t.rows[0]) return errorResponse('user not found', 404)
    await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?) ON CONFLICT (group_id, user_id) DO UPDATE SET role=excluded.role`, [g.id, t.rows[0].id, role])
    await audit(env, fresh, 'group_member_added', g.id, { username: uname, role })
    return jsonResponse({ ok: true, username: uname, role })
  }

  // POST /api/groups/:slug/role (group or system admin) — promote/demote.
  if (sub === 'role' && method === 'POST') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const actorRole = await myGroupRole(env, g.id, fresh.id)
    if (fresh.role !== 'admin' && actorRole !== 'admin' && !hasCap(fresh, 'manage_groups')) return errorResponse('group admin required', 403)
    const body = await readJson(request)
    const uname = String(body.username || '').trim().toLowerCase()
    const nextRole = body.role === 'admin' ? 'admin' : 'member'
    if (!uname) return errorResponse('username required', 400)
    const t = await query(env, 'SELECT id, username FROM users WHERE username=? AND active=1', [uname])
    if (!t.rows[0]) return errorResponse('user not found', 404)
    // Guard: group admins cannot demote the last group admin (the system
    // admin may — they appointed them and can re-appoint later).
    if (nextRole === 'member' && fresh.role !== 'admin') {
      const cur = await myGroupRole(env, g.id, t.rows[0].id)
      if (cur === 'admin') {
        const { rows } = await query(env, `SELECT COUNT(*) AS n FROM group_members WHERE group_id=? AND role='admin'`, [g.id])
        if (Number(rows[0]?.n || 0) <= 1) return errorResponse('cannot demote the only group admin', 400)
      }
    }
    await query(env, `INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?) ON CONFLICT (group_id, user_id) DO UPDATE SET role=excluded.role`, [g.id, t.rows[0].id, nextRole])
    await audit(env, fresh, nextRole === 'admin' ? 'group_member_promoted' : 'group_member_demoted', g.id, { username: uname })
    return jsonResponse({ ok: true, username: uname, role: nextRole })
  }

  // DELETE /api/groups/:slug/members/:username (group or system admin) — remove a member.
  const mm = sub && sub.match(/^members\/([^/]+)$/)
  if (mm && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    const actorRole = await myGroupRole(env, g.id, fresh.id)
    if (fresh.role !== 'admin' && actorRole !== 'admin' && !hasCap(fresh, 'manage_groups')) return errorResponse('group admin required', 403)
    const uname = String(decodeURIComponent(mm[1])).trim().toLowerCase()
    await query(env, 'DELETE FROM group_members WHERE group_id=? AND user_id=(SELECT id FROM users WHERE username=?)', [g.id, uname])
    await audit(env, fresh, 'group_member_removed', g.id, { username: uname })
    return jsonResponse({ ok: true, removed: uname })
  }

  // PATCH /api/groups/:slug — group settings (WhatsApp-style), system admin only:
  // name, description, community, invite-only ("add-only") toggle, and the
  // location link used for automatic member assignment at registration.
  if (sub === 'settings' && method === 'PATCH') {
    const fresh = await requireMember(env, user)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    if (fresh.role !== 'admin') return errorResponse('only the system admin can change group settings', 403)
    const body = await readJson(request)
    const sets = [], vals = []
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 80)
      if (name.length < 2) return errorResponse('group name required', 400)
      sets.push('name=?'); vals.push(name)
    }
    if (body.description !== undefined) { sets.push('description=?'); vals.push(String(body.description).trim().slice(0, 300)) }
    if (body.community !== undefined) { sets.push('community=?'); vals.push(String(body.community).trim().slice(0, 80)) }
    if (body.invite_only !== undefined) { sets.push('invite_only=?'); vals.push(body.invite_only ? 1 : 0) }
    if (body.location !== undefined) {
      // null clears the location; valid coordinates set it.
      if (body.location === null) {
        sets.push('lat = NULL', 'lng = NULL', "location_label = ''")
      } else {
        const la = Number(body.location.lat), ln = Number(body.location.lng)
        if (Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180) {
          sets.push('lat=?', 'lng=?', 'location_label=?'); vals.push(la, ln, String(body.location.label || '').trim().slice(0, 120))
        } else {
          return errorResponse('location must be { lat: -90..90, lng: -180..180, label } or null', 400)
        }
      }
    }
    if (!sets.length) return errorResponse('nothing to update', 400)
    vals.push(g.id)
    await query(env, `UPDATE groups SET ${sets.join(', ')} WHERE id=?`, vals)
    await audit(env, fresh, 'group_settings_updated', g.id, { slug: g.slug, changes: Object.keys(body) })
    const updated = await query(env, 'SELECT id, slug, name, description, community, invite_only, lat, lng, location_label FROM groups WHERE id=?', [g.id])
    return jsonResponse({ ok: true, group: updated.rows[0] })
  }

  // DELETE /api/groups/:slug — system admin, or "manage_communities" leader.
  if (!sub && method === 'DELETE') {
    const fresh = await requireMember(env, user)
    if (fresh.role !== 'admin' && !hasCap(fresh, 'manage_communities')) return errorResponse('community management is granted by the admin', 403)
    const g = await getGroup(env, slug)
    if (!g) return errorResponse('group not found', 404)
    await query(env, 'DELETE FROM groups WHERE id=?', [g.id])
    await audit(env, fresh, 'group_deleted', g.id, { slug: g.slug })
    return jsonResponse({ ok: true, deleted: g.slug })
  }

  return null
}
