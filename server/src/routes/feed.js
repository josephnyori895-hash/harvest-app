import { query } from '../db.js'
import { presignedGetOrNull } from '../s3.js'

export default async function feedRoutes(app) {
  // GET /api/feed?cursor=&limit=20  (cursor = rank_score of last item, or offset)
  app.get('/api/feed', async (req, reply) => {
    const viewerId = req.user?.id || null
    const limit = Math.min(parseInt(req.query.limit||'20',10), 50)
    const offset = parseInt(req.query.offset||'0',10)
    // fetch viewer affinity snapshot
    let viewer = null
    if (viewerId) {
      const r = await query('SELECT group_name, constituency, faith FROM users WHERE id=$1', [viewerId])
      viewer = r.rows[0] || null
    }
    // Use SQL scoring (same as docs §3.3). Fallback to JS if DB not ready in dev.
    const sql = `
      WITH viewer AS (SELECT $2::text AS vg, $3::text AS vc, $4::text AS vf),
      scored AS (
        SELECT p.id, p.user_id, u.username, u.name, COALESCE(u.verified, p.verified_snapshot,false) AS verified,
               p.caption, p.thumb_key, p.blurhash, p.original_key,
               p.likes, p.comments, p.created_at, p.is_pinned, p.group_name, p.constituency, p.faith,
               EXTRACT(EPOCH FROM (now() - p.created_at))/3600 AS h,
               ln(1 + p.likes + p.comments*3) AS eng_raw, 'post' AS kind
        FROM posts p JOIN users u ON u.id=p.user_id CROSS JOIN viewer
        WHERE p.approved_at IS NOT NULL
        UNION ALL
        SELECT r.id, r.user_id, u.username, u.name, COALESCE(u.verified, r.verified_snapshot,false),
               r.caption, r.poster_key, NULL, r.hls_master_key,
               r.likes, r.comments, r.created_at, r.is_pinned, r.group_name, r.constituency, r.faith,
               EXTRACT(EPOCH FROM (now() - r.created_at))/3600,
               ln(1 + r.likes + r.comments*3), 'reel'
        FROM reels r JOIN users u ON u.id=r.user_id CROSS JOIN viewer
        WHERE r.approved_at IS NOT NULL
      ),
      norm AS (SELECT *, MAX(eng_raw) OVER() AS max_eng FROM scored)
      SELECT *, 
        (0.45*exp(-h/72) + 0.25*(CASE WHEN max_eng>0 THEN eng_raw/max_eng ELSE 0 END)
         + 0.20*(CASE WHEN group_name=vg THEN 0.5 WHEN constituency=vc THEN 0.3 WHEN faith=vf THEN 0.2 ELSE 0 END)
         + 0.10*(CASE WHEN verified THEN 1 ELSE 0 END)
         + CASE WHEN is_pinned THEN 1000 ELSE 0 END) AS rank_score
      FROM norm
      ORDER BY rank_score DESC, created_at DESC
      LIMIT $5 OFFSET $6
    `
    let rows
    try {
      const res = await query(sql, [viewerId, viewer?.group_name||null, viewer?.constituency||null, viewer?.faith||null, limit, offset])
      rows = res.rows
    } catch (e) {
      // dev fallback: empty
      console.error('[feed] sql error', e.message)
      rows = []
    }
    // presign thumbs/posters/HLS on fly (parallel)
    const enriched = await Promise.all(rows.map(async r => ({
      ...r,
      thumb_url: await presignedGetOrNull(r.thumb_key || r.original_key, 900),
      hls_url: r.kind==='reel' ? await presignedGetOrNull(r.original_key, 900) : null,
      // keep raw keys for cache
    })))
    // stories top strip (51)
    let stories = []
    try {
      const s = await query(`SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.expires_at, s.created_at
        FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at > now() ORDER BY s.created_at DESC LIMIT 30`)
      stories = await Promise.all(s.rows.map(async x=> ({ ...x, thumb_url: await presignedGetOrNull(x.thumb_key||'', 600) })))
    } catch {}
    const nextOffset = offset + limit
    return reply.send({ posts: enriched, stories, nextOffset, hasMore: enriched.length===limit })
  })

  // GET /api/stories
  app.get('/api/stories', async (req, reply) => {
    const { rows } = await query(`SELECT s.id, s.user_id, u.username, u.name, s.thumb_key, s.original_key, s.expires_at FROM stories s JOIN users u ON u.id=s.user_id WHERE s.expires_at>now() ORDER BY s.created_at DESC LIMIT 50`)
    const out = await Promise.all(rows.map(async r=> ({ ...r, thumb_url: await presignedGetOrNull(r.thumb_key||r.original_key, 600) })))
    return reply.send({ stories: out })
  })

  // GET /api/reels
  app.get('/api/reels', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit||'20',10), 50)
    const offset = parseInt(req.query.offset||'0',10)
    const { rows } = await query(`SELECT r.*, u.username, u.verified FROM reels r JOIN users u ON u.id=r.user_id WHERE r.approved_at IS NOT NULL ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset])
    const out = await Promise.all(rows.map(async r=> ({ ...r, hls_url: await presignedGetOrNull(r.hls_master_key||r.poster_key, 900), poster_url: await presignedGetOrNull(r.poster_key, 900) })))
    return reply.send({ reels: out, nextOffset: offset+limit })
  })

  // GET /api/music — worship tracks for the Music tab (presigned streaming URL)
  app.get('/api/music', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit||'50',10), 100)
    try {
      const { rows } = await query(`SELECT t.id, t.user_id, u.username AS uploaded_by, u.verified,
                                          t.title, t.artist, t.original_key, t.created_at
                                     FROM tracks t JOIN users u ON u.id=t.user_id
                                    ORDER BY t.created_at DESC LIMIT $1`, [limit])
      const out = await Promise.all(rows.map(async r => ({
        id: r.id,
        title: r.title,
        artist: r.artist || r.uploaded_by || 'Harvest Worship',
        uploaded_by: r.uploaded_by,
        verified: Boolean(r.verified),
        type: 'worship',
        url: await presignedGetOrNull(r.original_key, 3600),
        created_at: r.created_at,
      })))
      return reply.send({ tracks: out })
    } catch (e) {
      console.error('[music] list error', e.message)
      return reply.send({ tracks: [] })
    }
  })
}
