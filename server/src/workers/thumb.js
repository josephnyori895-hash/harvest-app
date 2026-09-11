import sharp from 'sharp'
import { encode } from 'blurhash'
import { minio, BUCKET } from '../s3.js'
import { query } from '../db.js'

// Worker: polls pending_queue where thumb_key IS NULL and type in post/story/reel poster
// On VPS with 1GB RAM — process sequentially, 400w WebP

async function processOne(row) {
  const { id, original_key, type } = row
  const tmp = `/tmp/harvest-thumb-${id}`
  await minio.fGetObject(BUCKET, original_key, tmp)
  const img = sharp(tmp)
  const meta = await img.metadata()
  const width = meta.width||800, height = meta.height||800
  // 400w WebP
  const out = `/tmp/harvest-thumb-${id}.webp`
  await sharp(tmp).resize(400, null, { withoutEnlargement: true }).webp({ quality: 72 }).toFile(out)
  const thumbKey = `thumbs/${type}/${id}-400w.webp`
  await minio.fPutObject(BUCKET, thumbKey, out, { 'Content-Type': 'image/webp' })
  // blurhash 4x3 from small thumb
  const { data, info } = await sharp(out).raw().ensureAlpha().resize(32,32,{fit:'inside'}).toBuffer({ resolveWithObject: true })
  const hash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3)
  await query(`UPDATE pending_queue SET thumb_key=$2, blurhash=$3, width=$4, height=$5 WHERE id=$1`, [id, thumbKey, hash, width, height])
  console.log(`[thumb] ${id} -> ${thumbKey} ${width}x${height} blurhash ${hash.slice(0,8)}...`)
}

async function loop() {
  const { rows } = await query(`SELECT id, original_key, type FROM pending_queue WHERE thumb_key IS NULL AND type IN ('post','story') ORDER BY created_at ASC LIMIT 5`)
  for (const r of rows) {
    try { await processOne(r) } catch (e) { console.error('[thumb] fail', r.id, e.message) }
  }
  setTimeout(loop, 5000)
}
loop()
