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
const viewUser = await readFile(new URL('../src/components/ViewUser.tsx', import.meta.url), 'utf8')
const chat = await readFile(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const boundary = await readFile(new URL('../src/components/ErrorBoundary.tsx', import.meta.url), 'utf8')
const api = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
const uploads = await readFile(new URL('../src/lib/backgroundUploads.ts', import.meta.url), 'utf8')
const groups = await readFile(new URL('../src/components/Groups.tsx', import.meta.url), 'utf8')
const departments = await readFile(new URL('../src/components/Departments.tsx', import.meta.url), 'utf8')
const sermons = await readFile(new URL('../src/components/Sermons.tsx', import.meta.url), 'utf8')
const search = await readFile(new URL('../src/components/Search.tsx', import.meta.url), 'utf8')
const session = await readFile(new URL('../src/lib/session.ts', import.meta.url), 'utf8')
const adminMedia = await readFile(new URL('../src/components/AdminMedia.tsx', import.meta.url), 'utf8')
const realtime = await readFile(new URL('../src/lib/realtime.ts', import.meta.url), 'utf8')
const activity = await readFile(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8')
const congregations = await readFile(new URL('../src/lib/useCongregations.ts', import.meta.url), 'utf8')

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

test('a profile or hub outage never renders as "empty"', () => {
  // A failed feed used to call setLoaded(true) with no error, so the Posts
  // grid said "No posts yet" when the request had simply not arrived.
  assert.match(viewUser, /const \[feedError, setFeedError\] = useState\(''\)/)
  assert.match(viewUser, /We couldn’t load this profile’s posts/)
  assert.match(viewUser, /setReloadKey\(k => k \+ 1\)/, 'the failed feed offers a retry')
  assert.match(viewUser, /showToast\(describeError\(e, 'Could not update follow/, 'a follow tap that changed nothing says why')
  // The community hub's two silent catches made "0 spaces" look like a fact.
  assert.match(chat, /const \[hubError, setHubError\] = useState\(''\)/)
  assert.match(chat, /setHubError\(failed > 0 && out.length === 0/)
})

test('money screens never show a zero ledger or no projects during an outage', () => {
  assert.match(give, /const \[adminError, setAdminError\] = useState\(''\)/)
  assert.match(give, /setAdminError\(describeError\(e, 'Could not load the giving ledger'\)\)/)
  assert.match(give, /setProjectsError\(describeError\(e, 'Could not load giving projects'\)\)/)
  assert.match(give, /!adminError && <div className="grid grid-cols-2 gap-3"/, 'the zero totals are hidden while the ledger is unknown')
})

test('removing a saved post restores it when the server refuses', () => {
  assert.match(app, /Could not remove this saved post/)
  assert.match(app, /list\.some\(x => x\.id === sp\.id\) \? list : \[sp, \.\.\.list\]/, 'optimistic removal is rolled back')
})

test('the crash screen is branded, honest, and keeps the stack out of the way', () => {
  assert.match(boundary, /Technical details/)
  assert.match(boundary, /Your account, posts and media are safe on the church server/)
  assert.doesNotMatch(boundary, /bg-stone-50|text-stone-500/, 'legacy palette gone from the crash screen')
})

test('read paths retry a transient failure instead of showing an error screen', () => {
  assert.match(api, /export async function apiGet<T = any>/)
  assert.match(api, /retries: 1/, 'the shared GET helper retries once')
  assert.match(api, /e\.retryable = r\.status >= 500 \|\| r\.status === 429/, '5xx/429 are classified retryable')
  assert.match(api, /You appear to be offline/)
  assert.match(api, /if \(error instanceof TypeError\) throw transient/, 'a dropped connection gets a readable sentence')
  for (const [name, file] of [['Groups', groups], ['Departments', departments], ['Sermons', sermons], ['Search', search], ['profile', viewUser]]) {
    assert.match(file, /apiGet/, `${name} loads through the retrying helper`)
  }
})

test('an upload can never hang in "uploading" forever', () => {
  assert.match(uploads, /const STALL_MS = 90_000/)
  assert.match(uploads, /xhr\.onabort = \(\) =>/, 'an aborted transfer settles instead of spinning')
  assert.match(uploads, /upload stalled/, 'the retry reason names the stall')
  assert.match(uploads, /if \(e\?\.name === 'AbortError'\) throw new Error\('server did not respond — timed out'\)/, 'presign/confirm cannot hang the queue')
  assert.match(uploads, /stall\|cancel\|did not respond/, 'stalls are queued for retry')
  assert.match(chat, /window\.setTimeout\(\(\) => controller\.abort\(\), 20_000\)/, 'chat requests time out')
})

test('no request can wait forever — every path is bounded', () => {
  // The global fetch guard bounds API calls, admin mutations, external search
  // and anything else that is not a binary upload.
  assert.match(session, /const REQUEST_TIMEOUT_MS = 30_000/)
  assert.match(session, /body instanceof FormData \|\| body instanceof Blob/, 'uploads keep their own longer deadline')
  assert.match(session, /alreadyBounded = Boolean\(init\?\.signal/, 'a caller-provided signal is not overridden')
  assert.match(session, /The church server took too long to respond/)
  assert.match(adminMedia, /async function timedFetch/)
  assert.match(adminMedia, /Upload timed out/)
  assert.match(admin, /apiGet<any>\('\/api\/pending\?status=pending'\)/, 'the dashboard loader is bounded and retried')
  // Realtime history is REST (bounded by apiGet/chat); the socket itself must
  // not leave a send waiting on an ack that never arrives.
  assert.match(realtime, /expire stale acks after 15s/)
  assert.match(realtime, /ack\(\{ error: 'ack timeout' \}\)/)
  assert.match(activity, /apiGet<any>\('\/api\/activity'\)/)
  assert.match(congregations, /apiGet<any>\('\/api\/groups'\)/)
  // Direct presign+upload paths (photos, posters, covers) now time out and
  // retry once, and keep the server's own refusal text.
  assert.match(api, /async function uploadOnce/)
  assert.match(api, /Upload timed out/)
  assert.match(api, /Could not reach media storage/)
})

test('the signup group select never displays a choice the state does not hold', () => {
  // Waydroid device pass: an empty group select with no empty option rendered
  // the first congregation as visually selected while form.group_name stayed
  // '', so 'Create my account' refused with "Choose your Harvest Group" the
  // member could not satisfy — the display was a lie. The placeholder keeps
  // display == state, and the validator gate stays pinned.
  assert.match(app, /Choose your congregation…/, 'honest placeholder sits first when nothing is chosen')
  assert.match(app, /if \(!f\.group_name\)/, 'the validator still refuses an unchosen group')
  assert.match(app, /value=\{form\.group_name\}/)
})
