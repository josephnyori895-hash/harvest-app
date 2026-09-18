-- Group settings: admin-editable location for registration auto-assignment.
-- lat/lng power the "nearest group" matching at signup (geo.js reads the DB;
-- built-in Nyeri centroids remain the fallback for groups without a location).
ALTER TABLE groups ADD COLUMN lat REAL;
ALTER TABLE groups ADD COLUMN lng REAL;
ALTER TABLE groups ADD COLUMN location_label TEXT DEFAULT '';

-- Seed the existing congregations with their known centroids so
-- auto-assignment keeps working before Allan edits anything.
UPDATE groups SET lat = -0.4197, lng = 36.9475, location_label = 'Nyeri Town' WHERE slug = 'harvest_central';
UPDATE groups SET lat = -0.432,  lng = 36.95,   location_label = 'Ruringu'    WHERE slug = 'harvest_ruringu';
UPDATE groups SET lat = -0.41,   lng = 36.94,   location_label = 'Skuta'      WHERE slug = 'harvest_skuta';
UPDATE groups SET lat = -0.425,  lng = 36.945,  location_label = 'Majengo'    WHERE slug = 'harvest_majengo';
UPDATE groups SET lat = -0.415,  lng = 36.955,  location_label = 'Kamakwa'    WHERE slug = 'harvest_kamakwa';
