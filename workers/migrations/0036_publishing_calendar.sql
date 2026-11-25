-- Central publishing calendar.
--
-- A publication is the schedule/draft record. It does not replace content:
-- announcements and feed posts still become `posts`, sermons become `sermons`,
-- banners are applied to `site_content`, and events / ministry updates have
-- their own canonical tables. `target_id` is generated once so retries insert
-- the same row instead of publishing duplicates.

CREATE TABLE IF NOT EXISTS content_publications (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('announcement','sermon','banner','event','ministry_update','feed_post')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','expired','canceled')),
  payload TEXT NOT NULL,
  scheduled_at TEXT,
  expires_at TEXT,
  published_at TEXT,
  expired_at TEXT,
  canceled_at TEXT,
  target_id TEXT NOT NULL,
  source_key TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_publications_status_time ON content_publications(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_publications_calendar ON content_publications(scheduled_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publications_target ON content_publications(content_type, target_id);

CREATE TABLE IF NOT EXISTS content_publication_history (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  at TEXT NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_publication_history ON content_publication_history(publication_id, at);

-- Canonical event records. There was no event system before this, so the
-- calendar publishes into this table rather than inventing a parallel one.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  publication_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);

-- Ministry updates belong to an existing department slug.
CREATE TABLE IF NOT EXISTS ministry_updates (
  id TEXT PRIMARY KEY,
  department_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  publication_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ministry_updates_department ON ministry_updates(department_slug, created_at DESC);

-- Expiry is a visibility rule on the canonical records too, not just a calendar
-- label. Scheduled rows are not created until publication, but published rows
-- may expire later.
ALTER TABLE posts ADD COLUMN expires_at TEXT;
ALTER TABLE sermons ADD COLUMN expires_at TEXT;
