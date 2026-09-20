-- Security hardening: remove credentials that are published in repository history.
-- Admin access must be provisioned with a private ADMIN_PIN_HASHES secret, then
-- the bootstrap PIN is converted into the account's private PBKDF2 pin_hash.
-- This migration intentionally does not create or reveal a replacement secret.
UPDATE users
SET password_hash = NULL,
    pin_hash = NULL
WHERE username IN ('allan', 'harvest')
  AND (
    password_hash LIKE 'pbkdf2$100000$36VclBDbK21MdnJjH2xXUw==%'
    OR password_hash LIKE 'pbkdf2$100000$22y1voPPZ7S5waowhQ0O6A==%'
    OR pin_hash LIKE 'pbkdf2$100000$36VclBDbK21MdnJjH2xXUw==%'
    OR pin_hash LIKE 'pbkdf2$100000$22y1voPPZ7S5waowhQ0O6A==%'
  );
