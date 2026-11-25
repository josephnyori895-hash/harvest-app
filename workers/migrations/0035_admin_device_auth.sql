-- Single-admin device security.
--
-- The church has one system administrator. That account may be signed in on
-- exactly one phone (the Capacitor app) and one browser. A new browser is only
-- approved after a 6-digit code is pushed to the bound phone. Approving a new
-- browser bumps admin_web_epoch, which immediately invalidates tokens issued to
-- the previous browser (the token carries the epoch it was minted with).

ALTER TABLE users ADD COLUMN admin_web_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN admin_mobile_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('mobile','web')),
  device_id     TEXT NOT NULL,
  label         TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (user_id, kind),
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_devices_user_kind
  ON admin_devices (user_id, kind);

CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  device_kind   TEXT NOT NULL CHECK (device_kind IN ('mobile','web')),
  label         TEXT,
  code_hash     TEXT NOT NULL,
  ip            TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  used          INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_challenges_user
  ON admin_login_challenges (user_id, created_at DESC);

-- One administrator only: HFC Nyeri / harvest_nyeri. Any other admin account is
-- demoted here so it cannot be used to bypass the single-admin device rules.
UPDATE users SET role = 'member', verified = 0
 WHERE role = 'admin' AND username <> 'harvest_nyeri';

UPDATE users SET role = 'admin', verified = 1
 WHERE username = 'harvest_nyeri';
