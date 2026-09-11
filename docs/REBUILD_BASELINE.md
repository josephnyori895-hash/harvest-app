# Rebuild baseline — M0

## Scope

This document is the baseline for the M0 stabilization milestone. It separates prototype behavior from production requirements so later milestones can remove the prototype adapters without silently changing security assumptions.

## Current architecture

- Frontend: React + Vite + Tailwind, with Capacitor Android packaging.
- Backend: Node.js service under `server/` with Socket.IO and media routes.
- Frontend API access is centralized in `src/lib/api.ts` and selected with `VITE_USE_API`.
- The demo adapter still uses browser localStorage for users, content queues and other prototype state.
- API mode is the migration path for server-backed authentication and media.

## Data/auth classification

| Area | Current prototype source | Production source | Target milestone |
| --- | --- | --- | --- |
| Identity and role | localStorage + backend bridge | server session + database | M2 |
| Feed/posts | localStorage/demo data | database + API | M3/M5 |
| Approval/moderation | localStorage queue | database + server authorization | M3/M4/M5 |
| Groups | frontend state/demo data | database + API | M3/M5 |
| Chat | frontend state/Socket.IO bridge | persisted messages + authenticated realtime | M3/M6 |
| Media | browser/demo URLs + media API | controlled object storage + media records | M3/M4/M5 |
| Giving | frontend feature flow | payment provider + server reconciliation | M5 |
| Location | demo coordinates | privacy-controlled approximate location | M4/M5 |

## M0 risks carried forward

1. The demo/localStorage adapter is not a security boundary and must not be used as production authorization or persistence.
2. Long-lived frontend bearer tokens are an interim migration mechanism; M2 must replace them with a secure server session strategy.
3. Camera/microphone access must be requested only from an explicit call/recording action, not during application startup.
4. Production media must not depend on third-party demo URLs; M3–M5 must move media metadata and storage behind the backend.
5. Precise location must remain unavailable to unauthorized users; M4 defines the final privacy model.

## Verification commands

```text
npm install
npm run lint
npm run build
node --check server/src/index.js
node --check server/src/middleware/auth.js
node --check server/src/routes/media.js
node --test server/src/realtime/socketSecurity.test.js
```

GitHub Actions is the authoritative CI result for pull requests. M7 will add the full unit/integration/E2E quality gates.
