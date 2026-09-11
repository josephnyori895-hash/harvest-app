import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(new URL('../src/components/AccountSwitcher.tsx', import.meta.url), 'utf8')

const expectSource = (pattern, message) => {
  assert.match(source, pattern, message)
}

test('admin controls expose server-backed Edit profile action', () => {
  expectSource(/Edit profile/, 'Edit profile control is missing')
  expectSource(//api\/admin\/users\/\$\{encodeURIComponent\(u\.username\)\}/, 'Admin user endpoint is missing')
  expectSource(/method:'PATCH'/, 'Edit/profile updates must use PATCH')
  expectSource(/name:\(document\.getElementById\('admin-name'\)/, 'Edit form does not submit the name field')
  expectSource(/phone:\(document\.getElementById\('admin-phone'\)/, 'Edit form does not submit the phone field')
  expectSource(/constituency:\(document\.getElementById\('admin-constituency'\)/, 'Edit form does not submit constituency')
})

test('Edit action has loading and error handling', () => {
  expectSource(/const \[busy,setBusy\]=useState\(false\)/, 'Busy state is missing')
  expectSource(/disabled=\{busy\} onClick=\{\(\)=>void updateUser\(edit/, 'Save profile is not disabled while busy')
  expectSource(/\{busy\?'Saving…':'Save profile'\}/, 'Save loading label is missing')
  expectSource(/setError\(e\.message\)/, 'Request errors are not surfaced')
  expectSource(/Changes are saved on the server and audited/, 'Edit confirmation/audit messaging is missing')
})

test('Deactivate, Restore, and Delete require confirmation', () => {
  expectSource(/window\.confirm\(prompt\)/, 'Lifecycle actions do not require confirmation')
  expectSource(/Deactivate @\$\{u\.username\}\?/, 'Deactivate confirmation text is missing')
  expectSource(/Restore @\$\{u\.username\} and allow them to sign in again\?/, 'Restore confirmation text is missing')
  expectSource(/Permanently delete @\$\{u\.username\}\? This cannot be undone\./, 'Delete confirmation text is missing')
  expectSource(/\/deactivate/, 'Deactivate endpoint is missing')
  expectSource(/\/restore/, 'Restore endpoint is missing')
  expectSource(/method=action==='delete'\?'DELETE':'POST'/, 'Lifecycle HTTP methods are incorrect')
})

test('Lifecycle actions have loading, success, and error states', () => {
  expectSource(/setBusy\(true\);setMessage\(''\);setError\(''\)/, 'Lifecycle busy state is not initialized')
  expectSource(/finally\{setBusy\(false\)\}/, 'Lifecycle busy state is not cleared')
  expectSource(/setMessage\(action==='delete'\?`@\$\{u\.username\} permanently deleted`:/, 'Lifecycle success message is missing')
  expectSource(/await loadAudit\(\)/, 'Lifecycle changes do not refresh audit log')
  expectSource(/\{error&&<div[^>]*>\{error\}<\/div>\}/, 'Lifecycle error state is not rendered')
})

test('Audit Log loads from the protected admin endpoint and renders entries', () => {
  expectSource(/const \[audit,setAudit\]=useState<any\[\]>\(\[\]\)/, 'Audit state is missing')
  expectSource(/\/api\/admin\/audit\?limit=100/, 'Audit endpoint is missing')
  expectSource(/setAudit\(d\.audit\|\|\[\]\)/, 'Audit response is not stored')
  expectSource(/\['users','moderation','giving','audit'\]/, 'Audit tab is missing')
  expectSource(/tab==='audit'/, 'Audit panel is missing')
  expectSource(/x\.action.*x\.target_type/, 'Audit entries do not render action/target information')
})

test('Admin self-protection prevents Allan from lifecycle-editing himself', () => {
  expectSource(/u\.username===username/, 'Self-protection check is missing')
  expectSource(/disabled=\{busy\|\|u\.username===username\} onClick=\{\(\)=>void lifecycle\(u,'deactivate'\)\}/, 'Self-deactivate must be disabled')
  expectSource(/disabled=\{busy\|\|u\.username===username\} onClick=\{\(\)=>void lifecycle\(u,'delete'\)\}/, 'Self-delete must be disabled')
})

console.log('Admin control source-contract tests passed.')
