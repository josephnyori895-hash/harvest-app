CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reads_user_message
  ON message_reads(user_id, message_id);
