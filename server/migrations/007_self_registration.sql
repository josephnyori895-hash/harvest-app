-- Self-registration: members sign up with username + phone + password.
-- Allan is the only pre-created admin account.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_normalized);

-- Admin bootstrap account: username=allan, phone=0706300077, password=Kipsii@2026#
-- The hash below is bcrypt cost 12; it is safe to keep in the repo (it is NOT the password).
-- Registration requests with username 'allan' are rejected in the route (reserved).
INSERT INTO users (username, name, phone, phone_normalized, role, verified, group_name, pin_hash, password_hash)
VALUES (
  'allan',
  'Allan',
  '0706300077',
  '+254706300077',
  'admin',
  TRUE,
  'Harvest Central',
  '$2a$12$ZVEVk6qaDMyZe4/bgH0Xougpa38AOTzz1TUoZy11WXAQeRrszkm7e',
  '$2a$12$ZVEVk6qaDMyZe4/bgH0Xougpa38AOTzz1TUoZy11WXAQeRrszkm7e'
)
ON CONFLICT (username) DO UPDATE
SET phone_normalized = EXCLUDED.phone_normalized,
    role = 'admin',
    verified = TRUE,
    password_hash = EXCLUDED.password_hash,
    pin_hash = EXCLUDED.pin_hash;
