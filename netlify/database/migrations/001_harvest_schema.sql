-- Harvest Family Church: canonical Netlify Database schema.
-- This file is the production migration source of truth for Netlify Database.
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
  pin_hash TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified) WHERE verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_role_verified ON users(role, verified);
CREATE INDEX IF NOT EXISTS idx_users_group_name ON users(group_name);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

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
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_type_status ON pending_queue(type, status);

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
CREATE INDEX IF NOT EXISTS idx_posts_approved_at ON posts(approved_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_name);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(is_pinned) WHERE is_pinned;

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  original_key TEXT, thumb_key TEXT, blurhash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_reels_approved_at ON reels(approved_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_reels_pinned ON reels(is_pinned) WHERE is_pinned;

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
  actor_role TEXT,
  action TEXT,
  target_type TEXT, target_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

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
  PRIMARY KEY(follower_id, followee_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE OR REPLACE FUNCTION is_mutual(a UUID, b UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id=a AND followee_id=b)
     AND EXISTS (SELECT 1 FROM follows WHERE follower_id=b AND followee_id=a);
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  invite_only BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_groups_slug ON groups(slug);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT CHECK(role IN ('admin','member')) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  invited_username TEXT NOT NULL,
  invited_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inviter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invites_group_status ON group_invites(group_id, status);
CREATE INDEX IF NOT EXISTS idx_invites_username ON group_invites(invited_username);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT CHECK(kind IN ('dm','group')) NOT NULL,
  conversation_key TEXT NOT NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_username TEXT NOT NULL,
  recipient_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_username TEXT,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  status TEXT CHECK(status IN ('sent','delivered','seen')) DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_status ON messages(recipient_username, status) WHERE kind='dm';
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at DESC) WHERE kind='group';
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  username TEXT,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_username ON login_attempts(ip, username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS media_upload_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_user_created ON media_upload_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS giving_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  purpose TEXT NOT NULL DEFAULT 'General Giving',
  provider TEXT NOT NULL DEFAULT 'mpesa',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  receipt_number TEXT,
  provider_result_code TEXT,
  provider_result_description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_giving_user_created ON giving_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_status_created ON giving_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_receipt ON giving_transactions(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_giving_merchant ON giving_transactions(merchant_request_id) WHERE merchant_request_id IS NOT NULL;

-- Safe demo seed. No plaintext PINs are stored.
INSERT INTO users (username, name, group_name, constituency, location, verified, role, lat, lng) VALUES
 ('harvest_nyeri','Harvest Family Church','Harvest Central','Nyeri Town','Nyeri Town',true,'admin',-0.4197,36.9475),
 ('pst.simon','Pst Simon','Harvest Ruringu','Ruringu','Ruringu',false,'member',-0.432,36.95),
 ('youth_harvest','Youth Harvest','Harvest Skuta','Skuta','Skuta',true,'member',-0.41,36.94),
 ('pst.grace','Pst Grace','Harvest Majengo','Majengo','Majengo',false,'member',-0.425,36.945),
 ('worship_team','Worship Team','Harvest Kamakwa','Kamakwa','Kamakwa',false,'member',-0.415,36.955)
ON CONFLICT (username) DO NOTHING;

INSERT INTO groups (slug, name, description, invite_only) VALUES
 ('youth_group','Youth Group','Youth Group • invite-only', true),
 ('harvest_central','Harvest Central','Harvest Central — Nyeri Town', true),
 ('harvest_ruringu','Harvest Ruringu','Harvest Ruringu', true),
 ('harvest_skuta','Harvest Skuta','Harvest Skuta', true),
 ('harvest_majengo','Harvest Majengo','Harvest Majengo', true),
 ('harvest_kamakwa','Harvest Kamakwa','Harvest Kamakwa', true)
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM users WHERE username='harvest_nyeri' LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO group_members (group_id, user_id, role)
    SELECT g.id, admin_id, 'admin' FROM groups g
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
