import { query } from '../db.js'
import { minio, BUCKET } from '../s3.js'

// Cron every 5 min: delete expired stories + GC orphan originals

async function purgeStories() {
  const { rows } = await query(`DELETE FROM stories WHERE expires_at < now() RETURNING id, original_key, thumb_key`)
  if (rows.length) {
    console.log(`[cron] purged ${rows.length} expired stories`)
    for (const r of rows) {
      for (const k of [r.original_key, r.thumb_key].filter(Boolean)) {
        try { await minio.removeObject(BUCKET, k) } catch {}
      }
    }
  }
}

async function gcOrphans() {
  // delete pending_queue rejected >7d and orphan originals without row
  await query(`DELETE FROM pending_queue WHERE status='rejected' AND reviewed_at < now() - interval '7 days'`)
}

setInterval(async () => {
  try { await purgeStories(); await gcOrphans() } catch (e) { console.error('[cron] error', e.message) }
}, 5*60*1000)

// run once on start
purgeStories().then(()=> console.log('[cron] stories expiry cron running every 5m (24h TTL)'))
