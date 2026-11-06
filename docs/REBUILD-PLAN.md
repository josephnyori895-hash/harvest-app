> **Status:** `server/` is retired — it is an empty directory. The live backend is the Cloudflare Worker in `workers/` (see `workers/wrangler.toml`). Any `server/...` path below is historical, not a file you can edit.

# Harvest Family — Rebuild / Improve Task List

Date: 3 November 2026. Author: Codebuff (local agent), read-only audit of the checkout at
`main` + uncommitted working tree. Every number below was measured, not estimated; the
command that reproduces it is in the appendix.

Two rules for this list:

1. **A task is done when its acceptance check passes**, not when the code is written.
2. **No task changes behaviour silently.** Functional tasks (FN-*) land with a regression
   test in `scripts/`, per `docs/BUG-REGISTER.md` policy.

Sizes: `S` ≤ half a day · `M` 1–2 days · `L` 3+ days (one person, including verification).

---

## Correction to my first read

I earlier described the authenticated app as "one fixed 460 px column". That is wrong.
`max-w-[460px]` (`src/App.jsx:707`) is the **onboarding/sign-in** form. The
authenticated shell is fluid (`app-shell w-full h-[100dvh]`). The desktop problem is not a
narrow wrapper — it is that **there is no desktop layout at all**: navigation is a fixed
bottom bar and 32 of 39 components contain no breakpoint class.

---

## A. Frontend surface (FE)

| ID | Area | Measured problem | Size | Acceptance check |
|----|------|------------------|------|------------------|
| FE-01 | Design tokens | 1,133 hardcoded colour utilities (`bg-/text-/border-[#…]`); the `harvest` palette declared in `tailwind.config.js` is referenced **0** times; `src/index.css` hardcodes 9 more hexes. | L | Semantic tokens (surface / ink / accent / success / warn / danger + 3 elevations); hex utilities in `src` → 0 except tokens; enforced by a grep gate in `ci.yml`. |
| FE-02 | Typography | `text-[10px]` ×170, `text-[9px]` ×26, `text-[11px]` ×136, `text-[13px]` ×16, `text-[12px]` ×3 — no scale; body is forced to 16 px only below 640 px. | M | 7-step fluid scale as tokens; no UI label below 12 px; Home/Settings visually checked at 390 / 768 / 1440. |
| FE-03 | Icon system | 413 emoji glyphs used as UI (`🔔📍✏️🛡🔖🎥`); `IgIcon` (`App.jsx:112`) is 17 lines covering 7 icons for 7 nav tabs and 36 components. | M | One icon component + curated set (SVG sprite or icon package); emoji survive only in prose/test data. |
| FE-04 | Primitives | 18 hand-rolled `fixed inset-0` overlays; `.btn-*` / `.input-*` matched 7× exactly; 39 inline `style={{}}`; `Toast.tsx` is the only real primitive. | L | `Button / Input / Select / Textarea / Card / Badge / Dialog / Sheet / EmptyState / Skeleton` under `src/ui/`; screens compose them; `fixed inset-0` only inside Dialog. |
| FE-05 | Desktop layout | 32 of 39 JSX/TSX files have **no** breakpoint class (`sm:` 24, `md:` 3, `lg:` 1, `xl:` 0); navigation is a fixed bottom bar (`App.jsx`, `Nav`); no sidebar component exists. | L | ≥1024 px: persistent sidebar + content column with per-screen max-width; <768 px unchanged; two-column Home / Chat / Give / Admin. |
| FE-06 | Native dialogs | 18 `window.confirm`, 2 `window.prompt`, 1 `alert` (admin verify in `App.jsx`). | S | Confirm/Prompt primitives with focus trap + Esc; `window.confirm|prompt|alert` count → 0. |
| FE-07 | Navigation | `tab` state machine inside `App.jsx` (1,194 lines) for 7 tabs; 3 `location.href` and 2 `location.reload` force full page loads (e.g. saved-reel open). | M | URL-addressable navigation (router or hardened machine) with Android back preserved; no in-app link triggers a reload. |
| FE-08 | Dark mode | 0 `dark:` utilities; `:root { color-scheme: light }`. | M | Token-driven light/dark with system preference + manual override. |
| FE-09 | Motion | 2 Tailwind keyframes + an `hf-create-*` set; `prefers-reduced-motion` handled only for the create flow. | S | One duration/easing scale; reduced-motion guard applied globally. |
| FE-10 | Data layer | 142 raw `fetch(` in `src` vs 23 helpers in `lib/api.ts`; 301 `: any`, 30 `as any`; revalidation logic duplicated per screen (4 separate `visibilitychange` handlers). | L | Typed client + server-state layer (cache / revalidate / retry); `: any` in `src` < 50; stale-signed-URL policy owned in one place. |
| FE-11 | Monoliths | `Chat.tsx` 1,255 · `App.jsx` 1,194 · `Admin.tsx` 899 · `Home.tsx` 739 · `Reels.tsx` 679; 11,841 lines across 39 files. | L | Each screen ≤400 lines with logic in hooks; `test:all` unchanged. |
| FE-12 | Accessibility | All 34 `<img>` have `alt` (good); one global focus ring; 251 aria attributes; no skip-link, no landmark roles, heading order unverified. | M | Axe clean on Home / Chat / Give / Settings; skip-link + landmarks; keyboard-only pass. |
| FE-13 | Performance | Build: `index` 878 KB, `vendor` 498 KB, `leaflet` 242 KB, CSS 112 KB; `loading="lazy"` in only 11 places; Leaflet imported eagerly at `App.jsx:3`. | M | Screen-level code splitting, map lazy-loaded, feed virtualised; LCP/TBT measured before and after and reported. |
| FE-14 | Strings | English and Swahili mixed inline (`Karibu`, `Asante sana`, `Ushirika`), no catalogue. | S | String catalogue + locale switch, or an explicit decision to ship EN-only with the SW fragments removed. |
| FE-15 | Web metadata | No `manifest.webmanifest`; `theme-color` `#1E3A8A` (blue) contradicts the cream/purple brand; no description/OG tags. | S | Manifest + icons + brand colour; OG/Twitter tags; installability check on Android + desktop. |

## B. Functionality (FN)

| ID | Problem | Size | Acceptance check |
|----|---------|------|------------------|
| FN-01 | **RS-104 residual** — stale signed media on tab return is handled only in `Home` (≥9 min rule). Reels and Sermons still render expired URLs. | S | Same rule behind one shared hook; regression test in `test-reliability-refresh.mjs`. |
| FN-02 | **RS-107** — double M-Pesa submission unproven: no evidence of client disable on slow networks, none of server idempotency. | M | Server-side idempotency key + unique constraint; test proves one STK per submit. |
| FN-03 | **RS-121** — chat presign takes an idempotency key (working tree) but the worker's acceptance and uniqueness are unverified. | S | Worker stores/rejects on key; test covers double submit. |
| FN-04 | **RS-122** — attachment chip is cleared before the upload is confirmed, so a failed send loses the file from the composer. | S | File survives a failed send until confirm fails terminally. |
| FN-05 | Working tree uncommitted: `PostCreate.tsx`, `Sermons.tsx`, `Chat.tsx`, `backgroundUploads.ts`, `test-reliability-refresh.mjs`, `package.json` (RS-101…104, RS-120…122). | S | One reviewable commit; `test:reliability` green before and after. |
| FN-06 | Offline: uploads queue in IndexedDB (good) but there is no app-shell cache and chat has no outbox. | M | App loads offline; queued chat messages flush on reconnect. |
| FN-07 | Empty / error / loading states differ per screen; no shared pattern (feeds FE-04). | M | One EmptyState/ErrorState/Skeleton trio used by every list screen. |

## C. Backend (BE)

| ID | Problem | Size | Acceptance check |
|----|---------|------|------------------|
| BE-01 | 36 migrations with **5 duplicated numeric prefixes** (`0002_`, `0009_`, `0018_`, `0019_`, `0022_`), so apply order depends on filesystem sorting. | M | Renumbered/renamed with an applied-order table; fresh-DB rebuild equals production schema. |
| BE-02 | Test strategy is largely structural: 13 of 16 suites assert against source regex, not behaviour. 53 endpoints have no integration coverage. | L | Local-D1 integration suite covering auth, feed, chat, giving, media; contract regexes kept only as lint. |
| BE-03 | Observability: 1 `console.log` in `workers/src`; no structured logs, no error sink, no uptime probe. | M | Request/error logs with IDs, an error sink, and an external uptime check. |
| BE-04 | WebRTC is STUN-only (acknowledged in README) — calls fail on restrictive mobile networks. | M | TURN configured and a call tested on mobile data. |
| BE-05 | Idempotency and HTTP rate limiting: media has keys, chat/giving do not; per-IP/per-user limits unverified. | M | Idempotency on money and message writes; documented rate limits with tests. |
| BE-06 | Config: secrets are in wrangler/GitHub stores (correct) but fail-closed JWT/CORS behaviour is asserted in docs, not tests. | S | Tests cover missing/short `JWT_SECRET` and disallowed origins. |

## D. Ops / release (OP)

| ID | Problem | Size | Acceptance check |
|----|---------|------|------------------|
| OP-01 | `[assets] directory = "./public"` means every deploy replaces the whole site atomically with whatever was built — no staging environment. | M | Versions/preview deploy + smoke gate before promotion. |
| OP-02 | The APK ships twice in `workers/public` (`harvest-family.apk` and `harvest-family-263-b418492.apk`, 3.7 MB each). | S | One canonical artifact + redirect; deploy size drops ~3.7 MB. |
| OP-03 | Production runs on `workers.dev` (README notes Cloudflare's own guidance against it). | S | Custom domain with the workers.dev URL redirecting. |
| OP-04 | Docs drift: `REFACTOR.md` describes an IG-dark UI and a ~310-line `App.jsx` (now cream/purple, 1,194 lines); `AUDIT_2026-10-29.md` says Activity+Notifications are unmerged, but `b5bc99b` merged them. | S | Stale docs marked historical; one current architecture doc. |
| OP-05 | Build artifacts in-tree: `dist/`, three different bundles under `workers/public/assets`, `workers/.wrangler/tmp`, and an empty `server/` directory. | S | Artifacts gitignored; `server/` removed. |

## E. Android (AN)

| ID | Problem | Size | Acceptance check |
|----|---------|------|------------------|
| AN-01 | WebView media stack unverified — the audit's Chromium evidence does not transfer to the APK (reels, audio autoplay, background upload). | M | Device matrix in `docs/android-qa-matrix.md` executed on a real phone. |
| AN-02 | Release gate builds and signs the APK but does not smoke-test it on a device. | S | Install + sign-in + one upload + one reel playback per release. |

---

## Sequence

Phase 0 — stop the bleeding (`S+S+S+S`): FN-05 land the working tree · OP-02 dedupe APK ·
OP-05 artifacts/`server/` · FE-15 metadata. Nothing here is design work.

Phase 1 — design system (`L+M+M+L`): FE-01 tokens → FE-02 type → FE-03 icons → FE-04
primitives. Migrate **Home** as the reference screen and stop: that is the review point.

Phase 2 — layout (`L+M+S`): FE-05 shell/sidebar → FE-07 navigation → FE-06 dialogs.

Phase 3 — functionality (`S+M+S+S`): FN-01…FN-04 + BE-05 idempotency. Money and messages
before cosmetics.

Phase 4 — data & performance (`L+L+M`): FE-10 data layer → FE-11 monolith split →
FE-13 splitting/virtualisation.

Phase 5 — hardening (`M×5`): BE-01 migrations, BE-02 integration tests, BE-03 observability,
BE-04 TURN, OP-01 deploy gate.

Phase 6 — polish (`S+M+S+M+S`): FE-08 dark mode, FE-09 motion, FE-12 a11y, FE-14 strings,
AN-01 device matrix.

## Non-goals (explicitly not on this list)

- Re-platforming off React/Vite/Capacitor/Workers — the stack is current (React 19.2,
  Vite 8.2, Tailwind 3.4, Capacitor 8).
- A full visual rebrand. The cream/purple palette and Outfit typeface are already brand-correct;
  the failure is consistency, not identity.
- Native Android rewrite.

## First three moves

1. FN-05 — commit the working tree so the reliability work is not lost.
2. FE-01 — tokens, because every other visual task is blocked on them.
3. FE-03 — icons, because 413 emoji is the single loudest "2010" signal to your client.

---

## Appendix — how to reproduce every number

```bash
# hardcoded colour utilities vs brand tokens
grep -roE '(bg|text|border)-\[#[0-9A-Fa-f]{3,6}\]' src | wc -l        # 1133
grep -roE '\b(bg|text|border)-harvest-[a-z]+' src | wc -l             # 0

# type scale
for p in 'text-\[9px\]' 'text-\[10px\]' 'text-\[11px\]'; do grep -roE "$p" src | wc -l; done

# emoji used as UI (heuristic)
grep -roP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' src | wc -l        # 413

# responsive coverage
grep -roE '\b(sm|md|lg|xl):' src | sort | uniq -c                    # sm 24, md 3, lg 1, xl 0

# native dialogs and forced reloads
grep -roE 'window\.(confirm|prompt)\(' src | wc -l                    # 20
grep -roE 'window\.location\.(href|reload)' src | wc -l               # 5

# data layer
grep -roE '[^a-zA-Z.]fetch\(' src | wc -l                             # 142
grep -cE '^export (async )?function' src/lib/api.ts                   # 23

# build weight
ls -la dist/assets | sort -k5 -n | tail -6

# backend
ls workers/migrations | wc -l                                         # 36
grep -rhoE "'/api/[a-z0-9/_:.-]+'" workers/src | sort -u | wc -l      # 53
grep -rlE "readFile\(new URL\('\.\./src" scripts/*.mjs | wc -l        # 13

# deploy payload
du -sh workers/public/* | sort -rh
```

---

## Progress log

### 2026-11-03 — Phase 1 started

| Task | State | Evidence |
|------|-------|----------|
| FE-01 tokens | **done for the palette** | `tailwind.config.js` maps 7 semantic roles to CSS variables; `.dark` block in `src/index.css`; codemods replaced **1,051 + 24** hex utilities across 29 files. Remaining hex utilities: see below. |
| FE-02 type floor | partial | 12 px floor enforced in the token layer; 170 `text-[10px]` and 26 `text-[9px]` usages still need per-screen replacement. |
| FE-03 icons | **system done, adoption partial** | 27-glyph `Icon` set in `src/ui/index.tsx`; nav converted; 413 emoji usages remain in screens. |
| FE-04 primitives | **done** | `Button / Card / Badge / Field / Input / Select / Textarea / Dialog / EmptyState / Skeleton / Spinner / LiveRegion` exported from `src/ui/index.tsx`. |
| FE-05 desktop shell | **started** | 248 px sidebar at ≥1024 px beside a capped content column; per-screen two-column layouts still open. |
| Guard | **done** | `scripts/test-ui-system.mjs` (7 assertions) wired into `test:all` as `test:ui`. |

Remaining hex utilities after both passes (off-palette hues, deliberately not folded —
each needs a semantic decision rather than a guess): `#0F766E` teal, `#1E40AF` blue,
`#BE185D` pink, plus a handful of one-offs.

### 2026-11-03 — Chat rebuilt (FE-05 reference implementation)

Chat was the last screen on Instagram's dark palette (`bg-stone-950`, `text-white`)
while the rest of the product was token-based, so it rendered as a black slab. It is
now the reference for how a screen should be built.

| Task | State | Evidence |
|------|-------|----------|
| FE-01 on Chat | **done** | 0 `stone-*`/`bg-black`/solid `bg-white` classes left in `Chat.tsx`; everything resolves to `surface / ink / line / accent / gold / success / danger`. |
| FE-02 on Chat | **done** | 0 sizes below 12 px (was 9, 10 and 11 px); enforced by the new guard test. |
| FE-03 on Chat | **done** | 8 glyphs added to the set (`arrow-left send reply star trash share users smile`); emoji chrome gone from the screen. |
| FE-05 desktop shell | **done for Chat** | Master/detail at ≥1024 px: 336 px conversation pane beside the thread, plus a neutral "select a conversation" pane. List pane is gated on `matchMedia`, so a phone does not mount a second 3 s poller behind an open thread. |
| Chat interaction | **new** | Run-grouping (5 min / same sender): tight spacing, one timestamp, one avatar, tail only on the last bubble. Desktop hover toolbar (react, reply, more) instead of a click on every bubble. Jump-to-latest pill with an unseen count; scrolling up is never yanked back to the bottom. Skeleton rows instead of a spinner. |
| Guard | **extended** | `scripts/test-chat-responsive.mjs` now also fails on a legacy palette class, a sub-12 px size, or emoji chrome returning to Chat. |

Known remainder on Chat: no "load older" pagination (server supports `limit` + `before`,
the client never asks) and no idempotency key on `POST /api/chat/messages` (RS-121).
Both are backend-slice items, not styling.
