-- Admin account lifecycle controls.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- Allow an administrator to be deleted without losing the audit trail.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

-- Reviewed content must remain auditable even if the reviewing administrator is removed.
ALTER TABLE pending_queue DROP CONSTRAINT IF EXISTS pending_queue_reviewed_by_fkey;
ALTER TABLE pending_queue ADD CONSTRAINT pending_queue_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_deactivated_by_fkey;
ALTER TABLE users ADD CONSTRAINT users_deactivated_by_fkey
  FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL;
