import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const notif = await readFile(new URL('../src/components/NotificationsScreen.jsx', import.meta.url), 'utf8')
const lib = await readFile(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8')

test('family activity is normalized into notification rows by the lib', () => {
  assert.match(lib, /export async function fetchFamilyActivity/)
  assert.match(lib, /category: 'family'/)
  assert.match(lib, /type: 'member_joined'/)
  assert.match(lib, /type: 'followed_you'/)
  assert.match(lib, /type: 'you_followed'/)
})

test('App merges family activity into the single notifications inbox', () => {
  assert.match(app, /fetchFamilyActivity\(\)/)
  // Merged by id — the 60s poll must not stack duplicate activity rows.
  assert.match(app, /seen\.has\(String\(n\.id\)\)/)
  assert.match(app, /\[\.\.\.withLocalRead\(fam\)\.filter\(n => !seen\.has\(String\(n\.id\)\)\), \.\.\.prev\]/)
})

test('family-activity reads are recorded on the device, not POSTed as unknown ids', () => {
  // These rows are derived client-side, so the server has no record to mark.
  // Posting them 404'd, rolled back the optimistic read, and let the poll put
  // the unread badge straight back.
  assert.match(app, /const ACTIVITY_READ_KEY = 'harvest:activity-read'/)
  assert.match(app, /if \(isLocalNotification\(notificationId\)\)/)
  assert.match(app, /saveActivityRead\(read\)/)
  assert.match(app, /withLocalRead\(fam\)/)
})

test('Inbox press routing opens the member profile from family activity rows', () => {
  assert.match(app, /notification\.type === 'member_joined' \|\| notification\.type === 'followed_you' \|\| notification\.type === 'you_followed/)
  assert.match(app, /openProfile\(\{ username: String\(actor\.username\)/)
})

test('Inbox exposes a Family filter and maps family rows to it', () => {
  assert.match(notif, /id: 'family', label: 'Family/)
  assert.match(notif, /member_joined.*followed_you.*you_followed/)
})

test('Activity screen is merged away — single notifications surface remains', () => {
  assert.doesNotMatch(app, /tab === 'activity' && <Activity \/>/)
  assert.doesNotMatch(app, /function Activity\(\)/)
})

test('the profile activity entrance opens that same surface, not a second screen', () => {
  // Audit item F keeps activity one tap from Profile; both entrances must land
  // on the one inbox, with activity rows pre-filtered.
  assert.match(app, /onOpenActivity=\{\(\) => \{ setNotificationFilter\('family'\); setShowNotifications\(true\)/)
  assert.match(app, /activityRows|withLocalRead\(rows\)\.filter/, 'family activity rides the notification list')
})

test('the inbox retry actually refreshes — a dead button is a silent failure', () => {
  assert.doesNotMatch(app, /onRetry=\{\(\) => \{\}\}/)
  assert.match(app, /onRetry=\{\(\) => \{ void refreshNotifications\(\) \}\}/)
})
