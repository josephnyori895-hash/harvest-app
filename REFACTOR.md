# Harvest Family — Rebuild Notes

This file records the architecture and bug-fix history that led to the current rebuild. It is historical documentation, not a source of authentication credentials or runtime configuration.

## Completed prototype refactor

- Split the original `src/App.jsx` monolith into feature components under `src/components/` and shared auth helpers under `src/state/`.
- Added `RequireRole` protection around admin-only UI.
- Fixed story/reel indexing drift, follow wiring, like persistence, Leaflet marker configuration, and approximate-location gating.
- Added a centralized API client at `src/lib/api.ts` and backend authentication integration behind `VITE_USE_API`.
- Disabled client-side account switching while API mode is enabled.
- Hardened backend CORS and server-side admin-role checks.

## Important migration notes

The original prototype used localStorage-backed users, roles, approval queues, media and demo credentials. Those mechanisms are retained only where the demo adapter still needs them and **must not be treated as production authorization or persistence**.

Production migration targets are tracked in GitHub issues M0–M10, especially:

- M1 — frontend architecture and data boundaries
- M2 — production authentication and server authorization
- M3 — database-backed persistence and APIs
- M4 — security, privacy and abuse prevention
- M7 — automated regression/security testing

## Verification baseline

GitHub Actions is the source of truth for branch validation. Local build results from the original prototype are retained here only as historical context; do not infer production readiness from them.
