#!/usr/bin/env bash
# One deploy path for the web app and worker.
#
# `rsync` alone never removes the previous build's hashed chunks, so every
# release left another Admin-*.js / HarvestMap-*.js behind (256 files, 21 MB).
# assets/ is pure build output, so it is replaced wholesale; everything else in
# workers/public/ (APK, landing photos, fonts) is left untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_OPTIONS="--dns-result-order=ipv4first ${NODE_OPTIONS:-}"

npm run build
rm -rf workers/public/assets
rsync -a dist/ workers/public/
rm -f workers/public/_redirects

# Schema before code: deploying worker code that expects a migration which was
# never applied is how signup started returning 500 in production.
( cd workers && npx wrangler d1 migrations apply DB --remote && npx wrangler deploy )

# The worker's committed index.html is the stable entry point for the deployed
# site; the local build's copy is not committed.
git checkout -- workers/public/index.html
