# Health check endpoints for the Harvest API worker

These exist so a load balancer or monitoring bot can tell whether the worker is alive without pretending to be a church member.

| Route | Method | Notes |
|---|---|---|
| `/api/health` | `GET` | Always returns `200` with `{ ok: true }`. No auth. |
| `/api/ready` | `GET` | Returns `200` only when the D1 + R2 bindings are reachable. Used by deploy health checks. |

Don't hit user-facing routes (`/api/feed`, `/api/users/map`, `/api/groups`, etc.) without a real JWT — those routes are locked to signed-in members by design.
