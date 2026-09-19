-- Profile editing: each user can set a profile photo (avatar).
-- The key follows the standard originals/<type>/<yyyy>/<mm>/<uuid>.<ext> layout
-- with type='avatar' and is served through the signed /api/media/* reads.
ALTER TABLE users ADD COLUMN avatar_key TEXT;

-- Avatars are small and few; a targeted index is unnecessary — reads resolve
-- the column straight off the users row.
