-- 001_init.sql — Harvest Family core
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  group_name TEXT NOT NULL DEFAULT 'Harvest Central',
  constituency TEXT,
  faith TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  verified BOOLEAN DEFAULT FALSE,
  role TEXT CHECK(role IN ('member','admin')) DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT CHECK(type IN ('post','story','reel','track')) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  original_key TEXT NOT NULL,
  thumb_key TEXT,
  hls_master_key TEXT,
  poster_key TEXT,
  blurhash TEXT,
  width INT, height INT, duration INT,
  status TEXT CHECK(status IN ('pending','approved','rejected','transcoding')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT
);
CREATE INDEX idx_pending_status ON pending_queue(status, created_at DESC);
CREATE INDEX idx_pending_user ON pending_queue(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  width INT, height INT,
  likes INT DEFAULT 0, comments INT DEFAULT 0,
  verified_snapshot BOOLEAN,
  group_name TEXT, constituency TEXT, faith TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX idx_posts_approved_at ON posts(approved_at DESC NULLS LAST);
CREATE INDEX idx_posts_group ON posts(group_name);
CREATE INDEX idx_posts_pinned ON posts(is_pinned) WHERE is_pinned;

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_stories_expires ON stories(expires_at);
CREATE INDEX idx_stories_created ON stories(created_at DESC);

CREATE TABLE IF NOT EXISTS reels (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  hls_master_key TEXT, poster_key TEXT, thumb_key TEXT,
  views INT DEFAULT 0, likes INT DEFAULT 0, comments INT DEFAULT 0,
  verified_snapshot BOOLEAN,
  group_name TEXT, constituency TEXT, faith TEXT,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX idx_reels_approved_at ON reels(approved_at DESC NULLS LAST);
CREATE INDEX idx_reels_pinned ON reels(is_pinned) WHERE is_pinned;

CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, artist TEXT,
  original_key TEXT, preview_key TEXT, cover_thumb_key TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action TEXT,
  target_type TEXT, target_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  followee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(follower_id, followee_id)
);

-- seed demo groups match src/components/HarvestMap.tsx:14 groupCoords 50-57
INSERT INTO users (username, name, group_name, constituency, location, verified, role, lat, lng) VALUES
 ('harvest_nyeri','Harvest Family Church','Harvest Central','Nyeri Town','Nyeri Town',true,'admin',-0.4197,36.9475),
 ('pst.simon','Pst Simon','Harvest Ruringu','Ruringu','Ruringu',false,'member',-0.432,36.95),
 ('youth_harvest','Youth Harvest','Harvest Skuta','Skuta','Skuta',true,'member',-0.41,36.94),
 ('pst.grace','Pst Grace','Harvest Majengo','Majengo','Majengo',false,'member',-0.425,36.945),
 ('worship_team','Worship Team','Harvest Kamakwa','Kamakwa','Kamakwa',false,'member',-0.415,36.955)
ON CONFLICT (username) DO NOTHING;
