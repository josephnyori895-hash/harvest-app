// The admin account runs the church app. If a future change quietly narrows
// what it can edit or reach, this fails CI rather than showing up as "the app
// feels like a toy" three releases later.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const content = await readFile(new URL('../workers/src/routes/content.js', import.meta.url), 'utf8')
const admin = await readFile(new URL('../src/components/Admin.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('the content whitelist covers church identity and page copy, not just the banner', () => {
  for (const key of ['church_name', 'church_tagline', 'service_times', 'church_address', 'church_phone', 'church_email', 'sermons_title', 'music_title', 'community_rules', 'announcement_banner']) {
    assert.match(content, new RegExp(`\\b${key}:\\s*\\d+`), `${key} must be editable by the admin`)
  }
})

test('custom copy keys are allowed without a deploy', () => {
  assert.match(content, /const CUSTOM_KEY = \/\^\(copy\|app\)_\[a-z0-9_\]\{1,40\}\$\//)
  assert.match(content, /const limitFor = \(key\) =>/)
  assert.match(content, /entries\.length > 40/, 'a single save can publish every edited key')
})

test('the API tells the admin UI exactly what may be edited', () => {
  assert.match(content, /return jsonResponse\(\{ content: out, editable: EDITABLE, customLimit: CUSTOM_LIMIT \}/)
})

test('the Admin screen edits every key in one place and saves them together', () => {
  assert.match(admin, /'content'/, 'Everything tab is part of the tab set')
  assert.match(admin, /data-testid="admin-content"/)
  assert.match(admin, /data-testid="admin-content-save"/)
  assert.match(admin, /const payload: Record<string, string> = \{ \.\.\.content, \.\.\.\(contentDraft \|\| \{\}\) \}/)
  assert.match(admin, /copy_new_heading/, 'admins can add a new key on the spot')
})

test('admin can reach every church surface from its own screen', () => {
  for (const label of ['Members', 'Approvals', 'Groups', 'Departments', 'Sermons', 'Worship', 'Giving', 'All text']) {
    assert.match(admin, new RegExp(`\\['${label}',`), `${label} shortcut missing`)
  }
  assert.match(app, /<Admin[\s\S]*onOpenMusic=\{\(\) => setTab\('music'\)\}/)
  assert.match(app, /<Admin[\s\S]*onOpenGive=\{\(\) => setTab\('give'\)\}/)
})
