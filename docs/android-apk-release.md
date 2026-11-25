# Harvest Family Android APK releases

The permanent download URL is:

https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk

## Automatic release flow

Every push to `main` starts `.github/workflows/android-release.yml`.

The workflow:

1. Installs the frontend dependencies.
2. Runs lint, typecheck, the test suite, and the production web build.
3. Stages the web app into `workers/public`.
4. Syncs Capacitor into Android.
5. Restores the protected release keystore from GitHub Actions secrets.
6. Builds and verifies a signed release APK.
7. Assigns a monotonically increasing `versionCode` from the workflow run number.
8. Stores the signed APK as an immutable `harvest-family-<run>-<sha>.apk` and also replaces the permanent `workers/public/harvest-family.apk`.
9. Writes `workers/public/app-version.json` with the version, permanent download URL, and SHA-256 of the exact signed APK being deployed.
10. Deploys the Worker and assets together with Wrangler.
11. Runs the production smoke test: manifest shape, deployed APK digest, and a `Range: bytes=100-199` request that must return `206`.

The Worker handles Range requests itself. Cloudflare Workers static assets answer Range requests with the full file and a `200`, so forwarding them directly would silently disable resumable downloads. The Worker slices the APK and returns `206 Partial Content`.

## Making a release

Normal path: merge to `main`. The workflow builds, signs, deploys, and verifies the update automatically. No manual `wrangler deploy` is needed.

Local fallback:

```bash
./update-apk.sh --release
```

The local script builds, syncs Capacitor, deploys the Worker and APK, and verifies both the live SHA-256 and a real `206` Range response. Do not deploy `workers/public` with a plain `wrangler deploy` after a release; that can drop `RELEASE_APK_FILENAME` and serve an asset set that no longer matches the manifest.

## Required one-time GitHub secrets

Add these under **Repository → Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The Cloudflare token should be limited to the Worker deployment permissions needed for this repository. The Android keystore must be the same signing key used by the APK already installed on users' phones; Android requires a compatible signing key for an APK update.

Never commit the keystore or `android/keystore.properties`.

## Verification

After a successful release, download:

https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk

Confirm the served bytes match the manifest:

```bash
curl -fsSL https://harvestfamily-api.harvestfamily.workers.dev/api/app-version
curl -fsSL https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk | sha256sum
curl -fsSL -D - -o /dev/null -H 'Range: bytes=100-199' \
  https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk
```

The last request must answer `206`, include `Content-Range: bytes 100-199/<size>`, and return exactly 100 bytes. A `200` means resumable updates are broken.

Then install the APK over the existing Harvest Family app. Confirm that Android recognizes it as an update rather than an unrelated installation.

For each release, record:

- Git commit SHA
- GitHub Actions run number
- Android versionName
- Android versionCode
- APK SHA-256
- Phone update/install result
