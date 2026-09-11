-- 004_production_roles.sql
-- Harvest has exactly three product states:
--   member, verified member (users.verified=true), admin.
-- Verified is never a role.

-- Normalize legacy role values before tightening the constraint.
UPDATE users
SET role = 'member', verified = TRUE
WHERE role IN ('pastor', 'leader');

UPDATE users
SET role = 'member'
WHERE role = 'guest'
  AND id <> '00000000-0000-0000-0000-000000000000';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member','admin'));
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified) WHERE verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_role_verified ON users(role, verified);

-- Keep the guest identity outside the persisted product-role model. If a legacy
-- guest row exists, normalize it to member rather than retaining a third role.
UPDATE users
SET role = 'member'
WHERE role = 'guest';
