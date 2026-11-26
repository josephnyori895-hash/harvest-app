-- Three admin devices: the bound phone plus up to two approved browsers.
-- The original table allowed only one row per (user, kind), so a second browser
-- could only be added by deleting the first. Keep every approved device instead
-- and cap the browser count in code (MAX_WEB_DEVICES = 2).
CREATE TABLE IF NOT EXISTS admin_devices_next (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('mobile','web')),
  device_id     TEXT NOT NULL,
  label         TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (user_id, kind, device_id),
  UNIQUE (user_id, device_id)
);

INSERT OR IGNORE INTO admin_devices_next (id, user_id, kind, device_id, label, created_at, last_seen_at)
  SELECT id, user_id, kind, device_id, label, created_at, last_seen_at FROM admin_devices;

DROP TABLE admin_devices;
ALTER TABLE admin_devices_next RENAME TO admin_devices;

CREATE INDEX IF NOT EXISTS idx_admin_devices_user_kind
  ON admin_devices (user_id, kind, last_seen_at);
