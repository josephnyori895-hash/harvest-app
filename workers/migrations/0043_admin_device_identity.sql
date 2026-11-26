-- Device identity that survives sign-out.
--
-- device_id is the identity: one row per installation, so signing out and back
-- in updates that row instead of adding a twin. These columns make the row
-- recognisable to a person — what the device is (details) and where it last
-- signed in from (last_ip) — refreshed on every successful admin sign-in.
-- details is a small JSON object (platform, os, browser, screen, model) built
-- by the client and sanitised on the server; it is never trusted for auth.
ALTER TABLE admin_devices ADD COLUMN details TEXT;
ALTER TABLE admin_devices ADD COLUMN last_ip TEXT;

-- The pending challenge carries the asking device's details so the row can be
-- created with them when the code verifies (the verify call sends only the id).
ALTER TABLE admin_login_challenges ADD COLUMN details TEXT;
