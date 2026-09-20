-- Make story views identity-based so viewed/unviewed state survives username changes and works across devices.
ALTER TABLE story_views ADD COLUMN viewer_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Backfill existing views from the legacy username identity where possible.
UPDATE story_views
   SET viewer_user_id = (
     SELECT u.id FROM users u WHERE u.username = story_views.viewer_username
   )
 WHERE viewer_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_views_user_story
  ON story_views (viewer_user_id, story_id)
  WHERE viewer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_story_views_user
  ON story_views (viewer_user_id, story_id)
  WHERE viewer_user_id IS NOT NULL;
