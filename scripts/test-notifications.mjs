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
  assert.match(app, /setNotifications\(prev => \[\.\.\.rows, \.\.\.prev\]\)/)
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
