import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const giving = await readFile(new URL('../workers/src/routes/giving.js', import.meta.url), 'utf8')
const api = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
const giveUi = await readFile(new URL('../src/components/Give.tsx', import.meta.url), 'utf8')

test('M-Pesa STK push enforces whole-shilling amounts and bounds', () => {
  assert.match(giving, /!Number\.isFinite\(amount\) \|\| !Number\.isInteger\(amount\) \|\| amount < 1 \|\| amount > 1000000/)
  assert.match(giving, /!phone\) return errorResponse\('valid Kenyan M-Pesa phone number required/)
})

test('STK push refuses gifts to disabled or manual-only purposes', () => {
  assert.match(giving, /if \(config\?\.enabled === false\) return errorResponse\('This giving purpose is temporarily unavailable'/)
  assert.match(giving, /if \(config\?\.method && config\.method !== 'stk'\) return errorResponse\('This purpose uses manual payment instructions/)
})

test('callback credits a contribution ONLY on a verified pending->completed transition', () => {
  assert.match(giving, /UPDATE giving_transactions SET status='completed', receipt_number=\?, provider_result_code=\?, provider_result_description=\?, metadata=\?, completed_at=\? WHERE id=\? AND status='pending'/)
  assert.match(giving, /INSERT OR IGNORE INTO project_contributions/)
})

test('admin totals expose completed_kes, pending_kes and pending_count', () => {
  assert.match(giving, /SUM\(CASE WHEN status='pending' THEN amount_kes ELSE 0 END\) AS pending_kes/)
  assert.match(giving, /pending_kes: Number\(totals\.rows\[0\]\?\.pending_kes \|\| 0\)/)
  assert.match(api, /pending_kes:number/)
})

test('Give screen shows a whole-KES pending amount in the ledger (not just a count)', () => {
  assert.match(giveUi, /KES \{Number\(adminData\?\.totals\?\.pending_kes\|\|0\)\.toLocaleString\(\)/)
  assert.match(giveUi, /awaiting M-Pesa/)
})
