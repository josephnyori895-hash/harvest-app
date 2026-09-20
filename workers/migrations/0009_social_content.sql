-- Social content extensions: editable captions, attached worship tracks, story replies.
ALTER TABLE posts ADD COLUMN music_track_id TEXT;
ALTER TABLE reels ADD COLUMN music_track_id TEXT;
ALTER TABLE stories ADD COLUMN caption TEXT;
ALTER TABLE stories ADD COLUMN music_track_id TEXT;

CREATE TABLE IF NOT EXISTS story_replies (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_story_replies_story_created ON story_replies(story_id, created_at ASC);
