// Pins the canonical avatar-initials rule (src/lib/initials.ts) by EXECUTING it:
// the module is type-stripped in-memory and the real function runs, so the
// divergent cases the four former copies disagreed on stay pinned.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'lib', 'initials.ts'), 'utf8')

// node --test cannot import TS directly; strip the two type annotations and run.
const js = source.replace(/: string/g, '').replace('export function initials', 'function initials')
const initials = new Function(`${js}; return initials`)()

test('the rule comment stays — it is the contract the four copies collapsed into', () => {
  assert.match(source, /Mary-Jane.*MJ/)
  assert.match(source, /"@nyorii"/)
  assert.match(source, /empty never renders blank|""\s+->\s+"\?"/)
})

test('hyphens split — the divergent case', () => {
  assert.equal(initials('Mary-Jane'), 'MJ')
})

test('leading handle stripped', () => {
  assert.equal(initials('@nyorii'), 'NY')
})

test('dots split', () => {
  assert.equal(initials('a.b.you'), 'AB')
})

test('single word takes two characters', () => {
  assert.equal(initials('Solo'), 'SO')
})

test('empty string never renders blank', () => {
  assert.equal(initials(''), '?')
  assert.equal(initials('   '), '?')
})

test('more than two words keeps only the first two initials', () => {
  assert.equal(initials('Grace Wanjiru Kamau'), 'GW')
})
