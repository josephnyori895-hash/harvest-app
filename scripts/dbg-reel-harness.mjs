// Reel preview harness: three cases against the LOCAL worker (never production).
// A: poster + valid mp4   B: no poster + valid mp4   C: poster + missing mp4
// Reports rendered state, the tap-to-play transition, playback errors and Retry.
import puppeteer from 'puppeteer-core'

const baseUrl = process.env.BASE_URL || 'http://localhost:5273'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844 })
const media = []
page.on('response', r => {
  const u = r.url()
  if (u.includes('/api/media/')) media.push(`${r.status()} ${decodeURIComponent(new URL(u).pathname.replace('/api/media/', '')).slice(0, 60)}`)
})
await page.goto(baseUrl, { waitUntil: 'networkidle2' })
await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'harvest', pin: 'Kipsii@2026#' }) })
  const b = await r.json()
  if (r.ok && b.token) localStorage.setItem('harvest_token', b.token)
})
await page.goto(baseUrl, { waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 8000))

const before = await page.evaluate(() => Array.from(document.querySelectorAll('article[data-post-id]'))
  .filter(a => (a.textContent || '').includes('QA '))
  .map(a => {
    const img = a.querySelector('img')
    const canvas = a.querySelector('canvas')
    return {
      id: String(a.getAttribute('data-post-id')),
      caption: (a.textContent || '').replace(/\s+/g, ' ').match(/QA [^·]{0,40}/)?.[0],
      img: img ? { ok: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight } : null,
      videoTag: !!a.querySelector('video'),
      videoW: a.querySelector('video')?.videoWidth ?? null,
      canvas: canvas ? { w: canvas.width, h: canvas.height, blank: (() => { try { const ctx = canvas.getContext('2d'); const d = ctx.getImageData(0, 0, Math.min(8, canvas.width), Math.min(8, canvas.height)).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) lit++; return lit === 0 } catch { return 'unreadable' } })() } : null,
      fallbackText: (a.textContent || '').includes('Preview could not load') ? 'Preview could not load' : null,
      playBtn: !!a.querySelector('[aria-label="Play video"]'),
    }
  }))
console.log('PREVIEW STATE', JSON.stringify(before, null, 1))

// Tap each reel stage in turn and record the player outcome.
const play = []
for (let i = 0; i < before.length; i++) {
  const result = await page.evaluate(async (idx) => {
    const stages = Array.from(document.querySelectorAll('article[data-post-id]')).filter(a => (a.textContent || '').includes('QA '))
    const stage = stages[idx]
    stage?.querySelector('[aria-label="Play video"]')?.click()
    await new Promise(r => setTimeout(r, 3500))
    const v = stage?.querySelector('video')
    const errBox = (stage?.textContent || '').match(/Video could not be played[^R]*/)
    return { readyState: v?.readyState ?? null, currentTime: v?.currentTime ?? null, paused: v?.paused ?? null, errorCode: v?.error?.code ?? null, src: v?.getAttribute('src')?.slice(0, 80) ?? null, errorBox: errBox ? errBox[0].trim() : null, hasRetry: !!stage?.querySelector('[aria-label="Retry video playback"]') }
  }, i)
  // Exercise Retry when it is offered.
  if (result.hasRetry) {
    result.afterRetry = await page.evaluate(async (idx) => {
      const stages = Array.from(document.querySelectorAll('article[data-post-id]')).filter(a => (a.textContent || '').includes('QA '))
      const stage = stages[idx]
      stage?.querySelector('[aria-label="Retry video playback"]')?.click()
      await new Promise(r => setTimeout(r, 3000))
      const v = stage?.querySelector('video')
      return { readyState: v?.readyState ?? null, currentTime: v?.currentTime ?? null, errorCode: v?.error?.code ?? null, retryStillShown: !!stage?.querySelector('[aria-label="Retry video playback"]') }
    }, i)
  }
  play.push(result)
}
console.log('PLAYBACK', JSON.stringify(play, null, 1))
console.log('MEDIA RESPONSES', JSON.stringify([...new Set(media)], null, 1))
await browser.close()
