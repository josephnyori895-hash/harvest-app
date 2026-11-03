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
  // Saves publish the edited keys only. Sending the whole map used to exceed the
  // worker's 40-key cap, so every admin edit silently failed to land.
  assert.match(admin, /const changed = Object\.fromEntries\(Object\.entries\(draft\)\.filter\(\(\[k, v\]\) => String\(content\[k\] \?\? ''\) !== String\(v\)\)\)/)
  assert.match(admin, /body: JSON\.stringify\(changed\)/, 'saves send only the edited keys')
  assert.match(admin, /harvest:content-updated/, 'open screens repaint after a save')
  assert.match(admin, /copy_new_heading/, 'admins can add a new key on the spot')
})

test('admin can reach every church surface from its own screen', () => {
  // Grouped sections: People, Content, Community, System.
  for (const label of ['Overview', 'Approvals', 'Members', 'All text', 'Home text', 'Giving copy', 'Adverts', 'Chats', 'Announce', 'Audit']) {
    assert.match(admin, new RegExp(`'${label}'`), `${label} tab missing`)
  }
  // Member-facing screens with no admin tab get a direct row.
  for (const label of ['Groups', 'Departments', 'Sermons', 'Worship']) {
    assert.match(admin, new RegExp(`\\['${label}',`), `${label} shortcut missing`)
  }
  assert.match(app, /<Admin[\s\S]*onOpenMusic=\{\(\) => setTab\('music'\)\}/)
  assert.match(app, /<Admin[\s\S]*onOpenGive=\{\(\) => setTab\('give'\)\}/)
})
