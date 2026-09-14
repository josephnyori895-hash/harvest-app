-- Restores the self-hosted (server/docker-compose.yml) schema to parity with the
-- Netlify Database schema. `media_upload_attempts` backs the presign rate limit
-- in server/src/routes/media.js and was only defined for Netlify.

CREATE TABLE IF NOT EXISTS media_upload_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_user_created
  ON media_upload_attempts(user_id, created_at DESC);
