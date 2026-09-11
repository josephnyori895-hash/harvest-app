-- 002_realtime.sql — DM / Group / Presence / Calls (VPS-only, 500 users)
-- Keep PIN bcrypt (see 001 users.role); adds chat + groups + invites. No external queue needed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Deterministic conversation key: harvest:chat:a:b (sorted pair) or group:slug
-- Messages: DM + Group unified. Conversation_key indexed for fast thread fetch.

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,             -- e.g. youth_group, harvest_central
  name TEXT NOT NULL,                    -- display: Youth Group
  description TEXT DEFAULT '',
  invite_only BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_groups_slug ON groups(slug);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT CHECK(role IN ('admin','member')) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY(group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

-- invite flow: admin approves (church-harvest requirement: invite 525 admin approves)
CREATE TABLE IF NOT EXISTS group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  invited_username TEXT NOT NULL,        -- may be pre-registered or not yet
  invited_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inviter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_invites_group_status ON group_invites(group_id, status);
CREATE INDEX idx_invites_username ON group_invites(invited_username);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT CHECK(kind IN ('dm','group')) NOT NULL,
  conversation_key TEXT NOT NULL,        -- harvest:chat:alice:bob  OR  group:youth_group
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_username TEXT NOT NULL,         -- denormalized for fast render w/o JOIN
  recipient_id UUID REFERENCES users(id) ON DELETE SET NULL, -- dm only
  recipient_username TEXT,               -- dm only
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,    -- group only
  body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),
  status TEXT CHECK(status IN ('sent','delivered','seen')) DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_conv_created ON messages(conversation_key, created_at DESC);
CREATE INDEX idx_messages_recipient_status ON messages(recipient_username, status) WHERE kind='dm';
CREATE INDEX idx_messages_group ON messages(group_id, created_at DESC) WHERE kind='group';
CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC);

-- presence is ephemeral (Redis/memory), but keep last_seen for green-dot fallback when offline
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT; -- bcrypt PIN (keep PIN bcrypt kept)

-- seed groups matching groupCoords + youth_group (Chat.tsx:119 group:youth_group)
INSERT INTO groups (slug, name, description, invite_only) VALUES
  ('youth_group','Youth Group','Youth Group • 12 members — invite-only', true),
  ('harvest_central','Harvest Central','Harvest Central — Nyeri Town', true),
  ('harvest_ruringu','Harvest Ruringu','Harvest Ruringu', true),
  ('harvest_skuta','Harvest Skuta','Harvest Skuta', true),
  ('harvest_majengo','Harvest Majengo','Harvest Majengo', true),
  ('harvest_kamakwa','Harvest Kamakwa','Harvest Kamakwa', true)
ON CONFLICT (slug) DO NOTHING;

-- make harvest_nyeri admin of all groups (if exists)
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
