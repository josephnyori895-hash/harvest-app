#!/usr/bin/env node
// E2E: upload a real video story to production, then verify the exact bug we
// fixed: the stories API must NOT hand the video URL back as thumb_url, and
// the video itself must play via its signed URL. Cleans up after itself.
// Usage: node workers/scripts/test-video-story.mjs [baseUrl]
const API = (process.argv[2] || 'https://harvestfamily-api.harvestfamily.workers.dev').replace(/\/$/, '')
import { readFileSync, statSync } from 'node:fs'

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function j(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}

const stamp = String(Date.now()).slice(-8)
const U = { username: `tst.s${stamp}`, phone: `0718${stamp.slice(-6)}`, password: 'Passw0rd!x' }

// 1) Register
const reg = await j('POST', '/api/auth/register', null, { ...U, name: 'Story Test', group_name: 'Harvest Central' })
const token = reg.data?.token
check('register test member', !!token, reg.status)
if (!token) process.exit(1)

// 2) Presign a story video upload
const vid = '/tmp/story-test.mp4'
const bytes = statSync(vid).size
const pre = await j('POST', '/api/media/presign', token, { type: 'story', contentType: 'video/mp4', bytes, ext: 'mp4' })
check('presign video story', pre.status === 200 && !!pre.data?.url && !!pre.data?.key, JSON.stringify(pre.data?.error || pre.status))

// 3) Upload the video
const form = new FormData()
Object.entries(pre.data.fields || {}).forEach(([k, v]) => form.append(k, String(v)))
form.append('file', new Blob([readFileSync(vid)], { type: 'video/mp4' }), 'story.mp4')
const direct = /^https?:\/\//.test(pre.data.url)
const up = await fetch(direct ? pre.data.url : `${API}${pre.data.url}`, { method: 'POST', body: form, headers: direct ? undefined : { Authorization: `Bearer ${token}` } })
check('video bytes uploaded to storage', up.ok, up.status)

// 4) Confirm → story row created, media_type=video
const conf = await j('POST', '/api/media/confirm', token, { key: pre.data.key, type: 'story', caption: 'Video story E2E test' })
check('confirm publishes story', conf.status === 201 && !!conf.data?.id, JSON.stringify(conf.data))
const storyId = conf.data?.id

// 5) /api/stories: video story must have NO image thumb (null) + a video_url
const feed = await j('GET', '/api/feed?limit=30', token)
const mine = (feed.data?.stories || []).find(s => s.id === storyId)
check('story appears in feed strip', !!mine)
check('video story thumb_url is NOT a video URL', mine && (!mine.thumb_url || !/\.mp4|video/i.test(mine.thumb_url)), `thumb_url=${mine?.thumb_url ?? 'null'}`)
check('video story exposes video_url', mine && !!mine.video_url, `video_url=${mine?.video_url ? 'set' : 'missing'}`)

// Also check the dedicated /api/stories endpoint (profile story strips use it)
const st = await j('GET', '/api/stories', token)
const mine2 = (st.data?.stories || []).find(s => s.id === storyId)
check('/api/stories: video story has no video-as-thumb', mine2 && (!mine2.thumb_url || !/\.mp4|video/i.test(mine2.thumb_url)), `thumb_url=${mine2?.thumb_url ?? 'null'}`)
check('/api/stories: video_url present for playback', mine2 && !!mine2.video_url, mine2?.video_url ? 'set' : 'missing')

// 6) The video itself must play (signed URL serves video bytes)
if (mine2?.video_url) {
  const v = await fetch(mine2.video_url, { method: 'GET', headers: { Range: 'bytes=0-1023' } })
  const ct = v.headers.get('content-type') || ''
  check('video URL serves video bytes', (v.status === 206 || v.status === 200) && /video|octet|mp4/i.test(ct), `${v.status} ${ct}`)
}

// 7) UI logic contract: ring renders 🎥 when media_type=video and thumb_url is null.
// (The ring component switches on img presence; thumb_url=null + video set => 🎥 tile.)
const ringWillShowCameraTile = mine2 && !mine2.thumb_url && !!mine2.video_url
check('ring logic resolves to 🎥 tile for this story', ringWillShowCameraTile)

// 8) Cleanup: delete the story + the test member's content
if (storyId) {
  const del = await j('DELETE', `/api/stories/${storyId}`, token)
  check('cleanup: test story deleted', del.status === 200, del.status)
}

console.log(failures === 0 ? '\n🟢 video story flow OK — ring shows 🎥, video plays' : `\n🔴 ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
