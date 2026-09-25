# Harvest Family App — Usability Audit

**Date:** 2026-09-25 · **Scope:** full member + admin journey on small Android screens (Capacitor WebView, Android 15 edge-to-edge).
**Method:** code review of every screen against mobile usability heuristics (thumb reach, safe areas, keyboard handling, error recovery, low-literacy copy), verified against the production API contract.

Severity: 🔴 blocks/loses member data or makes a core task impossible · 🟠 causes frequent friction or confusion · 🟡 polish; fix when touching the file.

---

## 🔴 Critical

### 1. Giving: amounts & phone number are accepted without validation
`src/components/Give.tsx` — the custom amount field accepts any numeric input, and the M-Pesa phone field is never format-checked.

- `0` and `1` KES pass the `>= 1` guard and trigger a real STK push that will fail at Safaricom, leaving a permanent "pending" row in the member's history.
- Phone `123` or a landline silently creates a doomed transaction — the member waits for an M-Pesa prompt that never arrives.

**Fix (client):** enforce `amount >= 10` (Daraja's practical minimum); validate phone against `/^(?:0|\+?254)?(7|1)\d{8}$/` and normalise to `2547…` before sending; show inline errors next to the field, not only a toast.
**Fix (server, `workers/src/routes/giving.js`):** re-validate both — never trust the client with money paths.

### 2. Give screen has no content-visibility feedback while `/api/content` loads
`Give.tsx` fetches `/api/content` without a loading state. On a slow connection members see the *default* funds, headline and paybill flash first, then swap. A member who taps "Tithe" in that window submits against a fund id that may no longer exist after the swap.

**Fix:** gate the give form on content load (skeleton), or at minimum disable the Give button until funds are resolved.

### 3. Registration auto-assigns GPS group even when the member picked a group by hand
`src/App.jsx` `submitRegister()` always sends lat/lng with the form. If the server is configured for location assignment, a member who explicitly chose "Harvest Ruringu" in the dropdown can still be placed elsewhere by the GPS match, and the success toast then contradicts the choice they made.

**Fix:** only include lat/lng in the payload when the member selected "auto/nearest" (or add an explicit "Place me in my nearest group" toggle next to the picker); server should honour an explicit `group_name` over location.

---

## 🟠 High

### 4. Registration never explains *why* it wants location
`getPosition()` runs silently before submit. If the browser/WebView prompts and the member declines, registration proceeds but group auto-assignment silently won't work, and the "You've been placed in your nearest group" toast may never fire. Members don't understand what location was for.

**Fix:** one line under the group picker — "We use your location once, only to suggest the group nearest to you." If GPS fails/declines, toast "Location skipped — choose your group below" so the state is never mysterious.

### 5. Sign-in error messages don't distinguish causes
`submitLogin()` maps every failure — wrong password, offline, server 500 — to "Sign in failed". Members on flaky Nyeri connections will retry forever against a dead network.

**Fix:** surface `(network)` vs `(credentials)` errors distinctly; offer "Try again" for network and "Reset via admin" hint for credentials (there is no self-service password reset — see #9).

### 6. Member directory can be enormous in the Admin accounts tab
`Admin.tsx` renders every member as a full DOM card with 6+ controls each. At 500+ members this will scroll-jank and drain battery on the admin's low-end phone.

**Fix:** paginate or virtualise the accounts list; the search box already exists — make results lazy (fetch on Enter) instead of client-side filtering everything.

### 7. Content fields give no character-count feedback *before* errors
`Admin.tsx` enforces `max` silently by slicing typed text (e.g. `hero_title` at 120). An admin pasting text sees it truncated with no warning. Contrast with `pastor_username` which now validates visibly.

**Fix:** show the `n/max` counter for every content field (it exists — `text-right mt-0.5` — but only renders for fields where content length ≠ 0; make it always render) and warn before slicing.

### 8. Stories reply bar can be double-tapped into a stuck state
`Stories.tsx` reply send button shows `…` while busy but isn't disabled; a double-tap fires two POSTs and can duplicate the reply.

**Fix:** `disabled={replyBusy}` on the send button (same pattern Chat already uses).

### 9. No self-service password reset
Nothing in the app or worker lets a member reset a forgotten PIN/password; the only path is physically finding an admin. For a church app this is a real adoption blocker after the first phone change.

**Fix (minimum):** "Forgot PIN?" → shows "Ask a church admin to reset it for you" with the admin's contact from the directory (better than nothing). Longer term: phone-OTP reset via the existing Africa's Talking integration.

### 10. Comments sheet header close-target is tiny and duplicated
`Comments.tsx` renders both a drag-handle bar and a small ✕ (28px) — the tap targets don't align, and tapping the handle does nothing. Below 44px target guidance.

**Fix:** make the whole header row tappable to close (with the handle as visual affordance), keep ✕ for clarity.

---

## 🟡 Medium

### 11. Search results show raw usernames as display names
`Search.tsx` renders `u.username` bold in member results but `u.name` in suggested members — inconsistent identity presentation in adjacent lists.

**Fix:** prefer `u.name || u.username` in both lists, keep @username as secondary line.

### 12. Explore grid tiles have no alt/fallback text for screen readers
Image tiles use empty `alt=""` (good for decorative), but the buttons lack `aria-label` describing the post — screen readers announce only "button".

**Fix:** `aria-label={\`Post by ${p.name || p.username}\`}`.

### 13. Give history shows raw status text
`capitalize` of `completed`/`pending`/`failed` is fine in English, but a failed row carries no recovery hint (member must guess what to do).

**Fix:** on `failed` rows show a "Tap to retry" action that pre-fills the same amount/purpose.

### 14. Admin giving ledger lacks empty state copy
When `adminData.transactions` is empty, the card renders nothing at all — admin can't tell loading from broken from genuinely empty.

**Fix:** mirror the member-side empty state ("No giving recorded yet").

### 15. Nav has 7 items; thumb-zone and crowding on 320dp screens
The bottom bar (`Nav`) renders 7 equal buttons; on narrow devices each drops below 44px width. The media query raises min-height but not per-item width.

**Fix:** consider collapsing to 5 visible items (home, search, post, chat, profile) with "More" opening activity/music/give/map; or reduce icon padding. Track: the current 7-item layout fits 360dp only because padding is tiny — real-world mis-taps likely.

### 16. Toast duration for errors is short
Several error toasts default to ~2.5s while success toasts get 4s. Errors need *more* reading time, not less.

**Fix:** invert the default (errors 4.5s+, success 2.5s).

### 17. Registration group dropdown shows stale congregations if `/api/groups` fails
`useCongregations` falls back to the five defaults silently. If the church renames/retires a congregation and the endpoint hiccups, new members see ghost options. The code comments acknowledge this trade-off.

**Fix:** when `live === false`, show a one-line notice above the picker: "Showing default groups — couldn't reach the latest list."

### 18. Welcome/onboarding carousel isn't skip-friendly for returning members
The onboarding copy assumes first-time users; a member reinstalling the app sees the full pitch again before login (minor, but adds friction to re-adoption).

**Fix:** if a `harvest_token` ever existed (even expired), default the auth screen to Sign in rather than Register, with a subtle "New here?" toggle (this partially exists — verify default mode is `login` on re-install).

---

## What's already strong (keep doing this)

- **Warm, consistent visual language** — the `#FFFBF0`/purple palette and rounded-card system are applied app-wide; screens feel like one product.
- **Offline tolerance everywhere** — fetch failures degrade to cached/default content rather than blank screens; drafts are kept on network failure in Comments.
- **44px touch targets on primary controls** — `touch-target`/`min-h-11` discipline in Chat, Stories, Comments.
- **Safe-area handling** is now systematic (`env(safe-area-inset-bottom)` padding on composer, comments, nav; `dvh` heights for chat viewport).
- **Server-backed realtime with graceful polling fallback** — unread badges keep working when WebSockets are flaky.
- **Admin destructive actions confirm first** — delete group/department/comment all guard with `window.confirm`.

---

## Suggested fix order (impact ÷ effort)

1. #1 Giving validation (client+server) — money path, small diff.
2. #3/#4 Registration GPS/group clarity — first-run experience for every new member.
3. #5 Sign-in error distinction — small diff, big support-ticket reduction.
4. #8 Stories double-send guard — one attribute.
5. #10 Comments header tap target — one layout change.
6. #15 Nav crowding — needs a design decision first.
7. #9 PIN reset — needs a product decision (OTP vs admin-assisted).
