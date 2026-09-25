-- Clear congregation references that point at groups which no longer exist
-- (the five congregations were deleted via the admin app on 2026-09-23 while
-- profiles still pointed at them — ghosts on ViewUser, directory, map, chat).
-- Only clears names with no matching groups.name row; existing groups untouched.
UPDATE users SET group_name = ''
WHERE group_name <> ''
  AND group_name NOT IN (SELECT name FROM groups);
