-- Persist social reactions per member instead of browser-local state.
CREATE TABLE IF NOT EXISTS post_likes (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'post' CHECK (scope IN ('post','reel')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, scope, post_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_target ON post_likes (scope, post_id);
