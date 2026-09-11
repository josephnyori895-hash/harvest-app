import test from 'node:test'
import assert from 'node:assert/strict'
import { dmConversationKey, ownsDmConversation, validateString, isAllowedOrigin } from './socketSecurity.js'

test('DM conversation keys are canonical', () => {
  assert.equal(dmConversationKey('bob', 'alice'), dmConversationKey('alice', 'bob'))
})

test('DM ownership requires the authenticated user and peer', () => {
  const key = dmConversationKey('alice', 'bob')
  assert.equal(ownsDmConversation('alice', 'bob', key), true)
  assert.equal(ownsDmConversation('mallory', 'bob', key), false)
  assert.equal(ownsDmConversation('alice', 'alice', key), false)
})

test('string validation rejects wrong types, empty required values, and oversize values', () => {
  assert.equal(validateString('  hello  ', 10, true), 'hello')
  assert.equal(validateString('', 10, true), null)
  assert.equal(validateString('123456', 5, true), null)
  assert.equal(validateString(123, 10, true), null)
})

test('origin allowlisting rejects unknown browser origins', () => {
  assert.equal(isAllowedOrigin('https://harvestfamily.or.ke', ['https://harvestfamily.or.ke']), true)
  assert.equal(isAllowedOrigin('https://evil.example', ['https://harvestfamily.or.ke']), false)
})
