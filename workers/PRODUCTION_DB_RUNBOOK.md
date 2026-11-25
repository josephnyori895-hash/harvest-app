# Production database safety runbook

## Migration policy

D1 migrations in `workers/migrations/` are append-only. Do not edit, delete, reorder, or rename a migration that may already have been applied to production. Fix an already-applied schema change with a new forward migration.

Every migration must be:
- additive or otherwise backward-compatible with the currently deployed Worker;
- safe to run once;
- validated against a fresh SQLite database in CI;
- reviewed for indexes on foreign-key/filter columns;
- free of production credentials and secrets.

There are intentionally no destructive "down" migrations. A down migration can destroy production data and can leave the deployed Worker and schema incompatible.

## Before production migration

From `workers/`:

```bash
npm ci
npm run db:migrate:status
npx wrangler d1 export DB --remote --output "backup-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

The CI/CD migration command is:

```bash
npx wrangler d1 migrations apply DB --remote
```

D1 migration application is transactional per migration. If a migration fails, Wrangler rolls that migration back and leaves the previous successful migration applied.

Before applying a release, verify the export is non-empty and contains the tables you expect:

```bash
ls -lh backup-*.sql
rg -n "CREATE TABLE .*users|CREATE TABLE .*giving_transactions|CREATE TABLE .*content_publications" backup-*.sql
```

Do not proceed if the export is missing or truncated. Keep the backup until the post-deploy checks pass and the release has been stable for at least one service window.

### 0035–0036 release preflight

`0035_admin_device_auth.sql` adds the device/challenge tables, the admin epoch columns, and demotes every admin except `harvest_nyeri`. `0036_publishing_calendar.sql` adds the publication/event/ministry tables and expiry columns. Both are additive; run these checks against the production snapshot or a clone before applying:

```sql
-- Exactly one admin must remain after 0035 (or zero before the primary is provisioned).
SELECT username, role FROM users WHERE role = 'admin';
-- The migration must not have to rewrite an existing device binding.
SELECT user_id, kind, COUNT(*) FROM admin_devices GROUP BY user_id, kind HAVING COUNT(*) > 1;
-- Existing content tables must be present before 0036 adds columns.
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('posts','sermons','site_content','events','ministry_updates');
```

If `admin_devices` already has duplicate `(user_id, kind)` rows, stop: 0035's unique index will fail. Resolve the duplicates manually in a separate, reviewed change, not by editing the migration.

### Post-migration verification

Run these read-only checks immediately after `migrations apply`:

```sql
SELECT COUNT(*) AS admins FROM users WHERE role = 'admin';
SELECT username FROM users WHERE role = 'admin';
SELECT COUNT(*) FROM admin_devices;
SELECT COUNT(*) FROM admin_login_challenges;
SELECT name FROM pragma_table_info('content_publications');
SELECT COUNT(*) FROM content_publications;
SELECT COUNT(*) FROM giving_transactions;
SELECT COUNT(*) FROM giving_transaction_audit;
```

Expected: one admin, no duplicate device/kind pairs, the new tables/columns exist, and existing giving/content row counts are unchanged from the pre-migration snapshot (new columns may be `NULL`).

## Application rollback

If a Worker release is bad but its schema changes are backward-compatible:

1. Roll the Worker code back to the previous known-good deployment/version.
2. Do not attempt to undo the migration unless the schema change itself is proven unsafe.
3. Investigate with logs and D1 queries.
4. Create a corrective forward migration if the schema needs repair.

## Database recovery

For destructive data/schema recovery, use D1 Time Travel only after confirming the recovery point. It overwrites the database in place.

```bash
npx wrangler d1 time-travel info DB --timestamp="YYYY-MM-DDTHH:MM:SSZ"
npx wrangler d1 time-travel restore DB --timestamp="YYYY-MM-DDTHH:MM:SSZ"
```

Treat a Time Travel restore as an emergency operation. Stop application writes, identify the exact recovery point, and verify the database afterward.

If the migration itself must be undone, prefer restoring the pre-migration export into a new D1 database, verifying it, and then switching the Worker binding. Do not delete migration rows to make Wrangler re-run a migration; that hides the applied state and can re-run non-idempotent `ALTER TABLE` statements.

## Credential and data-preservation rules

- Never run `wrangler d1 migrations apply --remote` or `wrangler deploy` from a local machine without explicit release authorization.
- Never edit an applied migration to work around a production error.
- Never drop or rewrite `giving_transactions`, `giving_transaction_audit`, `messages`, or `audit_log` as part of a routine release. They are the financial and moderation record.
- Rotate secrets in Cloudflare, not in the repository. A secret pasted into a migration remains in git history.
- Production APK signing keys are separate from D1 and must not be changed as part of a database release.

## Deployment ordering

The normal deployment pipeline applies migrations before deploying the new Worker. Therefore schema changes must follow the expand/contract rule:

1. Add new tables/columns/indexes first.
2. Deploy code that can work with both old and new schema where necessary.
3. Remove/retire old schema only in a later migration after the old Worker is no longer running.

Never make a migration that removes or renames a column required by the currently deployed Worker.

## Production secrets

Secrets belong in Cloudflare Worker secrets, not migrations, `wrangler.toml`, source code, or CI logs.

The repository contains historical migrations that sanitize old seeded credentials. Those migration files are immutable history; do not reintroduce credentials into new migrations. Rotate any credential that has ever been exposed in repository history.

## Final checks

After a production deployment:

```bash
curl --fail https://harvestfamily-api.harvestfamily.workers.dev/health
npx wrangler d1 migrations list DB --remote
```

Then run the authenticated application smoke tests before treating the release as verified.
