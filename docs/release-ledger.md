# Harvest Family Release Ledger

This ledger distinguishes **committed code** from **code proven to be in a successfully deployed APK**.

## Release authority

A change is **released** only when all of these are true for the same commit/run:

1. CI validation passes.
2. Android release gates pass.
3. A signed APK is created and its signature is verified.
4. The versioned APK is deployed.
5. The versioned live APK SHA256 exactly matches the build SHA256.
6. The permanent APK URL exactly matches that SHA256 and expected filename/cache headers.
7. The rollback drill succeeds and the current release is restored.

A green commit or green CI run alone is **not** a release.

## Known-good baseline

| Release | Commit | Status | Evidence |
|---|---|---|---|
| #385 | `c72f8b30` | **PRODUCTION BASELINE** | Android release completed build, signing, deployment, live APK verification, permanent URL verification, rollback and artifact upload. |
| #494 | `0eef9cc` | **PRODUCTION (reference release)** | Full pipeline + deployment + verification on 2026-09-27. See release record below. Docs-only commits after this one trigger carry-forward release runs deploying the same app code; #494 remains the reference APK proof. |

## Recovery state — RESOLVED

The two batches below were **BLOCKED** by Android Release #407, which failed while building the signed APK because AndroidManifest.xml contained a literal escaped newline between activity attributes. Both were carried to production by **run #473** (`df8f2ba`, 2026-09-25), which completed the entire release pipeline.

| Commit | Change | Release status | Reason |
|---|---|---|---|
| `687e396f` | Merge PR #16: Groups/Departments/Chat management and pastor work | **RELEASED** (run #473) | Was BLOCKED by Android Release #407. Released 2026-09-25 by run #473. |
| `0bde6b98` | Repair malformed AndroidManifest.xml | **RELEASED** (run #473) | Fix verified in production by run #473. Its versioned APK has since aged out of the live asset set by design (only the current and previous releases are served), so live re-verification is no longer possible; the record relies on run #473's own gates. |

## Release records

### Run #494 — current production release (2026-09-27)

| Field | Value |
|---|---|
| Git commit SHA | `0eef9ccef89c80835e208b10782db53457aa5079` (`0eef9cc`) |
| Change | fix: parseable chat inbox JSX — lift fragile inline IIFE out of the ternary and realign the stale responsive test |
| Release run | #494 (ID `36315231579`), push to main, 2026-09-27T11:17:03Z |
| CI run | `harvest-ci` ID `36315231653` — pass (first green CI since 2026-09-25) |
| APK filename | `harvest-family-494-0eef9cc.apk` |
| APK SHA256 | `08e49cd65ac74bf18bdba0d50b77a89ea6006eb92145224f05e15228a201ef71` |
| APK size | 3,863,917 bytes |
| Deployed versioned URL | `https://harvestfamily-api.harvestfamily.workers.dev/harvest-family-494-0eef9cc.apk` |
| Permanent URL verification | PASS (workflow step 27). Independent re-check 2026-09-27: GET returns HTTP 200 with matching SHA256. Note: the route serves GET only — HEAD returns 404. |
| Previous verified release | Run #474, `harvest-family-474-fa6388c.apk` |
| Rollback SHA256 (previous) | `dede81a148d7303ae93fa0e9b1498ef308c4c26ce9dbdc47ae88b3259b9003a6` |
| Rollback drill | PASS (workflow step 28). Restoration SHA256: `08e49cd65ac74bf18bdba0d50b77a89ea6006eb92145224f05e15228a201ef71` — permanent URL restored to the run #494 APK. |
| Post-deploy smoke + E2E | Authenticated smoke test PASS; ImageAdjuster aspect ratios PASS; Departments member profile identity PASS (steps 23–25) |
| Artifact | `harvest-family-apk-494` uploaded (artifact ID `10930183334`) |

### Run #474 — previous verified release (2026-09-25)

| Field | Value |
|---|---|
| Git commit SHA | `fa6388c265ebe3b4e43296590e92738a3842232a` (`fa6388c`) |
| Release run | #474 (ID `36200712774`), 2026-09-25T23:21:49Z |
| APK filename | `harvest-family-474-fa6388c.apk` |
| APK SHA256 | `dede81a148d7303ae93fa0e9b1498ef308c4c26ce9dbdc47ae88b3259b9003a6` |
| APK size | 3,861,733 bytes |
| Status | Superseded by #494. Still served as the rollback target; re-verified live on 2026-09-27. |

## Rule for future work

Keep feature batches small. After each batch, record the commit SHA and release run. Do not start the next production batch until the previous batch has a successful APK proof. Docs-only commits to `main` still trigger a release run; such runs carry the last code-bearing APK unchanged.

## Machine-verifiable release record

Successful releases should expose, at minimum:

- Git commit SHA
- GitHub Actions run number and run ID
- APK filename
- APK SHA256
- APK size
- deployed versioned URL
- permanent URL verification result
- previous verified release and rollback SHA256
- restoration SHA256

## Audit records — 2026-11-12 (folded into the bug register)

Two read-only screen audits are no longer separate files. Both were folded into `docs/BUG-REGISTER.md` on 12 November 2026 and the originals deleted:

| Audit | Covered | Register rows | Outcome |
|---|---|---|---|
| Sign in / sign up | `Onboarding` in `src/App.jsx`, `src/lib/useCongregations.ts`, `workers/src/routes/auth.js` | `RS-201`–`RS-216` (A1–A16) | All fixed in `src/App.jsx` on 2026-11-12 |
| Home feed | `src/components/Home.tsx`, `src/lib/api.ts`, `/api/feed` | `RS-217`–`RS-229` (H1–H13) | Fixed 2026-11-13 in `Home.tsx` + `api.ts`; pinned by `scripts/test-home-feed-contracts.mjs` (13/13, in `test:all`). Device-only checks (H9 target size, H11 ticker, H8 overlay gesture) still need REP-DEVICE |

Neither audit ran a browser or Android pass; findings are code review plus curl against the local Worker. **No release implication:** this records committed source, not code proven in a deployed APK, so the release authority rules above are unchanged.

## Unreleased batch — 2026-11-24 (reliability + Giving administration)

Committed locally on `main`; not pushed and not deployed. Recorded here so the next release run can be reconciled against it.

| Item | State |
|---|---|
| Source HEAD | `7d1dce8` (3 commits ahead of `origin/main` = `ce1cee4`, 6 Nov) |
| Working tree | 50 files + this batch's new work (see the register rows RS-230–RS-238) |
| Live deployment at time of audit | version `1.0.641` / versionCode `1641`, CI run #641 (built from `ce1cee4`) |
| Live asset | `assets/index-QheDy9j7.js` — different from the committed `workers/public` build (Oct 29) |
| Gates run locally | test:all 28 steps, typecheck, lint, build, workers notifications — results in the batch report |
| Giving payments | still manual; no Daraja configuration changed, no live payment destination changed |
| Migrations added | `0034_giving_admin_audit.sql` (additive columns + `giving_transaction_audit`) |
| Releases since | none: a release requires a push to `main`, which needs client approval |

The installed Android app runs the JS bundled in its APK, so none of this reaches phones until a new APK is built and installed, even though the Worker hosts the web app.
