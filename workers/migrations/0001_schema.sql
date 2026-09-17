-- Consolidated D1 schema. Equivalent of server/migrations 001-007 (Postgres to SQLite).
-- UUIDs are TEXT (generated in JS). Timestamps are ISO TEXT (lexicographic compare is correct).
-- Booleans are 0/1.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  location TEXT,
  group_name TEXT NOT NULL DEFAULT 'Harvest Central',
  constituency TEXT,
  faith TEXT,
  lat REAL,
  lng REAL,
  verified INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  password_hash TEXT,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  deactivated_at TEXT,
  deactivated_by TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_users_group_name ON users(group_name);
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified) WHERE verified = 1;
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

CREATE TABLE IF NOT EXISTS pending_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('post','story','reel','track')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  original_key TEXT NOT NULL,
  thumb_key TEXT,
  hls_master_key TEXT,
  poster_key TEXT,
  blurhash TEXT,
  width INTEGER, height INTEGER, duration INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','transcoding')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_type_status ON pending_queue(type, status);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  width INTEGER, height INTEGER,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  verified_snapshot INTEGER,
  group_name TEXT, constituency TEXT, faith TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_approved_at ON posts(approved_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_name);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(is_pinned) WHERE is_pinned = 1;

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at DESC);

CREATE TABLE IF NOT EXISTS reels (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  hls_master_key TEXT, poster_key TEXT, thumb_key TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  verified_snapshot INTEGER,
  group_name TEXT, constituency TEXT, faith TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reels_approved_at ON reels(approved_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_pinned ON reels(is_pinned) WHERE is_pinned = 1;

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, artist TEXT,
  original_key TEXT, preview_key TEXT, cover_thumb_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT,
  meta TEXT,           -- JSON string (JSONB equivalent)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  invite_only INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS group_invites (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  invited_username TEXT NOT NULL,
  invited_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_group_status ON group_invites(group_id, status);
CREATE INDEX IF NOT EXISTS idx_invites_username ON group_invites(invited_username);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm','group')),
  conversation_key TEXT NOT NULL,
  sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_username TEXT NOT NULL,
  recipient_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_username TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','seen')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_status ON messages(recipient_username, status);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  username TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_username ON login_attempts(ip, username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS media_upload_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_user_created ON media_upload_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS giving_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  amount_kes REAL NOT NULL CHECK (amount_kes > 0),
  purpose TEXT NOT NULL DEFAULT 'General Giving',
  provider TEXT NOT NULL DEFAULT 'mpesa',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  receipt_number TEXT,
  provider_result_code TEXT,
  provider_result_description TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_giving_user_created ON giving_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_status_created ON giving_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_receipt ON giving_transactions(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_giving_merchant ON giving_transactions(merchant_request_id) WHERE merchant_request_id IS NOT NULL;

-- Seeds (001 + 002 + 007)
-- allan: the only pre-created admin. pin_hash/password_hash are PBKDF2-SHA256
-- (pbkdf2$100000$salt$hash) of 'Kipsii@2026#' — replace via /api routes if rotated.
INSERT OR REPLACE INTO users (id, username, name, phone, phone_normalized, group_name, role, verified, pin_hash, password_hash, lat, lng) VALUES
  ('f1000000-0000-4000-8000-000000000001','allan','Allan','0706300077','+254706300077','Harvest Central','admin',1,
   'pbkdf2$100000$36VclBDbK21MdnJjH2xXUw==$kQJtBxB7jfuFAsTa/ZQthF9yeS5qXc5O3pUmL2JWxPg=',
   'pbkdf2$100000$36VclBDbK21MdnJjH2xXUw==$kQJtBxB7jfuFAsTa/ZQthF9yeS5qXc5O3pUmL2JWxPg=',
   -0.4197,36.9475);

INSERT OR IGNORE INTO users (id, username, name, group_name, constituency, location, verified, role, lat, lng) VALUES
  ('f1000000-0000-4000-8000-0000000000a1','harvest_nyeri','Harvest Family Church','Harvest Central','Nyeri Town','Nyeri Town',1,'admin',-0.4197,36.9475),
  ('f1000000-0000-4000-8000-0000000000a2','pst.simon','Pst Simon','Harvest Ruringu','Ruringu','Ruringu',0,'member',-0.432,36.95),
  ('f1000000-0000-4000-8000-0000000000a3','youth_harvest','Youth Harvest','Harvest Skuta','Skuta','Skuta',1,'member',-0.41,36.94),
  ('f1000000-0000-4000-8000-0000000000a4','pst.grace','Pst Grace','Harvest Majengo','Majengo','Majengo',0,'member',-0.425,36.945),
  ('f1000000-0000-4000-8000-0000000000a5','worship_team','Worship Team','Harvest Kamakwa','Kamakwa','Kamakwa',0,'member',-0.415,36.955);

INSERT OR IGNORE INTO groups (id, slug, name, description, invite_only) VALUES
  ('f2000000-0000-4000-8000-000000000001','youth_group','Youth Group','Youth Group - 12 members, invite-only',1),
  ('f2000000-0000-4000-8000-000000000002','harvest_central','Harvest Central','Harvest Central - Nyeri Town',1),
  ('f2000000-0000-4000-8000-000000000003','harvest_ruringu','Harvest Ruringu','Harvest Ruringu',1),
  ('f2000000-0000-4000-8000-000000000004','harvest_skuta','Harvest Skuta','Harvest Skuta',1),
  ('f2000000-0000-4000-8000-000000000005','harvest_majengo','Harvest Majengo','Harvest Majengo',1),
  ('f2000000-0000-4000-8000-000000000006','harvest_kamakwa','Harvest Kamakwa','Harvest Kamakwa',1);

-- harvest_nyeri admin of all groups (002 tail)
INSERT OR IGNORE INTO group_members (group_id, user_id, role)
SELECT g.id, 'f1000000-0000-4000-8000-0000000000a1', 'admin' FROM groups g;
