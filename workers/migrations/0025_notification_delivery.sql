-- FCM delivery log — one row per device attempt (success or failure).
-- Supports: delivery/error auditing, duplicate suppression via request_key,
-- and GC of old rows by the cron sweep.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  user_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data_json TEXT,
  ok INTEGER NOT NULL,
  status TEXT,
  error TEXT,
  request_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user
  ON notification_deliveries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created
  ON notification_deliveries(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_request_key
  ON notification_deliveries(request_key);

-- Sent-marker for at-most-once delivery per (user, logical event).
-- The fan-out checks this before sending a keyed notification.
CREATE TABLE IF NOT EXISTS notification_sent_keys (
  request_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_key, user_id)
);
