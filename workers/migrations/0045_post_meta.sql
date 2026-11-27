-- Instagram-style post metadata: an optional free-text location and the
-- members tagged in the post (JSON array of usernames). Both survive the
-- moderation queue so a tagged post is not stripped when an admin approves it.
ALTER TABLE posts ADD COLUMN location TEXT;
ALTER TABLE posts ADD COLUMN tagged_users TEXT;
ALTER TABLE pending_queue ADD COLUMN location TEXT;
ALTER TABLE pending_queue ADD COLUMN tagged_users TEXT;
