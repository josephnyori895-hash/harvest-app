-- Persist member-saved Reels across devices.
CREATE TABLE IF NOT EXISTS reel_saves (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, reel_id)
);
CREATE INDEX IF NOT EXISTS idx_reel_saves_user_created ON reel_saves(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_saves_reel ON reel_saves(reel_id);
