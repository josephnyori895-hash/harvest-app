// Capture the onboarding screen (register + login modes) on a phone-size viewport.
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const base = process.env.PREVIEW_URL || 'http://localhost:5199/'
const outDir = process.env.OUT_DIR || '/tmp/preview'

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})

const page = await browser.newPage()
// Pixel 7-ish: 412x915 CSS px @2x for a crisp image
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

await page.goto(base, { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise(r => setTimeout(r, 800))
await page.screenshot({ path: `${outDir}/register.png`, fullPage: false })

// Flip to the Sign in mode via the toggle button
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in')
  btn?.click()
})
await new Promise(r => setTimeout(r, 500))
await page.screenshot({ path: `${outDir}/login.png`, fullPage: false })

// Full-page scroll capture of the register form (shows all fields + group card)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New here?')
  btn?.click()
})
await new Promise(r => setTimeout(r, 500))
await page.screenshot({ path: `${outDir}/register-full.png`, fullPage: true })

await browser.close()
console.log('saved:', `${outDir}/register.png, ${outDir}/login.png, ${outDir}/register-full.png`)
