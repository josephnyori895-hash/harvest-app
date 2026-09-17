-- Groups belong to a community (congregation). A community hosts 3-10 groups:
-- max 10 is enforced at creation; min 3 is shown as an advisory status.
ALTER TABLE groups ADD COLUMN community TEXT NOT NULL DEFAULT '';

UPDATE groups SET community = 'Harvest Central'  WHERE slug IN ('harvest_central', 'youth_group');
UPDATE groups SET community = 'Harvest Ruringu'  WHERE slug = 'harvest_ruringu';
UPDATE groups SET community = 'Harvest Skuta'    WHERE slug = 'harvest_skuta';
UPDATE groups SET community = 'Harvest Majengo'  WHERE slug = 'harvest_majengo';
UPDATE groups SET community = 'Harvest Kamakwa'  WHERE slug = 'harvest_kamakwa';
