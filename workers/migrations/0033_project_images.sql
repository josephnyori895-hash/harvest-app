-- Church projects can carry artwork. The key points at an uploaded original
-- (originals/post/…) and is signed per request, never stored as a URL that
-- would expire.
ALTER TABLE projects ADD COLUMN image_key TEXT;
