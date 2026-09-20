import { query } from '../lib/db.js'
import { jsonResponse, errorResponse, readJson, searchParams } from '../lib/http.js'
import { requireMember } from '../lib/auth.js'

function clean(v, max=1000) { return String(v ?? '').trim().slice(0,max) }

export async function handleSocial(request, env, ctx) {
  const path = new URL(request.url).pathname
  const qp = searchParams(new URL(request.url))
  const user = ctx.user

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
    const r=await query(env,'SELECT id,username FROM story_replies WHERE id=? AND story_id=?',[rid,reply[1]])
    if(!r.rows[0]) return errorResponse('not found',404)
    if(r.rows[0].username!==fresh.username && fresh.role!=='admin') return errorResponse('forbidden',403)
    await query(env,'DELETE FROM story_replies WHERE id=?',[rid])
    return jsonResponse({ok:true})
  }
  return null
}
