-- FCM device registrations for push notifications.
-- Delivery (sending) lands in a later batch; this migration only stores devices.
-- One row per FCM token: Firebase issues one registration token per app
-- installation, so the unique index on fcm_token makes registration idempotent
-- and lets an account switch move a token to the newly signed-in user.
CREATE TABLE IF NOT EXISTS notification_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  fcm_token TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  app_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per token; registration upserts on this column.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_devices_fcm_token
  ON notification_devices(fcm_token);

-- Fan-out lookup: all enabled devices for a user.
CREATE INDEX IF NOT EXISTS idx_notification_devices_user
  ON notification_devices(user_id, enabled);

-- Installation lookup: unregister/reset paths.
CREATE INDEX IF NOT EXISTS idx_notification_devices_installation
  ON notification_devices(installation_id);
