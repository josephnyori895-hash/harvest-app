-- Album posts: several photos shared as one post.
--
-- NULL means the post has a single photo (original_key), which is every post
-- created before this migration. When present, the column holds a JSON array
-- of storage keys in display order; original_key stays as the first photo so
-- older clients and the media console keep working unchanged.
ALTER TABLE posts ADD COLUMN media_keys TEXT;
