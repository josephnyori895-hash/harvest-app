-- Manual giving records and corrections.
--
-- Payments stay manual: a treasurer enters a gift they received (Paybill, Till,
-- bank, cash) and can later correct a typo. Corrections never overwrite the
-- audit trail — the original row is snapshotted into giving_transaction_audit
-- with the actor, timestamp and the reason the correction was made.

ALTER TABLE giving_transactions ADD COLUMN recorded_by TEXT;
ALTER TABLE giving_transactions ADD COLUMN corrected_at TEXT;
ALTER TABLE giving_transactions ADD COLUMN corrected_by TEXT;

CREATE TABLE IF NOT EXISTS giving_transaction_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES giving_transactions(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('record','correct')),
  before_json TEXT,
  after_json TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giving_tx_audit_transaction ON giving_transaction_audit(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_tx_audit_created ON giving_transaction_audit(created_at DESC);
