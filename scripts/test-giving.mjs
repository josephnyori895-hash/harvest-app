import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const giving = await readFile(new URL('../workers/src/routes/giving.js', import.meta.url), 'utf8')
const api = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
const giveUi = await readFile(new URL('../src/components/Give.tsx', import.meta.url), 'utf8')
const givingDefaults = await readFile(new URL('../src/lib/givingDefaults.ts', import.meta.url), 'utf8')

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
  assert.match(giving, /status='completed' AND completed_at=\?/, 'contribution is gated on the transition that just committed')
})

test('provider callback, contribution and audit row commit atomically', () => {
  const callbackStart = giving.indexOf("path === '/api/giving/mpesa/callback'")
  const callbackEnd = giving.indexOf("return null", callbackStart)
  const callback = giving.slice(callbackStart, callbackEnd)
  assert.match(callback, /await batch\(env, statements\)/, 'callback writes one D1 batch')
  assert.match(callback, /'giving\.completed'/, 'provider completion lands in audit_log')
  assert.match(callback, /'giving\.failed'/, 'provider failure lands in audit_log')
})

test('admin totals expose completed_kes, pending_kes and pending_count', () => {
  assert.match(giving, /SUM\(CASE WHEN g\.status='pending' THEN g\.amount_kes ELSE 0 END\) AS pending_kes/)
  assert.match(giving, /pending_kes: Number\(totals\.rows\[0\]\?\.pending_kes \|\| 0\)/)
  assert.match(api, /pending_kes:number/)
})

test('admin ledger totals respect the same filters as the rows', () => {
  const totalsAt = giving.indexOf('AS completed_kes')
  const totalsBlock = giving.slice(totalsAt, totalsAt + 900)
  assert.match(totalsBlock, /FROM giving_transactions g/)
  assert.match(totalsBlock, /\$\{filters\.clause\}/, 'totals reuse the ledger WHERE clause')
  assert.match(totalsBlock, /filters\.params/)
})

test('Give screen shows a whole-KES pending amount in the ledger (not just a count)', () => {
  assert.match(giveUi, /KES \{Number\(adminData\?\.totals\?\.pending_kes\|\|0\)\.toLocaleString\(\)/)
  assert.match(giveUi, /awaiting M-Pesa/)
})

test('RS-105: STK polling survives past 120 s and re-checks when the tab returns', () => {
  assert.doesNotMatch(giveUi, /setTimeout\(\(\) => setPollingId\(null\), 120_000\)/, 'the fixed 120 s cut-off must be gone')
  assert.match(giveUi, /document\.addEventListener\('visibilitychange', onVisible\)/)
  assert.match(giveUi, /if \(tx && tx\.status !== 'pending'\)/)
  assert.match(giveUi, /Date\.now\(\) - startedAt < 60_000 \? 4000 : 15_000/, 'poll backs off instead of stopping')
})

test('project cards are campaign cards with real deadline language', () => {
  assert.match(giveUi, /data-testid="project-card"/)
  assert.match(giveUi, /function deadlineLabel\(value: any\): string/)
  assert.match(giveUi, /days left/, 'deadlines read as a countdown')
  assert.match(giveUi, /Take part <Icon name="arrow-right"/, 'one clear action per card')
  // A past deadline must never render as a relative "Just now" timestamp.
  assert.doesNotMatch(giveUi, /Deadline \{timeAgo\(p\.deadline\)\}/)
})

test('the Ministry giving purpose is HYP and keeps its stable id', () => {
  // Members see "HYP"; the stored purpose id stays 'ministry' so existing
  // payment configs and transaction history are not orphaned.
  assert.match(givingDefaults, /\{ id: 'ministry', label: 'HYP'/, 'HYP must be the member-facing label')
  assert.match(givingDefaults, /f\.id === 'ministry' && label\.trim\(\)\.toLowerCase\(\) === 'ministry' \? 'HYP' : label/, 'already-saved lists must migrate on read')
  assert.doesNotMatch(givingDefaults, /\{ id: 'ministry', label: 'Ministry'/, 'the old label must be gone')
})

test('RS-106: a failed giving-history load is surfaced with a retry', () => {
  assert.doesNotMatch(giveUi, /fetchMyGiving\(\)\.then\(setTransactions\)\.catch\(\(\) => \{\}\)/, 'silent swallow must be gone')
  assert.match(giveUi, /setHistoryError\(e instanceof Error \? e\.message/)
  assert.match(giveUi, /Could not load your giving history\./)
  assert.match(giveUi, /onClick=\{\(\) => void loadMyGiving\(\)\}/)
})

test('RS-107: a double-tap on the M-Pesa button cannot fire two STK pushes', () => {
  // busy only disables after the re-render; the synchronous ref guard is what
  // actually stops the second tap inside the same commit.
  assert.match(giveUi, /const payingRef = useRef\(false\)/)
  assert.match(giveUi, /if \(payingRef\.current\) return/, 're-entry guard runs before validation')
  assert.match(giveUi, /setBusy\(true\); setMessage\(''\); payingRef\.current = true/)
  assert.match(giveUi, /finally \{ setBusy\(false\); payingRef\.current = false \}/)
})

test('RS-107: the server refuses a second STK push while one is pending', () => {
  // The client ref guard cannot cover a retry, a second device, or a tap after
  // the busy re-render — M-Pesa has no idempotency on this call, so the worker
  // must not open a second prompt for the same member, phone and amount.
  const givingRoute = readFileSync(new URL('../workers/src/routes/giving.js', import.meta.url), 'utf8')
  assert.match(givingRoute, /const DUPLICATE_WINDOW_SECONDS = 90/)
  assert.match(givingRoute, /WHERE user_id=\? AND status='pending' AND provider='mpesa' AND phone=\? AND amount_kes=\? AND created_at > \?/)
  assert.match(givingRoute, /An M-Pesa prompt for this gift is already on its way/)
  // The check must run before a transaction id exists and before the provider call.
  const checkAt = givingRoute.indexOf("status='pending' AND provider='mpesa'")
  const insertAt = givingRoute.indexOf('INSERT INTO giving_transactions')
  assert.ok(checkAt > 0 && checkAt < insertAt, 'duplicate check precedes the insert')
})
