-- Phone-side approval for admin browser sign-in.
-- A browser challenge starts 'pending': the admin phone gets a live request over
-- the realtime socket with Authorize / Deny. Denying kills the challenge even if
-- someone later types the code; approving lets the code be used.
ALTER TABLE admin_login_challenges ADD COLUMN decision TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE admin_login_challenges ADD COLUMN decided_at TEXT;
