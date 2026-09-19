-- Admin handover (client request):
--  1. 'allan' is no longer the admin — demoted to a normal member. His login
--     (username allan + existing password) keeps working, but with member
--     powers only. requireRole() re-reads the role from the DB on every
--     request, so this takes effect immediately, even for existing tokens.
--  2. A separate admin account takes over: username 'harvest' (the client
--     writes it as "Harvest" — login is case-insensitive on identifiers),
--     password Kipsii@2026#, display name "Admin".
-- 'harvest' is in RESERVED_USERNAMES, so this seeded row is the only way it
-- can ever exist — public registration can never take or duplicate it.
-- password_hash format matches workers/src/lib/crypto.js pbkdf2Hash
-- (PBKDF2-SHA256, 100000 iterations, 32-byte key).
UPDATE users SET role = 'member', name = 'Allan' WHERE username = 'allan' AND role = 'admin';

INSERT INTO users (id, username, name, phone, phone_normalized, group_name, role, verified, active, password_hash, created_at)
SELECT
  'f1000000-0000-4000-8000-000000000009',
  'harvest',
  'Admin',
  NULL,
  NULL,
  'Harvest Central',
  'admin',
  1,
  1,
  'pbkdf2$100000$22y1voPPZ7S5waowhQ0O6A==$j90E/is/hbfsT3pxpRYPcvS/F0RIVp55PKOMHg0JlBo=',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'harvest');

UPDATE users SET role = 'admin', name = 'Admin', verified = 1
WHERE username = 'harvest' AND (role != 'admin' OR name != 'Admin' OR verified != 1);
