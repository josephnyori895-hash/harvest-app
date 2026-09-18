// End-to-end check: sign in as allan through the preview (proves the NetworkError is gone).
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage()
const apiResponses = []
page.on('response', r => { if (r.url().includes('/api/')) apiResponses.push(`${r.status()} ${new URL(r.url()).pathname}`) })

await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true })
await page.goto(process.env.PREVIEW_URL || 'http://localhost:5199/', { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise(r => setTimeout(r, 800))

// Flip to Sign in mode
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in')
  btn?.click()
})
await new Promise(r => setTimeout(r, 400))

// Fill credentials and submit
await page.type('#login-id', 'allan')
await page.type('#login-pass', 'Kipsii@2026#')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Sign in →'))
  btn?.click()
})

// Wait for either the home screen (success) or an error alert
let outcome = 'timeout'
try {
  await page.waitForFunction(() => {
    const alert = document.querySelector('[role="alert"]')
    if (alert && alert.textContent.includes('NetworkError')) return true
    return !!localStorage.getItem('harvest_token')
  }, { timeout: 20000 })
  outcome = await page.evaluate(() => localStorage.getItem('harvest_token') ? 'SIGNED IN ✓' : `still failed: ${document.querySelector('[role="alert"]')?.textContent}`)
} catch { outcome = 'no resolution within 20s' }

console.log('API calls seen:', apiResponses.slice(0, 6).join(' | ') || 'none')
console.log('RESULT:', outcome)

await page.screenshot({ path: '/tmp/preview/after-login.png' })
await browser.close()
