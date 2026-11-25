// Guardrails for the admin account controls. The control centre is a wall of
// inline actions (role, congregation, verification, grants, PIN reset, active
// state, delete), so these are source-contract tests: we pin the request shape,
// the busy guard that stops double-submits, the error surfacing, and the
// self-protection rules the server enforces behind the disabled controls.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [admin, users] = await Promise.all([
  read('src/components/Admin.tsx'),
  read('workers/src/routes/users.js'),
])

test('every member control goes through one PATCH helper with an encoded username', () => {
  assert.match(admin, /const patchUser = async \(username: string, body: Record<string, any>\)/, 'the shared PATCH helper is missing')
  assert.match(admin, /`\$\{API\}\/api\/admin\/users\/\$\{encodeURIComponent\(username\)\}`/, 'member updates must hit the admin users route')
  assert.match(admin, /method: 'PATCH'/, 'member updates must PATCH')
  assert.match(admin, /Authorization: `Bearer \$\{token\(\)\}`/, 'member updates must carry the admin token')
  assert.match(admin, /body: JSON\.stringify\(body\)/, 'member updates must send the patch as JSON')
})

test('one busy flag blocks double-submits and disables the row while saving', () => {
  assert.match(admin, /const patchUser = async[\s\S]{0,80}if \(busy\) return/, 'the helper must refuse while another write is in flight')
  assert.match(admin, /setBusy\(username\); setError\(''\)/, 'the row must enter its busy state and clear the last error')
  assert.match(admin, /finally \{ setBusy\(null\) \}/, 'the busy state must be released on every path')
  assert.match(admin, /disabled=\{busy === u\.username\}/, 'member controls must disable while saving')
  assert.match(admin, /busy === u\.username \? 'Saving…'/, 'the saving state must be visible')
})

test('admin access is fixed to the owner account, not a dropdown mistake', () => {
  assert.doesNotMatch(admin, /<option value="admin">Admin role/, 'a second admin cannot be created from members')
  assert.doesNotMatch(admin, /<option value="admin">Admin<\/option>/, 'a second admin cannot be created from the form')
  assert.match(admin, /u\.role === 'admin' \? 'Account owner' : 'Member'/, 'the row labels access clearly instead of offering a broken promotion')
  assert.match(admin, /New accounts join as members/, 'the create form explains the single-admin rule')
  assert.match(users, /before\.username === fresh\.username && role !== undefined && role !== 'admin'/, 'the server must refuse self-demotion')
  assert.match(users, /before\.username === fresh\.username && body\.active === false/, 'the server must refuse self-deactivation')
})

test('PIN resets and deletion happen inline, with no browser prompt/confirm', () => {
  assert.doesNotMatch(admin, /window\.prompt/, 'PIN reset must be a real field, not a developer prompt')
  assert.match(admin, /const \[pinResets, setPinResets\]/, 'PIN drafts live with the member row')
  assert.match(admin, /aria-label=\{`New PIN for \$\{u\.username\}`\}/, 'the inline PIN field is labelled')
  assert.match(admin, /const \[deleteConfirm, setDeleteConfirm\]/, 'delete is a two-step inline action')
  assert.match(admin, /Permanently delete @\{u\.username\}\?/, 'the confirmation names the member and consequence')
})

test('the last administrator cannot be removed', () => {
  assert.match(users, /countAdmins\(env, before\.id\)\) < 1/, 'the last-admin guard is missing')
  assert.match(users, /cannot remove the last active administrator/, 'the last-admin refusal must be explained')
})

test('failed writes surface the server message instead of failing silently', () => {
  assert.match(admin, /const data = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/, 'a non-JSON error body must not throw')
  assert.match(admin, /if \(!response\.ok\) throw new Error\(data\.error \|\| 'Update failed'\)/, 'the server reason must be surfaced')
  assert.match(admin, /setError\(e\?\.message \|\| 'Unable to update account'\)/, 'the catch must fall back to a readable message')
  assert.match(admin, /setError\(''\)/, 'a fresh attempt must clear the stale error')
})

test('the server validates every field the panel can send', () => {
  assert.match(users, /if \(role !== undefined && !ROLES\.has\(role\)\) return errorResponse\('role must be member or admin', 400\)/)
  assert.match(users, /if \(verified !== undefined && typeof verified !== 'boolean'\) return errorResponse\('verified must be boolean', 400\)/)
  assert.match(users, /if \(groupName !== undefined && groupName !== null && !await groupExists\(env, groupName\)\)/)
  assert.match(users, /if \(!Array\.isArray\(body\.grants\)\) return errorResponse\('grants must be an array', 400\)/, 'power grants must be validated')
  assert.match(users, /if \(!\/\^\\d\{4,6\}\$\/\.test\(pin\)\) return errorResponse\('PIN must be 4-6 digits', 400\)/, 'PIN resets must be validated')
  assert.match(users, /if \(!target\.rows\[0\]\) return errorResponse\('user not found', 404\)/, 'unknown members must 404, not 500')
})

test('a successful write re-syncs the row from the server response', () => {
  assert.match(admin, /const updated = data\.user/, 'the response user must drive the update')
  assert.match(admin, /setAccounts\(list => list\.map\(u => u\.username === username \? \{ \.\.\.u, \.\.\.updated \} : u\)\)/, 'the account list must adopt the server copy')
  assert.match(admin, /setUsers\(users\.map\(u => u\.username === username/, 'the dashboard counts must follow the update')
  assert.match(admin, /flash\(`\$\{username\} updated`\)/, 'the admin must get confirmation')
  assert.match(users, /await audit\(env, fresh, 'user_profile_update'/, 'every profile write must be audited')
})

test('no admin control is tested through a component the app does not mount', async () => {
  // The retired account switcher was never mounted, and only this test kept it
  // alive. The rule from here: a source-text test may not be the only thing
  // holding a file in the repo, and nothing may import a path that is gone.
  const retired = 'src/components/Account' + 'Switcher.tsx'
  await assert.rejects(readFile(new URL(`../${retired}`, import.meta.url), 'utf8'), 'the retired switcher must stay deleted')
  assert.doesNotMatch(admin, new RegExp(retired.split('/').pop()), 'the panel must not reach for the retired switcher')

  const scripts = await readdir(new URL('../scripts/', import.meta.url))
  for (const name of scripts.filter(n => n.endsWith('.mjs'))) {
    const src = await read(`scripts/${name}`)
    assert.ok(!src.includes(retired), `${name} still reads the retired switcher`)
    assert.doesNotMatch(src, /import\.meta\.env/, `${name} relies on Vite-only globals`)
  }
})

console.log('Admin account control contract tests passed.')
