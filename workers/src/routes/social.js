import { query } from '../lib/db.js'
import { jsonResponse, errorResponse, readJson, searchParams } from '../lib/http.js'
import { requireMember } from '../lib/auth.js'
import { mediaUrlOrNull } from '../lib/media.js'

function clean(v, max=1000) { return String(v ?? '').trim().slice(0,max) }

export async function handleSocial(request, env, ctx) {
  const path = new URL(request.url).pathname
  const qp = searchParams(new URL(request.url))
  const user = ctx.user

  // Persistent Reel saves: members can save/unsave approved Reels and
  // retrieve the same saved list from any signed-in device.
  const save = path.match(/^\/api\/reels\/([^/]+)\/save$/)
  if (save && request.method === 'POST') {
    const fresh = await requireMember(env, user)
    const reelId = save[1]
    const reel = await query(env, 'SELECT id FROM reels WHERE id=? AND approved_at IS NOT NULL', [reelId])
    if (!reel.rows[0]) return errorResponse('reel not found', 404)
    await query(env, 'INSERT OR IGNORE INTO reel_saves (user_id,reel_id) VALUES (?,?)', [fresh.id, reelId])
    return jsonResponse({ ok:true, saved:true, reel_id:reelId })
  }
  if (save && request.method === 'DELETE') {
    const fresh = await requireMember(env, user)
    const reelId = save[1]
    await query(env, 'DELETE FROM reel_saves WHERE user_id=? AND reel_id=?', [fresh.id, reelId])
    return jsonResponse({ ok:true, saved:false, reel_id:reelId })
  }

  if (path === '/api/reels/saved' && request.method === 'GET') {
    const fresh = await requireMember(env, user)
    const limit = Math.min(Math.max(parseInt(qp.limit || '50', 10) || 50, 1), 100)
    const offset = Math.max(parseInt(qp.offset || '0', 10) || 0, 0)
    const { rows } = await query(env,
      `SELECT r.*, u.username, u.name, u.verified, rs.created_at AS saved_at
         FROM reel_saves rs
         JOIN reels r ON r.id=rs.reel_id
         JOIN users u ON u.id=r.user_id
        WHERE rs.user_id=? AND r.approved_at IS NOT NULL
        ORDER BY rs.created_at DESC LIMIT ? OFFSET ?`,
      [fresh.id, limit, offset])
    const out = await Promise.all(rows.map(async r => ({
      id:r.id, username:r.username, name:r.name, verified:!!r.verified,
      caption:r.caption || '', views:r.views || 0, likes:r.likes || 0, comments:r.comments || 0,
      poster_url: r.poster_key ? await mediaUrlOrNull(env,r.poster_key,900) : null,
      hls_url: r.hls_master_key ? await mediaUrlOrNull(env,r.hls_master_key,900) : null,
      saved_at:r.saved_at
    })))
    return jsonResponse({ reels:out, nextOffset:offset+rows.length, hasMore:rows.length===limit })
  }

  // Edit captions / attached music. Owners can edit their own content; admin can moderate any.
  const edit = path.match(/^\/api\/(posts|reels|stories)\/([^/]+)$/)
  if (edit && request.method === 'PATCH') {
    const fresh = await requireMember(env, user)
    const table = edit[1], id = edit[2]
    const row = await query(env, `SELECT * FROM ${table} WHERE id=?`, [id])
    if (!row.rows[0]) return errorResponse('not found', 404)
    if (row.rows[0].user_id !== fresh.id && fresh.role !== 'admin') return errorResponse('forbidden', 403)
    const body = await readJson(request)
    const caption = clean(body.caption, 2000)
    const trackId = body.music_track_id ? clean(body.music_track_id, 128) : null
    if (trackId) {
      const track = await query(env, 'SELECT id FROM tracks WHERE id=?', [trackId])
      if (!track.rows[0]) return errorResponse('music track not found', 404)
    }
    if (table === 'posts') await query(env, 'UPDATE posts SET caption=?, music_track_id=? WHERE id=?', [caption, trackId, id])
    else if (table === 'reels') await query(env, 'UPDATE reels SET caption=?, music_track_id=? WHERE id=?', [caption, trackId, id])
    else await query(env, 'UPDATE stories SET caption=?, music_track_id=? WHERE id=?', [caption, trackId, id])
    await query(env, 'INSERT INTO audit_log (actor_id,actor_role,action,target_type,target_id,meta) VALUES (?,?,?,?,?,?)',
      [fresh.id,fresh.role,'content_edited',table,id,JSON.stringify({music_track_id:trackId})])
    return jsonResponse({ ok:true, id, kind:table, caption, music_track_id:trackId })
  }

  // Story replies: authenticated members can reply; owner/admin can read all replies.
  const reply = path.match(/^\/api\/stories\/([^/]+)\/replies$/)
  if (reply && request.method === 'GET') {
    await requireMember(env, user)
    const sid = reply[1]
    const exists = await query(env, 'SELECT id FROM stories WHERE id=? AND expires_at>?', [sid,new Date().toISOString()])
    if (!exists.rows[0]) return errorResponse('story not found',404)
    const {rows}=await query(env, 'SELECT r.id,r.username,r.body,r.created_at,u.name,u.verified FROM story_replies r LEFT JOIN users u ON u.username=r.username WHERE r.story_id=? ORDER BY r.created_at ASC LIMIT 200',[sid])
    rows.forEach(r=>r.verified=!!r.verified)
    return jsonResponse({replies:rows})
  }
  if (reply && request.method === 'POST') {
    const fresh = await requireMember(env,user)
    const sid=reply[1], body=await readJson(request), text=clean(body.body,1000)
    if(!text) return errorResponse('reply required',400)
    const story=await query(env,'SELECT id FROM stories WHERE id=? AND expires_at>?',[sid,new Date().toISOString()])
    if(!story.rows[0]) return errorResponse('story not found',404)
    const id=crypto.randomUUID()
    await query(env,'INSERT INTO story_replies (id,story_id,user_id,username,body) VALUES (?,?,?,?,?)',[id,sid,fresh.id,fresh.username,text])
    return jsonResponse({reply:{id,username:fresh.username,name:fresh.name,body:text,created_at:new Date().toISOString(),verified:!!fresh.verified}},201)
  }
  if (reply && request.method === 'DELETE') {
    const fresh=await requireMember(env,user), rid=qp.id || ''
    if(!rid) return errorResponse('reply id required',400)
    const r=await query(env,'SELECT id,user_id,username FROM story_replies WHERE id=? AND story_id=?',[rid,reply[1]])
    if(!r.rows[0]) return errorResponse('not found',404)
    if((r.rows[0].user_id && r.rows[0].user_id !== fresh.id) || (!r.rows[0].user_id && r.rows[0].username !== fresh.username)) { if (fresh.role !== 'admin') return errorResponse('forbidden',403) }
    await query(env,'DELETE FROM story_replies WHERE id=?',[rid])
    return jsonResponse({ok:true})
  }
  return null
}
