// Giving administration contract — manual records, corrections and the audit
// trail that keeps financial history intact. Payments stay manual: no test here
// expects an STK push to be sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const giving = await readFile(new URL('../workers/src/routes/giving.js', import.meta.url), 'utf8')
const projects = await readFile(new URL('../workers/src/routes/projects.js', import.meta.url), 'utf8')
const content = await readFile(new URL('../workers/src/routes/content.js', import.meta.url), 'utf8')
const give = await readFile(new URL('../src/components/Give.tsx', import.meta.url), 'utf8')
const fundsEditor = await readFile(new URL('../src/components/GivingFundsEditor.tsx', import.meta.url), 'utf8')
const migration = await readFile(new URL('../workers/migrations/0034_giving_admin_audit.sql', import.meta.url), 'utf8')

test('every manual-record and correction entry point is admin-gated on the server', () => {
  // One requireAdmin per mutating route; the UI role check is never the gate.
  assert.match(giving, /if \(path === '\/api\/giving\/transactions' && method === 'POST'\) \{\n    const fresh = await requireAdmin\(env, user\)/)
  assert.match(giving, /if \(correction && method === 'PATCH'\) \{\n    const fresh = await requireAdmin\(env, user\)/)
  assert.match(giving, /auditMatch && method === 'GET'\) \{\n    await requireAdmin\(env, user\)/)
  assert.match(giving, /path === '\/api\/giving\/admin' && method === 'GET'\) \{\n    await requireAdmin\(env, user\)/)
  assert.match(giving, /export\.csv' && method === 'GET'\) \{\n    await requireAdmin\(env, user\)/)
  assert.doesNotMatch(giving, /giving\/transactions[^\n]*requireMember/, 'recording money must never be a member action')
})

test('a correction requires a reason and snapshots the previous row before it changes', () => {
  assert.match(giving, /reason\.length < 4/)
  assert.match(giving, /reason is required so the correction can be audited/)
  assert.match(giving, /const before = found\.rows\[0\]/)
  assert.match(giving, /auditStatement\(\n\s+env, fresh, id, 'correct',/)
  assert.match(giving, /await batch\(env, \[/, 'gift, contribution and audit commit in one D1 batch')
  assert.match(giving, /before_json/, 'the previous values are stored, not overwritten away')
  assert.match(migration, /before_json TEXT/)
  assert.match(migration, /actor_username TEXT NOT NULL/)
})

test('manual gifts are provider=manual, complete, and attributable to the treasurer', () => {
  assert.match(giving, /'manual',\?,\?,\?,\?,\?,\?,\?\)/)
  assert.match(giving, /recorded_by\)/)
  assert.match(giving, /recordedBy: fresh\.username/)
  assert.match(giving, /MANUAL_METHODS = \['paybill', 'till', 'bank', 'cash', 'mpesa'\]/)
  assert.match(giving, /auditStatement\(env, fresh, id, 'record'/)
})

test('manual amounts are whole shillings in a bounded range, dates cannot be in the future', () => {
  assert.match(giving, /Number\.isInteger\(n\) && n > 0 && n <= 10_000_000/)
  assert.match(giving, /if \(raw\.slice\(0, 10\) > new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\) return null/)
  assert.match(giving, /phone must be a valid Kenyan number/)
})

test('project totals are recomputed from a corrected gift, never left stale', () => {
  assert.match(giving, /function contributionStatements\(env, tx\)/)
  assert.match(giving, /DELETE FROM project_contributions WHERE giving_transaction_id=\?/)
  assert.match(giving, /INSERT OR IGNORE INTO project_contributions\(id,project_id,user_id,giving_transaction_id,amount_kes\)/)
  assert.match(giving, /contributionStatements\(env, (saved|after)\)/, 'contribution rows are rebuilt in the same transaction as the gift')
})

test('a funded project cannot be deleted, so raised totals survive', () => {
  assert.match(projects, /project_contributions WHERE project_id=\?\) AS contributions/)
  assert.match(projects, /has giving records and cannot be deleted/)
  assert.match(projects, /409,/)
})

test('ledger filters are validated and both list and CSV share them', () => {
  assert.match(giving, /function ledgerFilters\(url\)/)
  assert.match(giving, /invalid status filter/)
  assert.match(giving, /from must be YYYY-MM-DD/)
  assert.match(giving, /export\.csv/)
  assert.match(giving, /Content-Disposition/)
  assert.match(giving, /function csvCell\(value\)/, 'a comma or quote in a purpose cannot break the CSV')
})

test('the member-facing Paybill block never invents a destination', () => {
  assert.doesNotMatch(give, /4138895/, 'the old hardcoded Paybill is gone')
  assert.doesNotMatch(give, /PAYBILL_FALLBACK/)
  assert.match(give, /ask the church office/)
  assert.match(give, /content\.paybill_number/)
})

test('treasurer tools are in the Give admin tab: record, correct, filter, export', () => {
  assert.match(give, /recordManualGiving\(/)
  assert.match(give, /correctGivingTransaction\(/)
  assert.match(give, /downloadGivingCsv\(/)
  assert.match(give, /Correct this record/)
  assert.match(give, /the original entry and reason are in the audit trail/)
  assert.match(give, /This writes a completed entry to the ledger\. It does not send or request any M-Pesa payment\./)
})

test('admins can reorder giving purposes and every purpose can be disabled', () => {
  assert.match(fundsEditor, /const move = \(index: number, delta: number\)/)
  assert.match(fundsEditor, /aria-label={`Move \$\{f\.label\} up`}/)
  assert.match(fundsEditor, /aria-label={`Move \$\{f\.label\} down`}/)
  assert.match(give, /Members can give to this purpose/)
  assert.match(content, /cfg\.enabled !== undefined && typeof cfg\.enabled !== 'boolean'/)
  assert.match(content, /Paybill\/Till number is required/)
  assert.match(content, /bank name, account name and account number are required/)
})
