-- Teachings can be discussed like a post: comments gain a 'sermon' scope and
-- sermons carry their own comment counter.
--
-- post_comments.scope was created with CHECK (scope IN ('post','reel')) and
-- SQLite cannot alter a CHECK, so the table is rebuilt with the wider
-- constraint while every existing row and index is carried across.

CREATE TABLE IF NOT EXISTS post_comments_new (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'post' CHECK (scope IN ('post','reel','sermon')),
  user_id TEXT,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  parent_id TEXT
);

INSERT INTO post_comments_new (id, post_id, scope, user_id, username, body, created_at, parent_id)
  SELECT id, post_id, scope, user_id, username, body, created_at, parent_id FROM post_comments;

DROP TABLE post_comments;

ALTER TABLE post_comments_new RENAME TO post_comments;

CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments (scope, post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON post_comments (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE sermons ADD COLUMN comments INTEGER NOT NULL DEFAULT 0;
