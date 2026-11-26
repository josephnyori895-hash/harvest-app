# Production release plan — commit `53a7247`

**Status: EXECUTED via CI run #644 (commit `ae66e3e`).** This document is kept
as the release record and fallback runbook; no manual command from §5–§10 was
run outside the workflow.

This is the release-specific checklist for the audit + group/department delegation
work. The standing policy and recovery detail live in
[`PRODUCTION_DB_RUNBOOK.md`](./PRODUCTION_DB_RUNBOOK.md); this file adds the exact
sequence, checks, and evidence for this release.

## 0. Release record (verified 2026-11-25)

- First release attempt: `53a7247` triggered run #643, which **failed at
  `Release test:all`**. Migrations and deploy were skipped; production was not
  touched by that run.
- Root cause: `scripts/test-worship-room.mjs` expected the feed music control
  to use `TrackArt`, but `2c3bbf6` replaced that disc with a plain play-icon
  row.
- Fix commit: `ae66e3e` — *Fix feed artwork and unstick the admin Members tab*
  (restores `TrackArt` in the feed music row; also ships the Members-tab
  loading fix). `test:all`, `typecheck`, and `build` passed locally before push.
- Second attempt: **run #644 passed**. `Apply D1 migrations`, `Deploy Worker
  and versioned APK`, authenticated smoke, both browser E2E suites, exact
  versioned APK verification, permanent URL verification, and the rollback
  drill all report **success**.
- Post-release production: `/health` returns **HTTP 200**; `/api/app-version`
  reports **1.0.644** (`version_code 1644`) with `/harvest-family.apk`.

## 1. Scope and schema impact

- **New migrations in this release: none.** `workers/migrations/` ends at
  `0036_publishing_calendar.sql`; commits `2c3bbf6..53a7247` add no SQL files.
- The security fixes (rate limits, challenge caps, giving callback atomicity,
  realtime cleanup) and the delegation UI use existing tables/columns:
  `grants` (text column), `admin_devices`, `admin_login_challenges`,
  `giving_transactions`, `giving_transaction_audit`, `audit_log`.
- Therefore the only migrations that *could* run are any already-unapplied
  earlier files. `0035` and `0036` are the newest and are the likely candidates
  if the previous release never reached production. **Confirm with
  `migrations list` before doing anything else.**
- If `0035_admin_device_auth.sql` runs, it **demotes every admin except
  `harvest_nyeri` and verifies that account**. Treat it as a data-changing
  migration, not a pure schema add.

## 2. Prerequisites (operator confirms before starting)

- [ ] Explicit release authorization recorded (who/when).
- [ ] Cloudflare access: `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN`
      with D1 edit + Workers deploy on account for `harvestfamily-api`.
- [ ] `ADMIN_PIN_HASHES` available in the CI environment (the workflow refuses
      to apply migrations without it).
- [ ] `wrangler` available through `workers/` devDependencies (`npx wrangler --version`).
- [ ] Node 26 / npm consistent with CI.
- [ ] Disk space for a full D1 export, outside the repository.
- [ ] The `Release test:all` failure from run #643 is understood and fixed;
      otherwise the pipeline stops before migrations again.
- [ ] No other release is running (`concurrency: harvest-android-release` is
      serialized, but confirm no manual deploy is in flight).

## 3. Preflight — local gates (read-only, safe)

From the repository root:

```bash
git fetch origin
git status --short                 # must be clean for the release commit
git log --oneline -1               # must be 53a7247 (or the new release SHA)
npm ci
npm run lint
npm run typecheck
npm run test:all                   # this is the gate that failed run #643
npm audit --omit=dev --audit-level=high
npm run build
```

Do not continue while any of these fail. Capture the failing test name and fix
it in a new commit; do not weaken or skip the assertion to get past the gate.

## 4. Preflight — production, read-only

From `workers/`:

```bash
npm ci
npm run db:migrate:status
```

Expected: the list shows `0036_publishing_calendar.sql` as the newest applied
file and **no surprising gaps**. Record the exact last-applied migration in the
release ticket.

Run the release preflight SQL against the production snapshot or a clone
(`wrangler d1 execute DB --remote --command "..."` or the dashboard console):

```sql
-- 0035 requirements
SELECT username, role FROM users WHERE role = 'admin';
SELECT user_id, kind, COUNT(*) AS n
  FROM admin_devices
 GROUP BY user_id, kind
HAVING n > 1;
SELECT name FROM sqlite_master
 WHERE type = 'table'
   AND name IN ('users','admin_devices','admin_login_challenges');

-- 0036 requirements
SELECT name FROM sqlite_master
 WHERE type = 'table'
   AND name IN ('posts','sermons','site_content','events','ministry_updates');

-- Record these baseline counts for post-migration comparison
SELECT COUNT(*) AS giving_rows FROM giving_transactions;
SELECT COUNT(*) AS audit_rows FROM giving_transaction_audit;
SELECT COUNT(*) AS content_rows FROM content_publications;
```

**Abort criteria**

- More than one `role = 'admin'` unless that is an intentional, reviewed state.
- Any duplicate `(user_id, kind)` pair in `admin_devices` — `0035`'s unique
  index would fail; resolve separately, never by editing the migration.
- A referenced table is missing before `0036` adds columns.
- `db:migrate:status` shows an applied migration that is not in the repository,
  or the migration order is ambiguous.

## 5. Backup (required before applying anything)

From `workers/`, with the timestamp captured in the ticket:

```bash
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
npx wrangler d1 export DB --remote --output "/secure/backups/harvestfamily-${STAMP}.sql"

ls -lh "/secure/backups/harvestfamily-${STAMP}.sql"
rg -c "CREATE TABLE" "/secure/backups/harvestfamily-${STAMP}.sql"
rg -n "CREATE TABLE .*(users|giving_transactions|content_publications)" \
  "/secure/backups/harvestfamily-${STAMP}.sql"
sha256sum "/secure/backups/harvestfamily-${STAMP}.sql"
```

Do not proceed if the export is empty, truncated, or missing `users` /
`giving_transactions`. Keep it until the release has been stable for one service
window. The file contains personal and financial data: store it encrypted and
outside git.

## 6. Apply migrations — **authorization required**

Preferred path: let CI do it. The release workflow applies migrations
immediately before deploying the Worker. Re-run the fixed workflow
(`workflow_dispatch` or a new push) so the sequence and audit trail stay in one
place.

Manual path, only with explicit release authorization, from `workers/`:

```bash
export CLOUDFLARE_ACCOUNT_ID="<account-id>"
export CLOUDFLARE_API_TOKEN="<token-with-d1-edit-and-workers-deploy>"
export ADMIN_PIN_HASHES="<from-secret-store>"

npx wrangler d1 migrations apply DB --remote
```

Notes:

- D1 applies each migration transactionally; a failure rolls back that file and
  leaves earlier migrations applied.
- Do **not** re-run, edit, reorder, or delete an applied migration.
- If `0035` applies, expect the admin-demotion statement and confirm the intended
  single admin afterwards.
- Never paste tokens or hashes into a shell that records history; use the
  secret store or a temporary, permission-restricted environment.

Immediately capture the command output (applied files and timings) in the
release ticket.

## 7. Post-migration verification — before deploying code

```sql
SELECT COUNT(*) AS admins FROM users WHERE role = 'admin';
SELECT username FROM users WHERE role = 'admin';
SELECT COUNT(*) FROM admin_devices;
SELECT COUNT(*) FROM admin_login_challenges;
SELECT name FROM pragma_table_info('content_publications');
SELECT COUNT(*) FROM content_publications;
SELECT COUNT(*) FROM giving_transactions;
SELECT COUNT(*) FROM giving_transaction_audit;
SELECT COUNT(*) FROM audit_log;
```

Compare `giving_transactions`, `giving_transaction_audit`, and
`content_publications` with the baselines from §4. Existing row counts must be
unchanged; new columns may be `NULL`.

```bash
npx wrangler d1 migrations list DB --remote
```

Expected: newest migration applied, no pending files.

## 8. Deploy the Worker and assets

### Preferred: CI release

1. Fix the `test:all` failure that stopped run #643.
2. Commit and push (or run the `Harvest Android APK Release` workflow via
   `workflow_dispatch`).
3. Watch these steps in order: lint → typecheck → test:all → audit → build →
   stage assets → signed APK → **Apply D1 migrations** → **Deploy Worker** →
   smoke → E2E → APK SHA checks → rollback drill.

The workflow stages `dist/` into `workers/public/`, writes
`workers/public/app-version.json`, and deploys with
`--var RELEASE_APK_FILENAME:<name>`. Do not bypass it for a normal release.

### Manual fallback (only if CI is unavailable)

From the repository root, after a successful `npm run build`:

```bash
rm -rf workers/public && mkdir -p workers/public
cp -r dist/. workers/public/
rm -f workers/public/_redirects workers/public/_headers
cp workers/downloads/harvest-family.apk workers/public/harvest-family.apk

# Keep the version manifest consistent with the APK you are shipping
cat workers/public/app-version.json    # inspect; do not hand-edit blindly

cd workers
npm ci
export CLOUDFLARE_ACCOUNT_ID="<account-id>"
export CLOUDFLARE_API_TOKEN="<token>"
export ADMIN_PIN_HASHES="<from-secret-store>"
npx wrangler deploy --var "RELEASE_APK_FILENAME:<current-apk-filename>"
```

Known blocker for a manual APK release: the currently advertised build (`1641`)
returns HTTP 404 at `/harvest-family.apk`, and the local APK signing key is not
available here. Manual deploy should not be used to work around that; resolve
the APK pipeline first (see §11).

## 9. Post-deploy verification

```bash
curl --fail --silent https://harvestfamily-api.harvestfamily.workers.dev/health
curl --fail --silent https://harvestfamily-api.harvestfamily.workers.dev/api/app-version
```

Then, in a browser/profile that is not the production admin's primary device:

- [ ] Sign in as a normal member; feed, Groups, Departments, Chat load.
- [ ] Sign in as `harvest_nyeri` on the bound browser; no unexpected challenge.
- [ ] Admin → Members renders promptly (this is the uncommitted local fix; only
      applicable if it is included in the release).
- [ ] Grant a test member **Create departments**; confirm the Departments create
      form appears for that account; revoke the grant afterwards.
- [ ] Admin still sees edit controls on every group/department.
- [ ] Giving ledger totals match the pre-release snapshot; a test correction is
      written to `giving_transaction_audit`.
- [ ] No 5xx spike in `npx wrangler tail` during the smoke window.

## 10. Rollback

**Bad Worker code, compatible schema**

```bash
cd workers
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Do not undo additive migrations for a code-only regression.

**Unsafe schema change or data loss**

1. Stop writes / announce maintenance.
2. Identify the recovery point (before the migration).
3. Prefer restoring the §5 export into a new D1 database, verify it, then switch
   the binding.
4. Use D1 Time Travel only as an emergency, in-place restore:

```bash
npx wrangler d1 time-travel info DB --timestamp="YYYY-MM-DDTHH:MM:SSZ"
npx wrangler d1 time-travel restore DB --timestamp="YYYY-MM-DDTHH:MM:SSZ"
```

5. Never delete rows from `d1_migrations` to force a re-run.

## 11. Open items / risks to decide before approving

1. ~~**`test:all` is red on `main`**~~ — resolved by `ae66e3e`; run #644 reached
   and passed migrations, deploy, and all post-deploy checks.
2. **Single-admin migration (`0035`)** demotes other admins. Confirm the intended
   account list before applying; this is not reversible by a code rollback.
3. **APK distribution is broken independently of D1**: the advertised build 1641
   returns 404 at `/harvest-family.apk`; the cached `workers/public` APK has a
   different signing certificate; no signing key or Android device is available
   locally. Do not couple a D1 migration to an APK fix.
4. **Uncommitted Members-tab fix** — decide whether it ships in this release,
   a follow-up release, or not at all.
5. **Backups** contain member PII and giving records; confirm storage location,
   encryption, access list, and retention before the export.
