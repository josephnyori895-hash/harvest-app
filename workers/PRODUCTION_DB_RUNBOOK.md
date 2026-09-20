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
