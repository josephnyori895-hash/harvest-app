-- Story duration persistence: the viewer already derives per-story photo
-- duration from duration_secs (fallback 4s); this column makes the composer's
-- chosen duration survive the round-trip.
ALTER TABLE stories ADD COLUMN duration_secs INTEGER;
