-- Comment upgrades: likes + one-level replies (Instagram-parity interactions).
-- No FK constraints — deletion is explicit in the API so like counts always
-- stay consistent on D1 where foreign_keys toggling differs per context.

ALTER TABLE post_comments ADD COLUMN parent_id TEXT;

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON post_comments (parent_id) WHERE parent_id IS NOT NULL;
