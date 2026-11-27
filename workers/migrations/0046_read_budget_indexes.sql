-- D1 read-budget indexes (Nov 2026 incident).
--
-- The */10 cron sweep deletes old rows from several tables, but those deletes
-- filtered on a bare timestamp had no usable index. SQLite therefore scanned
-- the whole table every ten minutes: ~1% of the daily 5M row-read allowance,
-- spent on cleanup that usually deletes nothing.
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_read_created
  ON notifications(read_at) WHERE read_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_sent_keys_created
  ON notification_sent_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_devices_disabled
  ON notification_devices(updated_at) WHERE enabled = 0;
CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_created
  ON media_upload_attempts(created_at);
