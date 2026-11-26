-- 0035 assumed the administrator was the old seed account `harvest_nyeri`.
-- That account had already been deleted and replaced by `hfcnyeri` (the real
-- church account), so the policy demoted the only administrator and verified
-- them off. Restore by immutable id, not by username, so a later username
-- correction cannot break admin access again.
UPDATE users
   SET role = 'admin', verified = 1
 WHERE id = 'f1000000-0000-4000-8000-000000000009';
