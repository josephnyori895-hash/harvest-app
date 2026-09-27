# Harvest Family — Release Checklist (living document)

Derived from the original-scope production audit (2026-09-27). Rule: **an area
may never quietly move back to "assumed green."** Any change touching an area
must re-verify its row and update Status/Evidence here before the release is
called healthy. The APK-level release record lives in `release-ledger.md`.

## Status legend

- 🟢 verified with evidence (code + test/live check)
- 🟡 implemented, live verification pending (needs secrets / device / money rail)
- 🔴 broken or missing

## Audit-derived checklist

| Area | Status | Evidence (file / API / test / run) | Last fix |
|---|---|---|---|
| Signup | 🟢 | `src/lib/useCongregations.ts` → `/api/groups`; `App.jsx` register; live probe returned real groups | — |
| Groups data (canonical) | 🟢 | All pickers on `/api/groups` + `harvest:groups-changed`; `test-groups` ALL PASS | `103e9eb` creator_participation |
| Website | 🟢 | `GET /` serves app on worker origin; `/health` ok; no Netlify refs | — |
| Auth | 🟢 | Login/register verified locally + prod; rate limit + PBKDF2 in `lib/auth.js` | — |
| Groups API | 🟢 | `workers/scripts/test-groups.mjs` ALL PASS | `103e9eb` |
| Chat | 🟢 | Composer visualViewport; unread badge; retry errors; `test-social` pass | device QA pending (row below) |
| Departments | 🟢 | `test-social.mjs` pass; dept chat from Departments verified in code | — |
| Profiles | 🟢 | Map tap (`2cd1ffd`), Chat taps (`7cbe6bd`) | — |
| Stories | 🟢 | `test-video-story.mjs` 🟢 (thumb≠video, 206 playback, ring logic) | — |
| Posts / Reels | 🟢 | `test-posting-hardening`, `test-reels-regression`, `test-reel-preview` | — |
| Sermons | 🟢 | 2 GB / 5 GB contract tests; worker/client/background aligned | — |
| Give (UI/API) | 🟢 | typecheck green; M-Pesa contract tests pass | `9c5ce42` merge repair |
| M-Pesa live STK | 🟡 | Contract tests only — one controlled transaction pending (procedure below) | — |
| Admin | 🟢 | `test-admin-controls`; `requireAdmin` server-side on all admin routes | — |
| Notifications (registration) | 🟢 | Server lifecycle E2E (register/rotate/disable/delete/owner-scope) + client layer `src/lib/push.ts` wired to sign-in/sign-out | `1c204e9` client layer |
| Notifications (delivery) | 🟡 | `lib/fcm.js` + 5 contract tests; **live send needs Firebase secrets + device** | `e25515b` |
| Database / migrations | 🟢 | 30 migrations apply clean; single-source DDL | `5d52636` dedupe |
| Android / Release | 🟢 | Releases #519/#520: sign, verify, rollback drill, prod URL+SHA | device QA pending |
| CI/CD | 🟢 | Runs green incl. `test:notifications` | `e25515b` |
| Production | 🟢 | `/health` ok; `/api/app-version`; APK 200; CORS preflight correct | — |

## Remaining P1 gates before "original scope complete"

### Gate 1 — FCM live send (needs Firebase credentials)

**Engineering prerequisites — COMPLETE:**
- [x] Server delivery engine, dedupe, delivery log, cron GC (`e25515b`)
- [x] Client registration layer: token acquisition, sign-in registration, sign-out disable, tap routing (`1c204e9`)
- [x] `POST_NOTIFICATIONS` permission in manifest; conditional google-services plugin

**Remaining (human steps):**
1. Firebase console → project settings → service accounts → generate key JSON.
2. Place `google-services.json` at `android/app/google-services.json` (gitignored — never commit it).
3. `npx wrangler secret put FCM_SERVICE_ACCOUNT` (paste JSON);
   `npx wrangler secret put FCM_PROJECT_ID` (or rely on the JSON's project_id).
4. Enable: `npx wrangler secret put FCM_ENABLED` → `1` (kill switch stays off until then).
5. Deploy → install latest APK → sign in → accept the notification permission prompt →
   `POST /api/notifications/devices/test` → expect lockscreen notification.
6. Send a real DM from another account → notification tap must deep-link into
   that conversation; `GET /api/notifications/deliveries` shows `ok:1`.
7. Uninstall+reinstall app → resend → dead token is removed automatically
   (`invalid_tokens_removed: 1`) and the new token receives the push.
8. Record evidence: run number, test-send timestamp, delivery-log row.

### Gate 2 — Physical Android QA (matrix in `android-qa-matrix.md`)

Run the full matrix on a real device with the current production APK; record
build/run number and pass/fail per row. No redesign during QA — fixes only.

### Gate 3 — One controlled M-Pesa transaction

1. Pick a small live amount (e.g. KES 1) on the approved Safaricom shortcode.
2. Give → enter phone → STK push → enter PIN.
3. Verify, in order: callback received → `giving_transactions` row flips
   `pending → completed` with receipt number → if linked to a project, the
   `project_contributions` row exists exactly once → UI status updates via the
   poller without reload.
4. Duplicate-callback check: replay/duplicate the callback (or call the
   callback endpoint twice with the same payload) → the transaction must not
   double-credit; contribution count stays 1.
5. Record evidence: transaction ID, receipt number, callback timestamps.

## Final state definition

Original agreed scope complete → production behavior verified (gates 1–3) →
release artifact verified (`release-ledger.md`) → only then extras.

## Baseline rule for every subsequent release

This checklist is the **verification baseline**. It does not stay green by
assumption — any change **reopens exactly the gates it touches**:

| Change touches… | Gates/rows that must be re-verified before release |
|---|---|
| Any file under `src/` (UI) | Typecheck/lint/build + the matching QA-matrix sections on device |
| Chat, notifications, push | Row "Chat", "Notifications (registration/delivery)" + QA §3, §10 (tap routing) |
| Groups / signup | Rows "Signup", "Groups data", "Groups API" (`test-groups`) + QA §2, §7 |
| Media (posts/stories/reels/sermons) | Matching regression tests + QA §4–§6 |
| Give / M-Pesa | Giving contract tests + **Gate 3 replay check re-run** + QA §9 |
| Workers `routes/*` or `lib/*` | Full worker suite + affected row(s) |
| Migrations | Fresh-DB apply + prod migration step + "Database" row |
| Auth / session | Auth row + QA §2.5 (no cross-account leakage) |
| Android manifest / gradle / plugins | QA §1 (install-over-previous, signing continuity) |
| CI workflows | Observing one green run per workflow is not enough — verify the changed step actually executes |

A green CI run alone re-verifies nothing human-gated: device rows and the
M-Pesa replay check are only invalidated by changes that can affect them, but
they are only ever marked green by an actual recorded run.
