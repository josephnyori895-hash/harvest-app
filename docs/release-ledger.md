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

## Current recovery state

| Commit | Change | Release status | Reason |
|---|---|---|---|
| `687e396f` | Merge PR #16: Groups/Departments/Chat management and pastor work | **BLOCKED** | Android Release #407 failed while building the signed APK because AndroidManifest.xml contained a literal escaped newline between activity attributes. |
| `0bde6b98` | Repair malformed AndroidManifest.xml | **AWAITING RELEASE** | Fix committed to `main`; must pass the complete release pipeline before being called production. |

## Rule for future work

Keep feature batches small. After each batch, record the commit SHA and release run. Do not start the next production batch until the previous batch has a successful APK proof.

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

