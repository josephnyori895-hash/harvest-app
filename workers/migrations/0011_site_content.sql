-- Admin-editable home-screen content (hero banner + weekly encouragement).
-- Key-value: admin sets values via PUT /api/content; GET is public so the
-- home feed needs no auth round-trip to render.
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT
);

-- Seed with the current hardcoded defaults so nothing changes visually.
INSERT INTO site_content (key, value) VALUES
  ('hero_kicker', 'Karibu, family'),
  ('hero_title', 'Compel. Raise. Release.'),
  ('hero_subtitle', 'Get one saved, keep one saved, get another saved.')
ON CONFLICT(key) DO NOTHING;

INSERT INTO site_content (key, value) VALUES
  ('verse_text', 'Let us consider how we may spur one another on toward love and good deeds.'),
  ('verse_ref', 'Hebrews 10:24 · Grow together')
ON CONFLICT(key) DO NOTHING;
