#!/usr/bin/env node
// Emulated-width QA sweep for the notification bell + inbox (Android QA matrix
// rows 10.1–10.3, 11.1, 11.5). This is Chromium at phone widths — it is NOT a
// physical-device pass and must never be recorded as one: it cannot see real
// insets, the soft keyboard, or push delivery.
//
// Usage: start the worker (`wrangler dev --port 8787`) and vite with
// `E2E_API_TARGET=http://127.0.0.1:8787`, then
//   E2E_BASE_URL=http://127.0.0.1:5273 E2E_USERNAME=qa.member \
//   E2E_PASSWORD=qapassword123 E2E_CHROME_PATH=/usr/bin/chromium \
//   node scripts/qa-android-notifications.mjs
import puppeteer from 'puppeteer-core'

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:5273').replace(/\/$/, '')
const username = process.env.E2E_USERNAME || 'qa.member'
const password = process.env.E2E_PASSWORD || 'qapassword123'
const chromePath = process.env.E2E_CHROME_PATH || '/usr/bin/chromium'

const results = { viewports: [], markRead: {} }
const fail = []

function record(width, name, pass, detail) {
  results.viewports.push({ width, name, pass, detail })
  if (!pass) fail.push(`${width}px ${name}: ${JSON.stringify(detail)}`)
}

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

try {
  const login = await browser.newPage()
  await login.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const token = await login.evaluate(async ({ username, password }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const body = await r.json().catch(() => ({}))
    if (!body.token) throw new Error(`login failed: ${r.status}`)
    localStorage.setItem('harvest_token', body.token)
    localStorage.setItem('harvest_username', username)
    return body.token
  }, { username, password })
  if (!token) throw new Error('no token')
  await login.close()

  for (const width of [320, 360, 390]) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await page.evaluateOnNewDocument(({ token, username }) => {
      localStorage.setItem('harvest_token', token)
      localStorage.setItem('harvest_username', username)
    }, { token, username })
    await page.goto(baseUrl, { waitUntil: 'networkidle2' })
    await page.waitForSelector('button[aria-controls="notifications-drawer"]', { timeout: 20000 })

    // ── 10.1 bell + badge, and 11.1 no horizontal page overflow ──
    const home = await page.evaluate(() => {
      const bell = document.querySelector('button[aria-controls="notifications-drawer"]')
      const r = bell.getBoundingClientRect()
      // The bell also contains an aria-hidden icon span — pick the one that
      // actually holds a count.
      const badge = Array.from(bell.querySelectorAll('span[aria-hidden="true"]'))
        .find(s => /^\d+\+?$/.test(s.textContent.trim()))
      return {
        bell: { w: r.width, h: r.height, right: r.right, top: r.top },
        label: bell.getAttribute('aria-label'),
        expanded: bell.getAttribute('aria-expanded'),
        badgeText: badge?.textContent?.trim() || '',
        badgeHidden: badge?.getAttribute('aria-hidden') === 'true',
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    record(width, '10.1 bell is a ≥44px target with an unread badge', home.bell.w >= 44 && home.bell.h >= 44 && home.badgeHidden && home.badgeText !== '', home.bell)
    record(width, '11.5 bell has an accessible name and exposes expanded state', /Notifications/.test(home.label || '') && home.expanded === 'false', { label: home.label, expanded: home.expanded })
    record(width, '11.1 Home has no horizontal overflow', home.pageOverflow <= 0, { pageOverflow: home.pageOverflow })

    await page.click('button[aria-controls="notifications-drawer"]')
    await page.waitForSelector('#notifications-drawer', { timeout: 5000 })
    // Let the list settle: rows arrive from the server fetch and from the
    // local activity merge. Measuring or marking read mid-stream produces
    // meaningless counts (rows that land after the press are legitimately
    // unread, which looks like a mark-all bug when it is only a race in QA).
    // The directory (which feeds the local "joined the family" rows) lands a
    // few seconds after the server list, so give it time before sampling.
    await new Promise(r => setTimeout(r, 5000))
    let lastCount = -1
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 600))
      const count = await page.evaluate(() => document.querySelectorAll('#notifications-drawer [aria-label^="Unread"], #notifications-drawer [aria-label^="Read"]').length)
      if (count > 0 && count === lastCount) break
      lastCount = count
    }

    const drawer = await page.evaluate(() => {
      const el = document.getElementById('notifications-drawer')
      const r = el.getBoundingClientRect()
      const rows = Array.from(el.querySelectorAll('[aria-label^="Unread"], [aria-label^="Read"]'))
      const tabs = Array.from(el.querySelectorAll('[role="tab"]'))
      const headerButtons = Array.from(el.querySelectorAll('header button'))
      return {
        rect: { w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        overflow: el.scrollWidth - el.clientWidth,
        rows: rows.length,
        rowOverflow: rows.filter(row => row.scrollWidth - row.clientWidth > 1).map(row => row.getAttribute('aria-label')?.slice(0, 40)),
        tabLines: new Set(tabs.map(t => Math.round(t.getBoundingClientRect().top))).size,
        tabHeights: tabs.map(t => Math.round(t.getBoundingClientRect().height)),
        swallowedRows: rows.filter(row => row.getBoundingClientRect().height < 40).length,
        headerTargets: headerButtons.map(b => ({ label: b.getAttribute('aria-label'), h: Math.round(b.getBoundingClientRect().height) })),
        modal: el.getAttribute('aria-modal'),
        activeInside: el.contains(document.activeElement),
      }
    })
    record(width, '10.1 drawer is a floating card, not fullscreen', drawer.rect.h < drawer.viewport.h * 0.85 && drawer.rect.left > 0 && drawer.rect.right <= drawer.viewport.w, drawer.rect)
    record(width, '10.1 rows do not overflow at this width', drawer.overflow <= 0 && drawer.rowOverflow.length === 0 && drawer.rows > 0, { rows: drawer.rows, rowOverflow: drawer.rowOverflow, overflow: drawer.overflow })
    record(width, '10.2 filters stay on one line', drawer.tabLines === 1, { lines: drawer.tabLines })
    record(width, '11.5 filter and header controls are ≥40px and labelled', drawer.tabHeights.every(h => h >= 40) && drawer.headerTargets.every(t => t.h >= 40 && t.label), { tabHeights: drawer.tabHeights, headerTargets: drawer.headerTargets })
    record(width, 'the drawer takes focus on open and is marked modal', drawer.modal === 'true' && drawer.activeInside, { modal: drawer.modal, activeInside: drawer.activeInside })

    const markAllThere = await page.$('#notifications-drawer button[aria-label="Mark all notifications as read"]')
    if (width === 390 && markAllThere) {
      // ── 10.3 optimistic read with rollback on failure ──
      await page.setRequestInterception(true)
      let failReadAll = true
      page.on('request', req => {
        if (failReadAll && req.method() === 'POST' && req.url().includes('/api/notifications/read-all')) {
          // Fail the call a beat late: aborting in the same tick lets the
          // rollback land before the optimistic state can be sampled.
          setTimeout(() => req.abort().catch(() => {}), 500)
          return
        }
        return req.continue().catch(() => {})
      })
      const before = await page.evaluate(() => {
        const count = () => Array.from(document.querySelectorAll('#notifications-drawer [aria-label^="Unread"]')).length
        const bell = document.querySelector('button[aria-controls="notifications-drawer"]')
        return { unread: count(), badge: bell.getAttribute('aria-label') }
      })
      await page.click('#notifications-drawer button[aria-label="Mark all notifications as read"]')
      const optimistic = await page.evaluate(() => document.querySelectorAll('#notifications-drawer [aria-label^="Unread"]').length)
      await new Promise(r => setTimeout(r, 2500))
      const rolledBack = await page.evaluate(() => ({
        unread: document.querySelectorAll('#notifications-drawer [aria-label^="Unread"]').length,
        alert: !!document.querySelector('#notifications-drawer [role="alert"]'),
      }))
      results.markRead.rollback = { before: before.unread, optimistic, after: rolledBack.unread, alert: rolledBack.alert }
      if (optimistic !== 0 || rolledBack.unread !== before.unread || !rolledBack.alert) {
        fail.push(`10.3 rollback: optimistic=${optimistic} after=${rolledBack.unread} before=${before.unread} alert=${rolledBack.alert}`)
      }

      failReadAll = false
      await page.click('#notifications-drawer button[aria-label="Mark all notifications as read"]')
      await new Promise(r => setTimeout(r, 2500))
      const afterSuccess = await page.evaluate(() => ({
        unread: document.querySelectorAll('#notifications-drawer [aria-label^="Unread"]').length,
        markAllStillThere: !!document.querySelector('#notifications-drawer button[aria-label="Mark all notifications as read"]'),
      }))
      results.markRead.success = afterSuccess
      if (afterSuccess.unread !== 0 || afterSuccess.markAllStillThere) fail.push(`10.3 success: ${JSON.stringify(afterSuccess)}`)
    } else if (width === 390) {
      results.markRead.skipped = 'nothing unread — seed unread notifications before the run'
    }

    await page.close()
  }
  // ── 11.4 offline → retry → data returns ──
  const offline = await browser.newPage()
  await offline.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true })
  await offline.evaluateOnNewDocument(({ token, username }) => {
    localStorage.setItem('harvest_token', token)
    localStorage.setItem('harvest_username', username)
  }, { token, username })
  await offline.goto(baseUrl, { waitUntil: 'networkidle2' })
  await offline.waitForSelector('button[aria-controls="notifications-drawer"]')
  await offline.setOfflineMode(true)
  await offline.click('button[aria-controls="notifications-drawer"]')
  await offline.waitForSelector('#notifications-drawer [role="alert"]', { timeout: 8000 }).catch(() => {})
  const offlineState = await offline.evaluate(() => {
    const alert = document.querySelector('#notifications-drawer [role="alert"]')
    const retry = document.querySelector('#notifications-drawer [role="alert"] button')
    return { alert: alert?.textContent?.trim().slice(0, 60) || '', retry: retry?.textContent?.trim() || '' }
  })
  results.offline = offlineState
  if (!offlineState.alert || !offlineState.retry) fail.push(`11.4 offline: ${JSON.stringify(offlineState)}`)
  await offline.setOfflineMode(false)
  if (offlineState.retry) {
    await offline.click('#notifications-drawer [role="alert"] button')
    await new Promise(r => setTimeout(r, 3000))
    const recovered = await offline.evaluate(() => document.querySelectorAll('#notifications-drawer [aria-label^="Unread"], #notifications-drawer [aria-label^="Read"]').length)
    results.offlineRecovered = recovered
    if (!recovered) fail.push('11.4 recovery: retry after reconnect rendered no rows')
  }
  await offline.close()
} finally {
  await browser.close()
}

console.log(JSON.stringify({ results, failures: fail }, null, 2))
if (fail.length) process.exitCode = 1
