-- Story videos: the story creator and viewer already support photo OR video,
-- but the upload policy only accepted images. Migration 0007 lets each story
-- record its media kind so the feed can serve video stories properly.
ALTER TABLE stories ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image';

-- Existing rows are photos (the old policy only allowed images).
