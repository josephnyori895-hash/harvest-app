-- Phase 2 D1 read-budget work (docs/D1-READ-BUDGET.md).
--
-- The inbox used to scan every message row of every conversation on each poll
-- to build the last-message preview and the unread count. These tables make the
-- same poll read one summary row per conversation plus only the messages newer
-- than the viewer's read cursor.

CREATE TABLE IF NOT EXISTS chat_threads (
  conversation_key TEXT PRIMARY KEY,
  last_message_id TEXT,
  last_at TEXT NOT NULL,
  last_text TEXT,
  last_from TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_last_at ON chat_threads(last_at DESC);

CREATE TABLE IF NOT EXISTS chat_read_cursors (
  user_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, conversation_key)
);

-- Backfill one summary row per existing conversation so previews stay correct
-- the moment the new inbox query goes live.
INSERT OR REPLACE INTO chat_threads (conversation_key, last_message_id, last_at, last_text, last_from)
SELECT conversation_key, id, created_at, body, sender_username
  FROM (
    SELECT conversation_key, id, created_at, body, sender_username,
           ROW_NUMBER() OVER (PARTITION BY conversation_key ORDER BY created_at DESC, id DESC) AS rn
      FROM messages
  )
 WHERE rn = 1;

-- Backfill cursors from the per-message read marks so unread badges do not
-- regress for members who had already read their conversations.
INSERT OR IGNORE INTO chat_read_cursors (user_id, conversation_key, last_read_at)
SELECT mr.user_id, m.conversation_key, MAX(m.created_at)
  FROM message_reads mr
  JOIN messages m ON m.id = mr.message_id
 GROUP BY mr.user_id, m.conversation_key;
