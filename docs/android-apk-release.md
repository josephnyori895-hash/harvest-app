# Harvest Family Android APK releases

The permanent download URL is:

https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk

## Automatic release flow

Every push to `main` starts `.github/workflows/android-release.yml`.

The workflow:

1. Installs the frontend dependencies.
2. Runs lint, typecheck, and the production web build.
3. Syncs Capacitor into Android.
4. Restores the protected release keystore from GitHub Actions secrets.
5. Builds a signed release APK.
6. Assigns a monotonically increasing `versionCode` from the workflow run number.
7. Copies the APK into `workers/downloads/harvest-family.apk`.
8. Deploys the Worker and static APK together with Wrangler.
9. Downloads the deployed APK and compares its SHA-256 checksum with the build.
10. Stores the APK as a short-lived GitHub Actions artifact.

Cloudflare Workers static assets are deployed together with the Worker, and the download headers in `workers/downloads/_headers` force the APK to revalidate instead of relying on a stale browser copy.

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

## Local release

For local releases, use:

```bash
./update-apk.sh --release
```

That path still builds and deploys locally. The CI workflow is the repeatable production path after pushes to `main`.

## Verification

After a successful release, download:

https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk

Then install it over the existing Harvest Family app. Confirm that Android recognizes it as an update rather than an unrelated installation.

For each release, record:

- Git commit SHA
- GitHub Actions run number
- Android versionName
- Android versionCode
- APK SHA-256
- Phone update/install result
