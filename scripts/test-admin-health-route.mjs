// Behavioural test for the admin health endpoint: it runs the real handler with
// a small D1-shaped stub, so permission and check aggregation are exercised,
// not just matched in source.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleAdminHealth } from '../workers/src/routes/adminHealth.js'

function fakeDb(overrides = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this },
        async all() {
          if (overrides.throwOn) throw new Error('database offline')
          if (/SELECT 1 AS ok/i.test(sql)) return { results: [{ ok: 1 }] }
          if (/FROM pending_queue/i.test(sql)) return { results: [{ n: overrides.pending ?? 2 }] }
          if (/last_error IS NOT NULL/i.test(sql)) return { results: [{ n: overrides.failedPublications ?? 0 }] }
          if (/scheduled_at <=/i.test(sql)) return { results: [{ n: overrides.duePublications ?? 1 }] }
          if (/FROM notification_deliveries/i.test(sql)) return { results: [{ n: overrides.failedPush ?? 0 }] }
          if (/FROM notification_devices/i.test(sql)) return { results: [{ n: overrides.devices ?? 3 }] }
          throw new Error(`unexpected health query: ${sql}`)
        },
      }
    },
  }
}

const request = (method = 'GET') => new Request('https://example.test/api/admin/health', { method })

test('admin health returns plain-language checks and links to the fixing workflow', async () => {
  const response = await handleAdminHealth(request(), { DB: fakeDb(), MEDIA: {} }, { user: { role: 'admin' } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.status, 'warning')
  assert.deepEqual(body.checks.map(c => c.id), ['database', 'media', 'approvals', 'publishing', 'notifications'])
  assert.equal(body.checks.find(c => c.id === 'approvals').action.tab, 'moderation')
  assert.equal(body.checks.find(c => c.id === 'publishing').action.tab, 'publishing')
  assert.match(body.checks.find(c => c.id === 'notifications').detail, /3 devices registered/)
})

test('admin health refuses non-admins and unsupported methods', async () => {
  const env = { DB: fakeDb(), MEDIA: {} }
  const member = await handleAdminHealth(request(), env, { user: { role: 'member' } })
  assert.equal(member.status, 403)

  const guest = await handleAdminHealth(request(), env, { user: null })
  assert.equal(guest.status, 403)

  const post = await handleAdminHealth(request('POST'), env, { user: { role: 'admin' } })
  assert.equal(post.status, 405)
})

test('health never turns an offline database into a fake all-clear', async () => {
  const response = await handleAdminHealth(request(), { DB: fakeDb({ throwOn: true }), MEDIA: null }, { user: { role: 'admin' } })
  const body = await response.json()
  assert.equal(body.status, 'error')
  assert.equal(body.checks.find(c => c.id === 'database').status, 'error')
  assert.equal(body.checks.find(c => c.id === 'media').status, 'error')
  assert.equal(body.checks.some(c => c.id === 'approvals'), false, 'database-derived checks must not pretend to succeed')
})

test('admin health ignores unrelated routes', async () => {
  const other = new Request('https://example.test/api/admin/audit')
  assert.equal(await handleAdminHealth(other, {}, { user: { role: 'admin' } }), null)
})
