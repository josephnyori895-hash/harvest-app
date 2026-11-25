-- Ministries can be hidden from the member-facing ministry directory while
-- keeping their records, leaders and chat intact. Existing ministries stay
-- visible, so this migration changes no current behaviour.
ALTER TABLE departments ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_departments_public ON departments(is_public);
