import { exec } from 'child_process'
import { promisify } from 'util'
import { minio, BUCKET } from '../s3.js'
import { query } from '../db.js'
const sh = promisify(exec)

// Worker: HLS 360/480/720 + poster 266 for reels
// Requires ffmpeg on VPS (apt install ffmpeg). Veryfast preset for 1 vCPU.

async function transcode(row) {
  const { id, original_key } = row
  const src = `/tmp/harvest-src-${id}.mp4`
  await minio.fGetObject(BUCKET, original_key, src)
  const outDir = `/tmp/harvest-hls-${id}`
  await sh(`mkdir -p ${outDir}`)
  // 3 ladders
  await sh(`ffmpeg -y -i ${src} -vf scale=-2:360 -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 64k -hls_time 4 -hls_playlist_type vod ${outDir}/360p.m3u8`)
  await sh(`ffmpeg -y -i ${src} -vf scale=-2:480 -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 96k -hls_time 4 -hls_playlist_type vod ${outDir}/480p.m3u8`)
  await sh(`ffmpeg -y -i ${src} -vf scale=-2:720 -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 128k -hls_time 4 -hls_playlist_type vod ${outDir}/720p.m3u8`)
  await sh(`printf '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360\\n360p.m3u8\\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480\\n480p.m3u8\\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\\n720p.m3u8\\n' > ${outDir}/master.m3u8`)
  // poster 266w
  await sh(`ffmpeg -y -ss 0.5 -i ${src} -vframes 1 -vf scale=266:-1 ${outDir}/poster.jpg`)

  const uploads = [
    [`hls/${id}/360p.m3u8`, `${outDir}/360p.m3u8`],
    [`hls/${id}/480p.m3u8`, `${outDir}/480p.m3u8`],
    [`hls/${id}/720p.m3u8`, `${outDir}/720p.m3u8`],
    [`hls/${id}/master.m3u8`, `${outDir}/master.m3u8`],
    [`posters/${id}.jpg`, `${outDir}/poster.jpg`],
  ]
  for (const [key, file] of uploads) {
    // also upload segments
    await minio.fPutObject(BUCKET, key, file)
  }
  // upload .ts segments
  const { stdout } = await sh(`ls ${outDir}/*.ts 2>/dev/null || true`)
  for (const ts of stdout.split('\n').filter(Boolean)) {
    const name = ts.split('/').pop()
    await minio.fPutObject(BUCKET, `hls/${id}/${name}`, ts)
  }
  await query(`UPDATE pending_queue SET hls_master_key=$2, poster_key=$3, status='pending' WHERE id=$1`, [id, `hls/${id}/master.m3u8`, `posters/${id}.jpg`])
  // also update reels if already approved (admin direct)
  await query(`UPDATE reels SET hls_master_key=$2, poster_key=$3 WHERE id=$1`, [id, `hls/${id}/master.m3u8`, `posters/${id}.jpg`])
  console.log(`[transcode] ${id} done master+hls+poster`)
  await sh(`rm -rf ${outDir} ${src}`)
}

async function loop() {
  const { rows } = await query(`SELECT id, original_key FROM pending_queue WHERE type='reel' AND (hls_master_key IS NULL OR status='transcoding') ORDER BY created_at ASC LIMIT 1`)
  for (const r of rows) {
    try { await transcode(r) } catch (e) { console.error('[transcode] fail', r.id, e.message); await query(`UPDATE pending_queue SET status='pending' WHERE id=$1`, [r.id]) }
  }
  setTimeout(loop, 10000)
}
loop()
