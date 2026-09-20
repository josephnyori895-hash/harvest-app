#!/usr/bin/env node

import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/$/, '')
const apiUrl = (process.env.E2E_API_URL || baseUrl).replace(/\/$/, '')
const username = process.env.E2E_USERNAME || ''
const pin = process.env.E2E_PIN || ''
const requestedSlug = process.env.E2E_GROUP_SLUG || ''
const chromePath = process.env.E2E_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ''

if (!baseUrl || !username || !pin || !chromePath) {
  console.log('E2E group/chat test skipped: set E2E_BASE_URL, E2E_USERNAME, E2E_PIN and E2E_CHROME_PATH.')
  process.exit(0)
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
page.setDefaultTimeout(15000)

async function api(path, options = {}) {
  return page.evaluate(async ({ apiUrl, path, options }) => {
    const token = localStorage.getItem('harvest_token') || ''
    const headers = new Headers(options.headers || {})
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers })
    const raw = await response.text()
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch {}
    return { status: response.status, body, raw }
  }, { apiUrl, path, options })
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2' })

  // Authenticate through the same browser storage used by the React frontend.
  const login = await page.evaluate(async ({ apiUrl, username, pin }) => {
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
    return { status: response.status, body: { ok: true } }
  }, { apiUrl, username, pin })
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.body)}`)
  assert.equal(login.body.ok, true)

  // Reload so the real React application boots with the authenticated token.
  await page.reload({ waitUntil: 'networkidle2' })

  const groupsResponse = await api('/api/groups')
  assert.equal(groupsResponse.status, 200, `groups load failed: ${groupsResponse.raw}`)
  const groups = groupsResponse.body.groups || []
  const group = requestedSlug
    ? groups.find(g => g.slug === requestedSlug)
    : groups.find(g => g.is_group_admin)
  assert.ok(group, 'No suitable group found. Set E2E_GROUP_SLUG to a group where the test user is an admin.')
  assert.ok(group.is_group_admin, `test user is not an admin of group ${group.slug}`)

  // 1) Frontend transport can load the exact group settings used by Groups.tsx.
  const detail = await api(`/api/groups/${encodeURIComponent(group.slug)}`)
  assert.equal(detail.status, 200, `group settings load failed: ${detail.raw}`)
  const settings = detail.body.group
  for (const key of [
    'allow_member_edit_info',
    'allow_member_send',
    'allow_member_add',
    'allow_member_invite',
    'approve_new_members',
    'send_message_history',
  ]) assert.ok(Object.prototype.hasOwnProperty.call(settings, key), `missing group setting: ${key}`)

  // 2) Update one permission and restore it immediately. This exercises the same
  // PATCH contract used by the Groups settings UI without leaving test changes behind.
  const originalHistory = Boolean(settings.send_message_history)
  const update = await api(`/api/groups/${encodeURIComponent(group.slug)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: settings.name,
      description: settings.description || '',
      community: settings.community || '',
      invite_only: Boolean(settings.invite_only),
      allow_member_edit_info: Boolean(settings.allow_member_edit_info),
      allow_member_send: settings.allow_member_send !== 0,
      allow_member_add: Boolean(settings.allow_member_add),
      allow_member_invite: Boolean(settings.allow_member_invite),
      approve_new_members: settings.approve_new_members !== 0,
      send_message_history: !originalHistory,
    }),
  })
  assert.equal(update.status, 200, `group settings update failed: ${update.raw}`)
  assert.equal(Boolean(update.body.group?.send_message_history), !originalHistory)

  const restore = await api(`/api/groups/${encodeURIComponent(group.slug)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: settings.name,
      description: settings.description || '',
      community: settings.community || '',
      invite_only: Boolean(settings.invite_only),
      allow_member_edit_info: Boolean(settings.allow_member_edit_info),
      allow_member_send: settings.allow_member_send !== 0,
      allow_member_add: Boolean(settings.allow_member_add),
      allow_member_invite: Boolean(settings.allow_member_invite),
      approve_new_members: settings.approve_new_members !== 0,
      send_message_history: originalHistory,
    }),
  })
  assert.equal(restore.status, 200, `group settings restore failed: ${restore.raw}`)

  // 3) The frontend's chat transport can load the conversation.
  const history = await api(`/api/chat/history?group=${encodeURIComponent(group.slug)}&limit=5`)
  assert.equal(history.status, 200, `chat history failed: ${history.raw}`)
  assert.equal(history.body.conversation_key, `group:${group.slug}`)

  // 4) Send a real message through the same endpoint used by Chat.tsx.
  const marker = `E2E frontend/backend ${new Date().toISOString()}`
  const sent = await api('/api/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ group: group.slug, body: marker }),
  })
  assert.equal(sent.status, 201, `message send failed: ${sent.raw}`)
  assert.equal(sent.body.message?.text, marker)
  assert.equal(sent.body.message?.conversation_key, `group:${group.slug}`)

  // 5) Poll the backend exactly like Chat.tsx and verify the message comes back.
  const after = new Date(Date.now() - 5000).toISOString()
  const updates = await api(`/api/chat/updates?group=${encodeURIComponent(group.slug)}&after=${encodeURIComponent(after)}&limit=50`)
  assert.equal(updates.status, 200, `chat updates failed: ${updates.raw}`)
  assert.ok((updates.body.messages || []).some(m => m.id === sent.body.message.id && m.text === marker), 'sent message was not returned by chat updates')

  console.log(`PASS group/frontend-backend E2E: ${group.slug}`)
} catch (error) {
  console.error(`FAIL group/frontend-backend E2E: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
