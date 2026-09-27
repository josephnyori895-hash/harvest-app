import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

// Contract tests for the FCM delivery engine (lib/fcm.js) with a stubbed
// network layer and an in-memory D1 — no Firebase credentials or outbound
// calls, so this runs in CI exactly like the rest of the worker suite.

const { sendToDevice, sendFanOut, resolveRecipients, __setFcmFetch, __resetFcmFetch } = await import('../src/lib/fcm.js')

// A throwaway RSA key so the OAuth signer has something valid to sign with.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign'],
)
const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`
const SERVICE_ACCOUNT = JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: PRIVATE_KEY_PEM, project_id: 'test-project' })

// In-memory D1 stub covering the queries the fan-out path uses.
function makeEnv(over = {}) {
  const devices = new Map()   // fcm_token -> row
  const sentKeys = new Set()  // `${request_key}|${user_id}`
  const deliveries = []
  const run = async (sql, params = []) => {
    if (/INSERT OR IGNORE INTO notification_sent_keys/.test(sql)) {
      const key = `${params[0]}|${params[1]}`
      const fresh = !sentKeys.has(key)
      sentKeys.add(key)
      return { meta: { changes: fresh ? 1 : 0 } }
    }
    if (/INSERT INTO notification_deliveries/.test(sql)) {
      deliveries.push({ token: params[3], ok: params[8], status: params[9] })
      return { meta: { changes: 1 } }
    }
    if (/SELECT d\.id, d\.user_id/.test(sql)) {
      return { results: [...devices.values()].filter(d => params.includes(d.user_id) && d.enabled) }
    }
    if (/DELETE FROM notification_devices WHERE fcm_token IN/.test(sql)) {
      for (const t of params) devices.delete(t)
      return { results: [], meta: { changes: params.length } }
    }
    return { results: [], meta: {} }
  }
  const DB = {
    prepare: (sql) => {
      const obj = { sql, params: [], bind: (...p) => { obj.params = p; return obj }, all: () => run(obj.sql, obj.params) }
      return obj
    },
    batch: async (statements) => Promise.all(statements.map(s => run(s.sql, s.params))),
  }
  const env = { DB, FCM_ENABLED: '1', FCM_PROJECT_ID: 'test-project', FCM_SERVICE_ACCOUNT: SERVICE_ACCOUNT, ...over }
  return { env, devices, deliveries, sentKeys }
}

test('sendToDevice returns unconfigured when no service account is present', async () => {
  const { env } = makeEnv({ FCM_SERVICE_ACCOUNT: null })
  const res = await sendToDevice(env, 'tok', { notification: { title: 't', body: 'b' } })
  assert.equal(res.status, 'unconfigured')
  assert.equal(res.ok, false)
})

test('sendToDevice respects the FCM_ENABLED kill switch', async () => {
  const { env } = makeEnv({ FCM_ENABLED: '0' })
  const res = await sendToDevice(env, 'tok', { notification: { title: 't', body: 'b' } })
  assert.equal(res.status, 'disabled')
  assert.equal(res.ok, false)
})

test('fan-out sends, classifies permanent errors, removes dead tokens, logs everything, and dedupes by request key', async () => {
  const { env, devices, deliveries } = makeEnv()

  __setFcmFetch(async (url, init) => {
    if (url.includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) }
    }
    const token = JSON.parse(init.body).message.token
    if (token === 'dead') return { ok: false, status: 404, text: async () => JSON.stringify({ error: { status: 'UNREGISTERED' } }) }
    if (token === 'flaky') return { ok: false, status: 503, text: async () => 'backend error' }
    return { ok: true, status: 200, text: async () => '{}' }
  })

  devices.set('good', { id: 'd1', user_id: 'u1', fcm_token: 'good', platform: 'android', enabled: 1 })
  devices.set('dead', { id: 'd2', user_id: 'u2', fcm_token: 'dead', platform: 'android', enabled: 1 })
  devices.set('flaky', { id: 'd3', user_id: 'u3', fcm_token: 'flaky', platform: 'android', enabled: 1 })

  const summary = await sendFanOut(env, {
    recipients: ['u1', 'u2', 'u3'],
    title: 'Hello',
    body: 'World',
    data: { kind: 'chat', message_id: 'm1' },
    requestKey: 'chatmsg:m1',
  })
  assert.equal(summary.recipients, 3)
  assert.equal(summary.sent, 1)
  assert.equal(summary.invalid_tokens_removed, 1)
  assert.ok(!devices.has('dead'), 'dead token removed from devices')
  assert.ok(devices.has('flaky'), 'transient failure keeps the token for retry')
  assert.equal(deliveries.length, 3, 'every attempt is logged')

  // Replay of the same logical event (retry/double callback) claims nobody.
  const replay = await sendFanOut(env, { recipients: ['u1'], title: 'Hello', body: 'World', requestKey: 'chatmsg:m1' })
  assert.equal(replay.recipients, 0, 'duplicate request_key is dropped before sending')
  assert.equal(deliveries.length, 3, 'no duplicate delivery rows')

  __resetFcmFetch()
})

test('unconfigured deployment degrades to log-only instead of crashing', async () => {
  const { env, devices, deliveries } = makeEnv({ FCM_SERVICE_ACCOUNT: null, FCM_ENABLED: '0' })
  devices.set('good', { id: 'd1', user_id: 'u1', fcm_token: 'good', platform: 'android', enabled: 1 })
  const summary = await sendFanOut(env, { recipients: ['u1'], title: 'Hello', body: 'World' })
  assert.equal(summary.disabled, true)
  assert.equal(summary.sent, 0)
  assert.equal(deliveries.length, 1, 'attempt still logged with disabled status')
  assert.ok(devices.has('good'), 'nothing removed when disabled')
})

test('resolveRecipients is empty without ids', async () => {
  const { env } = makeEnv()
  assert.equal((await resolveRecipients(env, [])).length, 0)
  assert.equal((await resolveRecipients(env, [null, undefined, ''])).length, 0)
})

test.after?.(() => __resetFcmFetch())
