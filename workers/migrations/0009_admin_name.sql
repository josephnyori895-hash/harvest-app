-- Display-name only change: the admin account shows as "Admin" everywhere in
-- the app. Login credentials are NOT affected — username 'allan' and the
-- existing password keep working exactly as before.
UPDATE users SET name = 'Admin' WHERE username = 'allan' AND name != 'Admin';
