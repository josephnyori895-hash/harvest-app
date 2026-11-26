-- Per-group registration area radius (metres).
-- The map drew a fixed 400 m circle for every congregation, but a group at a
-- university gate and one covering a whole estate need very different areas.
ALTER TABLE groups ADD COLUMN location_radius INTEGER NOT NULL DEFAULT 400;
