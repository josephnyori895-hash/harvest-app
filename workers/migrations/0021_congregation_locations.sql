-- Restore the five congregation rows that registration auto-assignment
-- (auth.js nearestFromRows → geo.js) matches new signups against. These were
-- seeded in 0001/0006 but are missing from live databases where the groups
-- table was rebuilt from the small-groups seed (0016+). Without them, signup
-- silently falls back to the hardcoded centroids in geo.js and admin location
-- edits have nothing to edit.
-- Also normalises the seeded locations to the exact 0006 values.
INSERT OR IGNORE INTO groups (id, slug, name, description, community, invite_only, lat, lng, location_label) VALUES
  ('f2000000-0000-4000-8000-000000000002', 'harvest_central', 'Harvest Central', 'Harvest Central - Nyeri Town', 'Harvest Central', 1, -0.4197, 36.9475, 'Nyeri Town'),
  ('f2000000-0000-4000-8000-000000000003', 'harvest_ruringu',  'Harvest Ruringu',  'Harvest Ruringu',              'Harvest Central', 1, -0.432,  36.95,   'Ruringu'),
  ('f2000000-0000-4000-8000-000000000004', 'harvest_skuta',    'Harvest Skuta',    'Harvest Skuta',                'Harvest Central', 1, -0.41,   36.94,   'Skuta'),
  ('f2000000-0000-4000-8000-000000000005', 'harvest_majengo',  'Harvest Majengo',  'Harvest Majengo',              'Harvest Central', 1, -0.425,  36.945,  'Majengo'),
  ('f2000000-0000-4000-8000-000000000006', 'harvest_kamakwa',  'Harvest Kamakwa',  'Harvest Kamakwa',              'Harvest Central', 1, -0.415,  36.955,  'Kamakwa');

-- If the rows already exist but predate 0006, backfill their locations.
UPDATE groups SET lat = -0.4197, lng = 36.9475, location_label = 'Nyeri Town', community = 'Harvest Central' WHERE slug = 'harvest_central' AND lat IS NULL;
UPDATE groups SET lat = -0.432,  lng = 36.95,   location_label = 'Ruringu',    community = 'Harvest Central' WHERE slug = 'harvest_ruringu'  AND lat IS NULL;
UPDATE groups SET lat = -0.41,   lng = 36.94,   location_label = 'Skuta',      community = 'Harvest Central' WHERE slug = 'harvest_skuta'    AND lat IS NULL;
UPDATE groups SET lat = -0.425,  lng = 36.945,  location_label = 'Majengo',    community = 'Harvest Central' WHERE slug = 'harvest_majengo'  AND lat IS NULL;
UPDATE groups SET lat = -0.415,  lng = 36.955,  location_label = 'Kamakwa',    community = 'Harvest Central' WHERE slug = 'harvest_kamakwa'  AND lat IS NULL;
