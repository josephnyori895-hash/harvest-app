-- Group and department identity: the creator/leaders can set a profile photo
-- and a chat background. Keys point at the same R2 'avatar' media type the
-- member profile uses, so images are signed exactly like avatars.
ALTER TABLE groups ADD COLUMN avatar_key TEXT;
ALTER TABLE groups ADD COLUMN chat_background_key TEXT;
ALTER TABLE departments ADD COLUMN avatar_key TEXT;
ALTER TABLE departments ADD COLUMN chat_background_key TEXT;
