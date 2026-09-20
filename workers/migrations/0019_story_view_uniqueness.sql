-- One view per member per story, even if a member changes username.
DELETE FROM story_views
 WHERE rowid IN (
   SELECT older.rowid
     FROM story_views older
     JOIN story_views newer
       ON newer.story_id = older.story_id
      AND newer.viewer_user_id = older.viewer_user_id
      AND newer.viewer_user_id IS NOT NULL
      AND newer.viewed_at > older.viewed_at
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_views_user_story_unique
  ON story_views (viewer_user_id, story_id);
