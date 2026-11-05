// \"No silence\" is a product rule, not a style preference. If a member or admin
// taps something, the app must say what happened — success or the real error.
// These guards fail CI when a failure path is swallowed again.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const feedback = await readFile(new URL('../src/lib/actionFeedback.ts', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const admin = await readFile(new URL('../src/components/Admin.tsx', import.meta.url), 'utf8')
const give = await readFile(new URL('../src/components/Give.tsx', import.meta.url), 'utf8')
const music = await readFile(new URL('../src/components/Music.tsx', import.meta.url), 'utf8')

test('one shared action-outcome helper reports success and readable errors', () => {
  assert.match(feedback, /export function describeError\(/)
  assert.match(feedback, /export async function runAction<T>\(/)
  assert.match(feedback, /showToast\(successMessage \|\| `\$\{label\} — done`, 'success'\)/)
  assert.match(feedback, /return \{ ok: false, error: new Error\(describeError\(e\)\) \}/)
})

test('the app catches unhandled promise rejections and runtime errors out loud', () => {
  assert.match(app, /window\.addEventListener\('unhandledrejection', onRejection\)/)
  assert.match(app, /window\.addEventListener\('error', onError\)/)
  assert.match(app, /Something went wrong — \$\{text\}/)
  assert.match(app, /Something went wrong — \$\{e\.message\}/)
})

test('admin saves go through runAction and errors/confirmations toast', () => {
  assert.match(admin, /await runAction\('Saving changes'/)
  assert.match(admin, /useEffect\(\(\) => \{ if \(error\) showToast\(error, 'error', 6000\) \}, \[error\]\)/)
  assert.match(admin, /useEffect\(\(\) => \{ if \(notice\) showToast\(notice, 'success'\) \}, \[notice\]\)/)
  // A failed save must surface the server's own message, not a generic one.
  assert.match(admin, /setError\(res\.error\?\.message \|\| 'Could not save'\)/)
})

test('money and worship failures are announced, not swallowed', () => {
  assert.match(give, /if \(historyError\) showToast\(historyError, 'error', 6000\)/)
  assert.doesNotMatch(give, /fetchMyGiving\(\)\s*\.then\(setTransactions\)\s*\.catch\(\(\) => \{\}\)/)
  assert.match(music, /if \(libraryError\) showToast\(libraryError, 'error', 6000\)/)
  assert.match(music, /setLibraryError\(e\?\.message \|\| 'Could not load the church library/)
  assert.match(music, /Couldn’t load the church library/)
  assert.match(music, />Try again</)
  // The old silent library load must be gone from the component.
  assert.doesNotMatch(music, /fetchMusic\(\)\s*\n?\s*\.then\(r => \{ if \(!cancelled\) setServerTracks\(mapServer\(r\.tracks as any\[\]\)\) \}\)\s*\n?\s*\.catch\(\(\) => \{\}\)/)
})

test('the signup group select never displays a choice the state does not hold', () => {
  // Waydroid device pass: an empty group select with no empty option rendered
  // the first congregation as visually selected while form.group_name stayed
  // '', so 'Create my account' refused with "Choose your Harvest Group" the
  // member could not satisfy — the display was a lie. The placeholder keeps
  // display == state, and the validator gate stays pinned.
  assert.match(app, /Choose your congregation…/, 'honest placeholder sits first when nothing is chosen')
  assert.match(app, /if \(!form\.group_name\) \{/, 'the validator still refuses an unchosen group')
  assert.match(app, /value=\{form\.group_name\}/)
})
