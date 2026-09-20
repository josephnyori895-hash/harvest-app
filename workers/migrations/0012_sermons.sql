-- Sermons: audio (mp3) and video (mp4) uploads by admins, streamed in-app and
-- downloadable by members. kind distinguishes audio/video; plays/downloads are
-- simple counters incremented by dedicated endpoints.
CREATE TABLE IF NOT EXISTS sermons (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  speaker TEXT,
  scripture TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'audio' CHECK (kind IN ('audio','video')),
  media_key TEXT NOT NULL,
  cover_key TEXT,
  duration_secs INTEGER,
  bytes INTEGER,
  plays INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sermons_created ON sermons(created_at DESC);
