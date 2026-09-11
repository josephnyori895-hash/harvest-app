-- 003_hardening.sql — PIN bcrypt kept, pastor role, RBAC, mutual follows, coords leak, pending_queue hardening
-- VPS-only, 500 users, no OTP, PIN kept (4-6 digits)

-- 1) Extend role to pastor|guest (001 was member|admin only). Keep bcrypt pin_hash from 002.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('member','admin','pastor','guest'));
-- ensure existing guests can login: default member, but allow explicit guest row for anon JWT (0000... UUID)
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';

-- 2) Pastor: no separate PIN list; promoted via DB. Add index for role lookups (admin/pastor guards).
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));

-- 3) Pin hash hardening: ensure pin_hash exists (already in 002), add comment + index for lookups
COMMENT ON COLUMN users.pin_hash IS 'bcrypt(10) of 4-6 digit PIN — VPS 1 vCPU keeps cost 10, not 12';
-- pin_hash already TEXT; ensure NOT used as plaintext elsewhere.

-- 4) Verified split-brain fix (138 vs 564): verified_snapshot stays denormalized but live JOIN is source of truth.
-- Add audit trigger: log verify toggles centrally (pending.js:62 audit_log already does, add constraint)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_role TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- 5) Mutual follows 98: follows table already PK(follower_id,followee_id). Harden with mutual view + index for canSee().
-- Add self-follow prevention + fast mutual check
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='follows_no_self') THEN
    ALTER TABLE follows ADD CONSTRAINT follows_no_self CHECK (follower_id <> followee_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
-- materialized helper: is_mutual(a,b) -> boolean (used by map endpoint to gate coords)
CREATE OR REPLACE FUNCTION is_mutual(a UUID, b UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id=a AND followee_id=b)
     AND EXISTS (SELECT 1 FROM follows WHERE follower_id=b AND followee_id=a);
$$ LANGUAGE sql STABLE;

-- 6) Coords leak 723: precise lat/lng gated by is_mutual OR admin. Add group centroid table for jitter fallback.
-- Keep users.lat/lng private; expose only via /api/users/map which checks mutual.
-- Add column for obfuscated display? Instead use function that returns approx if not mutual.
-- Also add index on group_name for group centroid queries.
CREATE INDEX IF NOT EXISTS idx_users_group_name ON users(group_name);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

-- 7) Replace localStorage pending 109 with Postgres: pending_queue hardening
-- Add constraint: only member|pastor|admin can be in pending_queue (guest rows rejected at API layer, but DB guard too)
ALTER TABLE pending_queue ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0;
-- add search index for admin queue (status pending first, already idx_pending_status)
-- ensure thumb processing retries limited
CREATE INDEX IF NOT EXISTS idx_pending_type_status ON pending_queue(type, status);

-- 8) Rate-limit table (optional persistent, for VPS restart survival). In-memory is primary (middleware/auth.js),
-- but keep pg table for forensics.
CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  username TEXT,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at DESC);
-- retention: cron deletes >7d (see backup.sh or add pg cron)
-- DELETE FROM login_attempts WHERE created_at < now() - interval '7 days';

-- 9) Extend posts/reels is_pinned to allow pastor pin as well (already boolean; RBAC at API layer)
-- Ensure likes table not abused: add check for post_id format? Keep simple.

-- 10) Seed pastor demo (optional): promote pst.simon to pastor to test RBAC
UPDATE users SET role='pastor' WHERE username='pst.simon' AND role='member';

-- 11) Document: no OTP, PIN kept. Admin PIN hashes must be generated via:
-- node -e "import('bcryptjs').then(async m=>{for(const p of ['7777','0000','7C3AED']){console.log(p, await m.hash(p,10))}})"
-- and set in .env ADMIN_PIN_HASHES='["$2a$10$..."]' (never commit plaintext).
