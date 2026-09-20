-- WhatsApp-style group permissions.
-- Safe defaults preserve existing Harvest behavior while making the controls explicit.
ALTER TABLE groups ADD COLUMN allow_member_edit_info INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN allow_member_send INTEGER NOT NULL DEFAULT 1;
ALTER TABLE groups ADD COLUMN allow_member_add INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN allow_member_invite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN approve_new_members INTEGER NOT NULL DEFAULT 1;
ALTER TABLE groups ADD COLUMN send_message_history INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN invite_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_invite_token
  ON groups(invite_token) WHERE invite_token IS NOT NULL;
