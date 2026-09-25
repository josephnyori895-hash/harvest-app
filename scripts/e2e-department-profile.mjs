#!/usr/bin/env node

import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/$/, '')
const apiUrl = (process.env.E2E_API_URL || baseUrl).replace(/\/$/, '')
const username = process.env.E2E_USERNAME || ''
const pin = process.env.E2E_PIN || ''
const chromePath = process.env.E2E_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ''

if (!baseUrl || !username || !pin || !chromePath) {
  console.log('E2E department/profile test skipped: set E2E_BASE_URL, E2E_USERNAME, E2E_PIN and E2E_CHROME_PATH.')
  process.exit(0)
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
page.setDefaultTimeout(15000)

async function api(path) {
  return page.evaluate(async ({ apiUrl, path }) => {
    const token = localStorage.getItem('harvest_token') || ''
    const response = await fetch(apiUrl + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const raw = await response.text()
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch {}
    return { status: response.status, body, raw }
  }, { apiUrl, path })
}

async function clickByAria(label) {
  const clicked = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').toLowerCase() === wanted.toLowerCase())
    if (!button) return false
    button.click()
    return true
  }, label)
  assert.ok(clicked, `Could not find button with aria-label "${label}"`)
}

async function clickButtonByText(text) {
  const clicked = await page.evaluate((wanted) => {
    const needle = wanted.toLowerCase()
    const button = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().toLowerCase().includes(needle))
    if (!button) return false
    button.click()
    return true
  }, text)
  assert.ok(clicked, `Could not find button containing "${text}"`)
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2' })

  const login = await page.evaluate(async ({ apiUrl, username, pin }) => {
    const response = await fetch(apiUrl + '/api/auth/login', {
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
    return { status: response.status, body: { ok: true } }
  }, { apiUrl, username, pin })
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.body)}`)

  await page.reload({ waitUntil: 'networkidle2' })

  const departments = await api('/api/departments')
  assert.equal(departments.status, 200, `departments load failed: ${departments.raw}`)
  const candidates = departments.body.departments || []
  assert.ok(candidates.length > 0, 'No departments are available for the profile E2E test')

  let expected = null
  for (const dep of candidates) {
    const detail = await api(`/api/departments/${encodeURIComponent(dep.slug)}`)
    if (detail.status !== 200) continue
    const members = detail.body.members || []
    const member = members.find(m => m.id && m.username)
    if (member) {
      expected = { department: detail.body.department, member }
      break
    }
  }
  assert.ok(expected, 'No department with a canonical member record was available')

  // Navigate through the real app: bottom navigation -> Chat -> Departments.
  await clickByAria('Open chat')
  await page.waitForFunction(() => document.body.innerText.includes('Departments'))
  await clickButtonByText('departments')

  await page.waitForFunction(() => document.body.innerText.includes('Explore departments'))

  // Find the matching department card by its visible name and open its detail.
  const openedDetail = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h1,h2,p')].find(el => (el.textContent || '').trim() === name)
    const card = heading?.closest('.group')
    const button = card?.querySelector('button')
    if (!button) return false
    button.click()
    return true
  }, expected.department.name)
  assert.ok(openedDetail, `Could not open department "${expected.department.name}"`)

  await page.waitForFunction(() => document.querySelector('.department-detail-screen') !== null)
  await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label^="Open "]')].length > 0)

  const memberOpened = await page.evaluate((memberUsername) => {
    const target = [...document.querySelectorAll('button[aria-label^="Open "]')]
      .find(b => (b.textContent || '').includes('@' + memberUsername))
    if (!target) return false
    target.click()
    return true
  }, expected.member.username)
  assert.ok(memberOpened, `Could not tap member @${expected.member.username}`)

  await page.waitForFunction(() => Boolean(document.querySelector('[data-profile-user-id]')))

  const actual = await page.evaluate(() => {
    const root = document.querySelector('[data-profile-user-id]')
    if (!root) return null
    return {
      id: root.getAttribute('data-profile-user-id'),
      username: root.getAttribute('data-profile-username'),
      name: root.getAttribute('data-profile-name'),
      congregation: root.getAttribute('data-profile-congregation'),
      verified: root.getAttribute('data-profile-verified'),
      role: root.getAttribute('data-profile-role'),
      bodyText: document.body.innerText,
    }
  })

  assert.ok(actual, 'Harvest profile did not open')
  assert.equal(actual.id, String(expected.member.id), 'Profile user ID does not match the department member record')
  assert.equal(actual.username, String(expected.member.username), 'Profile username does not match the department member record')
  assert.equal(actual.name, String(expected.member.name || expected.member.username), 'Profile name does not match the department member record')
  assert.equal(actual.congregation, String(expected.member.group_name || ''), 'Profile congregation does not match the department member record')
  assert.equal(actual.verified, expected.member.verified ? 'true' : 'false', 'Profile verification status does not match the department member record')
  assert.equal(actual.role, String(expected.member.role || 'member'), 'Profile role does not match the department member record')

  assert.ok(actual.bodyText.includes(`@${expected.member.username}`), 'Profile does not visibly show the username')
  assert.ok(actual.bodyText.includes(expected.member.name || expected.member.username), 'Profile does not visibly show the name')
  if (expected.member.group_name) assert.ok(actual.bodyText.includes(expected.member.group_name), 'Profile does not visibly show the congregation')
  assert.ok(actual.bodyText.includes(expected.member.role === 'leader' ? 'Leader' : expected.member.verified ? 'Verified' : 'Member'), 'Profile does not visibly show the role/verification state')

  console.log(`PASS Departments member profile E2E: ${expected.member.username} / ${expected.member.id}`)
} catch (error) {
  console.error(`FAIL Departments member profile E2E: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
