-- 0018 created two partial indexes on (viewer_user_id, story_id).
-- 0019 added the authoritative full unique index required by the idempotent
-- story-view upsert. Remove the now-redundant partial indexes.
DROP INDEX IF EXISTS idx_story_views_user_story;
DROP INDEX IF EXISTS idx_story_views_user;
