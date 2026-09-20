-- Central admin audit trail. JSON metadata keeps the log extensible without exposing secrets.
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_username TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_id, created_at DESC);
