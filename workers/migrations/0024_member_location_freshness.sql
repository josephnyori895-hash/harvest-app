-- Track when a member last shared GPS coordinates.
-- NULL means the member has never shared a device location.
ALTER TABLE users ADD COLUMN location_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_location_updated_at
  ON users(location_updated_at DESC)
  WHERE location_updated_at IS NOT NULL;
