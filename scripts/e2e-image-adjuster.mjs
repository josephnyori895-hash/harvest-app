#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/$/, '')
const apiUrl = (process.env.E2E_API_URL || baseUrl).replace(/\/$/, '')
const username = process.env.E2E_USERNAME || ''
const pin = process.env.E2E_PIN || ''
const chromePath = process.env.E2E_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ''

if (!baseUrl || !username || !pin || !chromePath) {
  console.log('E2E ImageAdjuster test skipped: set E2E_BASE_URL, E2E_API_URL, E2E_USERNAME, E2E_PIN and E2E_CHROME_PATH.')
  process.exit(0)
}

const cases = [
  { id: 'original', label: 'Original', ratio: 3 / 2 },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: 'Portrait', ratio: 4 / 5 },
  { id: '16:9', label: 'Wide', ratio: 16 / 9 },
]

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
page.setDefaultTimeout(15000)

const fixture = path.join(os.tmpdir(), `harvest-image-adjuster-${process.pid}.svg`)
await fs.writeFile(fixture, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#7c3aed"/><rect x="80" y="80" width="1040" height="640" rx="48" fill="#fffbf0"/><circle cx="600" cy="400" r="180" fill="#f59e0b"/></svg>`)

async function inspectExportPixels(src) {
  return page.evaluate(async url => {
    const response = await fetch(url)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let nearBlack = 0, orange = 0, light = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
      if (r < 18 && g < 18 && b < 18) nearBlack++
      if (r > 210 && g > 100 && g < 200 && b < 80) orange++
      if (r > 220 && g > 215 && b > 190) light++
    }
    bitmap.close()
    return { total: canvas.width * canvas.height, nearBlack, orange, light }
  }, src)
}

async function login() {
  await page.goto(baseUrl, { waitUntil: 'networkidle2' })
  const result = await page.evaluate(async ({ apiUrl, username, pin }) => {
    const response = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    })
    const raw = await response.text()
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch {}
    if (!response.ok || !body.token) return { status: response.status, body }
    localStorage.setItem('harvest_token', body.token)
    localStorage.setItem('harvest_username', username)
    return { status: response.status, ok: true }
  }, { apiUrl, username, pin })
  assert.equal(result.status, 200, `login failed: ${JSON.stringify(result.body)}`)
  assert.equal(result.ok, true)
}

async function clickExactButton(text) {
  const clicked = await page.evaluate((value) => {
    const nodes = [...document.querySelectorAll('button')]
    const node = nodes.find(b => b.textContent?.trim() === value)
    if (!node) return false
    node.click()
    return true
  }, text)
  assert.ok(clicked, `Could not find button: ${text}`)
}

async function waitForImageDimensions(selector) {
  await page.waitForFunction((sel) => {
    const img = document.querySelector(sel)
    return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  }, { timeout: 15000 }, selector)
  return page.$eval(selector, async img => {
    const response = await fetch(img.src)
    const blob = await response.blob()
    return { width: img.naturalWidth, height: img.naturalHeight, src: img.src, mime: blob.type }
  })
}

try {
  await login()

  for (const testCase of cases) {
    await page.reload({ waitUntil: 'networkidle2' })

    const openPost = await page.$('button[aria-label="Open post"]')
    assert.ok(openPost, 'Post creation navigation button is missing')
    await openPost.click()

    await page.waitForSelector('button', { visible: true })
    await clickExactButton('Photo post')

    const input = await page.waitForSelector('input[data-testid="post-create-file-input"]')
    await input.uploadFile(fixture)

    await page.waitForSelector('[data-testid="image-adjuster-save"]', { visible: true })
    await page.waitForSelector(`[data-testid="image-adjuster-aspect-${testCase.id}"]`, { visible: true })
    await page.click(`[data-testid="image-adjuster-aspect-${testCase.id}"]`)
    await page.click('[data-testid="image-adjuster-save"]')

    await page.waitForSelector('[data-testid="post-create-edit"]', { visible: true })
    const preview = await waitForImageDimensions('[data-testid="post-create-edit"] img')
    assert.equal(preview.mime, 'image/jpeg', `${testCase.label} export is not JPEG: ${preview.mime}`)
    const previewRatio = preview.width / preview.height
    const pixels = await inspectExportPixels(preview.src)
    assert.ok(pixels.nearBlack / pixels.total < 0.005, `${testCase.label} export contains unintended near-black pixels: ${pixels.nearBlack}/${pixels.total}`)
    assert.ok(pixels.orange > 0, `${testCase.label} export lost the central orange subject`)
    assert.ok(pixels.light > 0, `${testCase.label} export lost the light inner content`)

    assert.ok(Math.abs(previewRatio - testCase.ratio) < 0.01,
      `${testCase.label} Preview ratio mismatch: ${preview.width}x${preview.height} = ${previewRatio}`)

    await page.click('[data-testid="post-create-continue-details"]')
    await page.waitForSelector('[data-testid="post-create-details"]', { visible: true })

    const details = await waitForImageDimensions('[data-testid="post-create-details-preview"] img')
    assert.equal(details.mime, 'image/jpeg', `${testCase.label} Details preview is not the exported JPEG: ${details.mime}`)
    const detailsRatio = details.width / details.height

    assert.equal(details.width, preview.width, `${testCase.label} Details width differs from Preview`)
    assert.equal(details.height, preview.height, `${testCase.label} Details height differs from Preview`)
    assert.ok(Math.abs(detailsRatio - testCase.ratio) < 0.01,
      `${testCase.label} Details ratio mismatch: ${details.width}x${details.height} = ${detailsRatio}`)

    console.log(`PASS ${testCase.label}: ${preview.width}x${preview.height}; border/content pixel checks passed; Preview and Details match`)
  }

  console.log('PASS ImageAdjuster editor flow: Original, Square, Portrait and Wide, including pixel-level border/content checks')
} catch (error) {
  console.error(`FAIL ImageAdjuster editor flow: ${error instanceof Error ? error.stack || error.message : error}`)
  process.exitCode = 1
} finally {
  await fs.rm(fixture, { force: true }).catch(() => {})
  await browser.close()
}
