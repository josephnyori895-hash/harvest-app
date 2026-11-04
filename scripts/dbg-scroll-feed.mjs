import puppeteer from 'puppeteer-core'

const baseUrl = 'http://localhost:5273'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844 })
await page.goto(baseUrl, { waitUntil: 'networkidle2' })
// Credentials come from the environment — nothing live lives in this repo
// (see the 2026-11-04 agent-coordination memo).
const Creds = { username: process.env.E2E_USERNAME, pin: process.env.E2E_PIN }
await page.evaluate((cp) => {
  const r = fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cp) })
  r.then(async (res) => { const b = await res.json(); if (res.ok && b.token) localStorage.setItem('harvest_token', b.token) })
}, Creds)
await page.goto(baseUrl, { waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 4500))

const scrollInfo = await page.evaluate(() => {
  const scrollers = Array.from(document.querySelectorAll('div')).filter(d => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 200 && d.clientWidth > 300).map(d => ({ cls: String(d.className).slice(0, 50), sh: d.scrollHeight, ch: d.clientHeight, scrollTop: d.scrollTop, scrollable: d.scrollHeight > d.clientHeight }))
  const main = document.querySelector('main')
  return { scrollers: scrollers.slice(0, 5), mainScrollH: main ? main.scrollHeight : null, mainClientH: main ? main.clientHeight : null }
})
console.log('SCROLLERS:', JSON.stringify(scrollInfo))

// scroll the main scroller to bottom
await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = m.scrollHeight; else document.documentElement.scrollTop = document.documentElement.scrollHeight })
await new Promise(r => setTimeout(r, 3500))
const after = await page.evaluate(() => {
  const articles = Array.from(document.querySelectorAll('article[data-post-id]'))
  return articles.map(a => {
    const vid = a.querySelector('video')
    const img = a.querySelector('img')
    const canvas = a.querySelector('canvas')
    const fallback = (a.textContent || '').includes('Preview could not load')
    return { postId: a.getAttribute('data-post-id'), hasVideo: !!vid, videoW: vid ? vid.videoWidth : null, hasImg: !!img, imgOk: img ? img.complete && img.naturalWidth > 0 : null, canvas: !!canvas, fallback }
  })
})
console.log('AFTER SCROLL:', JSON.stringify(after, null, 1))
await browser.close()
