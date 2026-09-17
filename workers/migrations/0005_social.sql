-- Instagram-style social layer: comments, story views, rich chat messages.
-- SQLite ALTER TABLE ADD COLUMN is used for messages (existing rows keep NULLs).

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,            -- posts.id or reels.id (prefixed by kind client-side scope)
  scope TEXT NOT NULL DEFAULT 'post' CHECK (scope IN ('post','reel')),
  user_id TEXT,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (scope, post_id, created_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_username TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (story_id, viewer_username)
);
CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views (story_id);

ALTER TABLE messages ADD COLUMN reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN reply_preview TEXT;
ALTER TABLE messages ADD COLUMN media_key TEXT;
ALTER TABLE messages ADD COLUMN media_type TEXT;
ALTER TABLE messages ADD COLUMN reaction TEXT;
