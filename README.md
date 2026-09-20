# Harvest Family Church — Nyeri

Harvest Family is a mobile-first church community app for Harvest Family Church Nyeri.

## Production architecture

- **Android app:** React 19 + Vite + Capacitor 8
- **API:** Cloudflare Workers
- **Database:** Cloudflare D1
- **Media:** Cloudflare R2
- **Realtime:** Durable Objects + WebSockets
- **Payments:** M-Pesa Daraja integration
- **Production APK:** built and signed by GitHub Actions, then served from the Worker

The production API is:

`https://harvestfamily-api.harvestfamily.workers.dev`

The permanent APK download endpoint is:

`https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk`

Cloudflare recommends using a custom domain/route rather than a `workers.dev` hostname for business-critical production workloads; the current `workers.dev` URL is retained as the immediately shareable release URL. citeturn2search0

## Production gates

Every main-branch release now requires:

1. Frontend lint and TypeScript checks.
2. Frontend admin/security contract tests.
3. High-severity dependency audit.
4. Production frontend build.
5. Capacitor Android sync and signed release APK build.
6. APK signature verification.
7. Remote D1 migrations.
8. Cloudflare Worker deployment.
9. Authenticated production smoke checks.
10. SHA-256 verification that the live APK exactly matches the signed build artifact.

GitHub Actions also runs the worker syntax checks, media-upload contract test, Wrangler dry-run, and D1 migration parsing on CI.

Production deployment uses the GitHub `production` environment and a serialized deployment concurrency group. GitHub environments can be used to restrict production deployment access and protect secrets. citeturn0search0turn0search1

## Local development

```bash
npm ci
npm run dev

npm run lint
npm run typecheck
npm run test:all
npm run build

npm ci --prefix workers
npm run test:media --prefix workers
```

For local backend development:

```bash
cd workers
npm install
npm run dev
```

Never commit production secrets.

## Production configuration

Frontend production configuration is injected by the release workflow:

- `VITE_API_URL=https://harvestfamily-api.harvestfamily.workers.dev`

Worker secrets are supplied through Cloudflare/GitHub secret management, not source control. The production release requires at minimum the JWT, Cloudflare deployment, Android signing, admin bootstrap, and E2E smoke-test credentials configured in the appropriate secret stores.

## Database recovery

Cloudflare D1 provides built-in Time Travel point-in-time recovery. Current Cloudflare documentation states that production D1 databases can be restored to a point within the supported retention window, so rollback procedures should use Time Travel rather than destructive ad-hoc SQL. citeturn3search0

## Realtime

The Worker exposes authenticated WebSocket realtime transport for chat, presence, typing, and call signaling. Conversation membership and recipient authorization are rechecked server-side.

WebRTC calls may still depend on a TURN service on restrictive mobile networks. STUN-only operation is not treated as a guaranteed universal calling path; configure a production TURN service before advertising calls as universally reliable.

## Release / rollback

Do not distribute an APK until the latest main-branch release workflow is green.

For an application-code rollback:

1. Identify the last known-good commit.
2. Revert or deploy that commit through the normal protected production workflow.
3. Do **not** manually edit production D1 schema to reverse a migration.
4. If a database state must be restored, use D1 Time Travel after confirming the required recovery point.
5. Re-run the authenticated production smoke test and live APK SHA verification.

See `docs/PRODUCTION_RELEASE.md` for the operator checklist.

## Security

- JWT configuration fails closed when the production secret is missing or too short.
- CORS uses an explicit origin allowlist.
- Realtime frames are size- and rate-limited.
- Protected operations re-check the authenticated account and resource membership.
- Production credentials are not intended to be stored in the repository.
- CI blocks high-severity dependency vulnerabilities.

## Church release link

Share this APK URL with church members:

`https://harvestfamily-api.harvestfamily.workers.dev/harvest-family.apk`

After installation, members should sign in using their own church account. Never share an administrator PIN publicly.

---

Harvest Family Church Nyeri • 2026
