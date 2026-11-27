# Android QA Matrix — physical device release verification

Run against the **current production APK** (`/harvest-family.apk`, version from
`/api/app-version`). This is release verification, not a redesign pass: record
failures, fix minimally, re-run only the failed rows.

- Device used: ______________  Android version: ______  Date: ______
- APK versionCode/Name: ______ (must match `/api/app-version`)  Build/run: ______
- Tester: ______

Legend: ✅ pass · ❌ fail (note the row ID + symptom) · ◑ partial (note what was covered) · N/A with reason

**Two different columns, never conflated.** *Device result* is the only one
that counts for release: it is filled by a human on the physical APK. The
*Emulated* column comes from `scripts/qa-android-notifications.mjs` — headless
Chromium at 320 / 360 / 390 px against a local worker and local D1. It catches
layout, target-size and state bugs early, but it cannot see real insets, the
soft keyboard, push delivery, or an installed APK. A ✅ there is **not** a
device pass.

```bash
# worker: cd workers && npx wrangler dev --port 8787
# app:    E2E_API_TARGET=http://127.0.0.1:8787 npx vite --port 5273
E2E_BASE_URL=http://127.0.0.1:5273 E2E_USERNAME=<member> E2E_PASSWORD=<pw> \
E2E_CHROME_PATH=/usr/bin/chromium node scripts/qa-android-notifications.mjs
```

Last emulated run: 2026-11-11, 30 notification rows (21 unread), 800 px tall
viewport. Result: 8/8 checks green at each of 320 / 360 / 390 px, no failures.

## 1. Install & identity

| # | Check | Result | Notes |
|---|---|---|---|
| 1.1 | APK installs over the previous release **without uninstalling** (signing continuity) | | |
| 1.2 | App opens; version shown matches `/api/app-version` | | |
| 1.3 | Update prompt appears when a newer release exists; "Later" quiets it for 1h in-session and it returns on the next app open | | |

## 2. Auth lifecycle

| # | Check | Result | Notes |
|---|---|---|---|
| 2.1 | Signup with hand-picked congregation completes; group matches selection | | |
| 2.2 | Signup picker lists live groups only (create/delete a test group as admin → reflected) | | |
| 2.3 | Login with valid credentials; wrong password shows credential error (not network error) | | |
| 2.4 | Airplane mode → app shows network-kind error, not a crash | | |
| 2.5 | Logout → sign in as a different member → **no data leaks** from the previous account (feed/chat/unread) | | |
| 2.6 | App restart restores the session without re-login | | |

## 3. Chat

| # | Check | Result | Notes |
|---|---|---|---|
| 3.1 | Composer stays visible **above the keyboard** in all chat screens (DM, group, department) | | |
| 3.2 | Sending → sent (✓) → delivered/seen (✓✓) states render | | |
| 3.3 | Kill network mid-send → failed ( ! ) → Retry succeeds when network returns | | |
| 3.4 | Message history loads; pagination on scroll up | | |
| 3.5 | Unread badges: 0 → none, 1–9 exact, 10–99 exact, 100+ → `99+`, no layout overflow | | |
| 3.6 | Photo message: pick → send → renders on both sides | | |
| 3.7 | Reply, reactions, long-press actions work | | |
| 3.8 | Presence row / online dot reflects the peer's state | | |
| 3.9 | Inbox search filters; empty search shows the "no conversations match" state | | |
| 3.10 | Profile navigation: tap conversation avatar/row → opens that member's profile | | |

## 4. Stories

| # | Check | Result | Notes |
|---|---|---|---|
| 4.1 | Creation: capture/gallery → post → appears in rings | | |
| 4.2 | Viewer: safe areas respected (no content under camera cutout/nav bar) | | |
| 4.3 | Tap-left/right navigation; swipe-down dismiss | | |
| 4.4 | Video story: plays with 🎥 tile thumb, no gray frame | | |
| 4.5 | Expired story (>24h) disappears | | |
| 4.6 | Ring → story → member profile → back navigation is coherent | | |

## 5. Reels

| # | Check | Result | Notes |
|---|---|---|---|
| 5.1 | Full-screen vertical swipe; snap-to-item | | |
| 5.2 | Play/pause on tap; mute toggle works | | |
| 5.3 | Like + comments open/close without blocking the video | | |
| 5.4 | Caption readable over gradient; not clipped at 320px width | | |
| 5.5 | Broken/slow media shows placeholder, not a blank screen | | |

## 6. Feed / posts / media

| # | Check | Result | Notes |
|---|---|---|---|
| 6.1 | Feed loads on cellular; pull-to-refresh works | | |
| 6.2 | Photo post: pick → upload with progress → publishes (no "Internal server error") | | |
| 6.3 | Video post: pick → cover frame → Done → publish → plays in feed | | |
| 6.4 | Flyer/image viewer: pinch-zoom in AND back out, no over-zoom jump | | |
| 6.5 | Like/comment optimistic updates; failed like rolls back | | |
| 6.6 | Slow-network: media loads progressively, no infinite spinner | | |

## 7. Groups / Departments

| # | Check | Result | Notes |
|---|---|---|---|
| 7.1 | Group list, detail, members render; join/request flow on invite-only group | | |
| 7.2 | Department chat opens **from the Departments screen** (not only Chats) | | |
| 7.3 | Group chat opens from Groups; both use the same composer pattern | | |
| 7.4 | Admin creates/renames/deletes a group → all screens reflect it (incl. signup on a fresh device/browser) | | |
| 7.5 | Department edit form: keyboard doesn't cover the save button; scrolling works | | |

## 8. Map / location

| # | Check | Result | Notes |
|---|---|---|---|
| 8.1 | First open → permission prompt; deny → inline error (no browser alert), map still usable | | |
| 8.2 | Grant → own marker appears; approximate markers stable (reopen: same approx positions) | | |
| 8.3 | Group filter changes the **markers**, not just the list | | |
| 8.4 | Map auto-fits displayed members | | |
| 8.5 | Tap member → profile opens | | |
| 8.6 | Freshness label ("2h ago") renders; hidden members show "Approx." | | |

## 9. Give

| # | Check | Result | Notes |
|---|---|---|---|
| 9.1 | Whole-shilling validation; phone format errors are inline | | |
| 9.2 | STK push fires (or the Paybill fallback shows if not enabled) | | |
| 9.3 | Pending → completed status updates via poller without reload | | |
| 9.4 | Project commitment saves; progress updates | | |

## 10. Notifications

| # | Check | Device result | Notes | Emulated (Chromium)* |
|---|---|---|---|---|
| 10.1 | Bell + unread badge render; rows don't overflow at 320px | | | ✅ bell 44×44 with badge; label `Notifications, N unread`; drawer is a floating 400 px card (296 / 336 / 366 px wide at 320 / 360 / 390, 12 px inset, top 56 px below the bell) — never fullscreen; 30 rows, zero row or panel overflow |
| 10.2 | Filters stay on one line, scroll horizontally only | | | ✅ all five tabs on one line at 320 / 360 / 390 |
| 10.3 | Mark one/all read updates optimistically; rollback on failure | | | ✅ 21 unread → 0 immediately; forced `read-all` failure restored 21 and showed the error banner; a successful retry cleared the badge and hid the mark-all control |
| 10.4 | (After Gate 1) test push arrives; tap deep-links to the right screen | | | — device only |
| 10.5 | (After Gate 1) chat push tap opens that conversation | | | — device only |

## 11. Cross-cutting

| # | Check | Device result | Notes | Emulated (Chromium)* |
|---|---|---|---|---|
| 11.1 | No horizontal overflow at 320 / 360 / 390 px on: Home, Chat, Notifications, Comments, Groups settings | | | ◑ Home and Notifications clean at all three widths (page and panel overflow 0); Chat / Comments / Groups settings not measured |
| 11.2 | Bottom nav never overlaps Comments composer or chat input | | | — needs a live conversation; not measured |
| 11.3 | Rotation/re-entry doesn't crash; insets correct after orientation change | | | — device only |
| 11.4 | Offline → recovery: screens show retry, data reloads when back online | | | ◑ notifications: offline shows "Couldn't refresh notifications. Retry"; reconnect + Retry restores all 30 rows. Other screens not measured |
| 11.5 | Accessibility: bell, badges, retry buttons, filters have labels; touch targets ≥ 40px | | | ✅ bell 44×44 with name + expanded state; badge is aria-hidden (count spoken once by the bell); Back and mark-all 40×40 and labelled; five filter tabs 40 px tall; drawer is aria-modal with focus moved inside |

## Sign-off

- All rows ✅ (or N/A with reason) → release verified for original scope.
- Any ❌ → fix minimally, re-run that section, append note + commit/run here.

Pre-flight fixes found during the emulated run (2026-11-11), worth a glance on
device: the notification drawer, the DM card, the update banner, the mini
player and the Groups/Departments detail padding all carried a `calc()` inside
a Tailwind arbitrary class **with literal spaces**, so the class never compiled
and the element fell back to its static position — the drawer and DM card were
painting at `top: 0`, over the bell. Fixed in `App.jsx`, `Music.tsx`,
`Groups.tsx`, `Departments.tsx`.

Card sizes after the phone-viewport review: notification drawer 400 px
(`min(58dvh, 400px)`), chat card 380 px (`min(56dvh, 380px)`), both anchored
56 px below the bell with a 12 px inset. The chat card also renders the Chat
panel in `compact` mode — no "Harvest Family" eyebrow, no community/avatar
rails — because that header stack used 314 px of the card on its own and left
no room for a single conversation row. Watch the chat card on device with a
populated inbox and with the soft keyboard up (11.2, 11.3).

| Section | Result | Re-run after fix (commit) |
|---|---|---|
| 1–2 | | |
| 3 | | |
| 4–5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
