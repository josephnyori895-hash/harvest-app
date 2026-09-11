-- Harvest now has exactly three account types:
-- 1) normal member, 2) verified member (users.verified=true), 3) admin.
-- Verification is intentionally separate from role and never grants admin access.

UPDATE users
SET role = 'member', verified = TRUE
WHERE role = 'pastor';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member', 'admin'));

COMMENT ON COLUMN users.role IS 'Harvest authorization role: member or admin. Verified members remain role=member and use verified=true.';
COMMENT ON COLUMN users.verified IS 'Trusted Harvest member status; never grants admin privileges.';
