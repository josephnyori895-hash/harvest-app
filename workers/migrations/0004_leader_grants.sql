-- Per-user capability grants for trusted leaders (pastors, ministry heads).
-- The system admin chooses who is verified AND which powers each leader gets:
--   post_media         - upload posts / reels / worship tracks
--   create_groups      - create small groups
--   manage_groups      - approve join requests, promote/demote, remove members
--   manage_communities - community-level oversight (delete groups)
--   delete_media       - delete any post / reel / track / story
-- Admin (role='admin') always has every power; grants apply to members.

ALTER TABLE users ADD COLUMN grants TEXT NOT NULL DEFAULT '';

-- Allan keeps full control regardless; seed shows the intended shape.
UPDATE users SET grants = 'post_media,create_groups,manage_groups,manage_communities,delete_media' WHERE role = 'admin';
