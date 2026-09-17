-- Departments (ministry teams): praise & worship, ushering, media, etc.
-- Members self-join; admins can assign/remove and set department leaders.

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS department_members (
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);

INSERT INTO departments (id, slug, name, description, created_at) VALUES
  ('dep_praise',    'praise-worship', 'Praise & Worship',   'Choir, instruments and worship leading', '2026-09-15T00:00:00.000Z'),
  ('dep_ushering',  'ushering',       'Ushering',           'Welcoming and seating the family', '2026-09-15T00:00:00.000Z'),
  ('dep_media',     'media',          'Media & Sound',      'Live stream, projection and sound', '2026-09-15T00:00:00.000Z'),
  ('dep_hospitality','hospitality',   'Hospitality',        'Refreshments and care for visitors', '2026-09-15T00:00:00.000Z'),
  ('dep_children',  'children',       'Children''s Ministry', 'Teaching and caring for the little ones', '2026-09-15T00:00:00.000Z'),
  ('dep_outreach',  'outreach',       'Outreach & Evangelism', 'Missions and community outreach', '2026-09-15T00:00:00.000Z'),
  ('dep_prayer',    'intercessory',   'Intercessory Prayer', 'Standing in the gap for the church', '2026-09-15T00:00:00.000Z'),
  ('dep_youth',     'youth',          'Youth Ministry',     'Raising the next generation', '2026-09-15T00:00:00.000Z');
