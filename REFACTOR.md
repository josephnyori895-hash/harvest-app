# Harvest Family — Refactor & Fix Log

Monolith `src/App.jsx` (771 lines) split into modular IG-dark architecture, shallow bugs fixed, security hardened, Step 1 polished to prototype `#7C3AED`.

## 1) Split — src/state/auth.tsx + src/components/* + Protected RequireRole

- **src/state/auth.tsx:1** — New `AuthProvider` + `useAuth()` with `PIN role` mapping. `ADMIN_PINS=['7777','0000','7C3AED']` → `admin`, else `member`. Persist `harvest_role` / `harvest_pin` / `harvest_username` in localStorage. Exports helpers `getFollowsMap`, `toggleFollowMutual`, `isMutual`, `getLikesTable`, `toggleLikeKey` for fixes below.
- **src/components/Protected.tsx:1** — `RequireRole` gate. If `role='admin'` and `!isAdmin` shows PIN unlock (`7777` demo). Used at `src/App.jsx:115` for Admin tab and `src/App.jsx:180` profile → admin transition. Fixes `Guard Admin 622 188` (Profile admin button at `src/App.jsx:622` and nav `src/App.jsx:188` previously unguarded).
- **src/components/Home.tsx:1** — Extracted from `src/App.jsx:235` Feed + Stories strip. Handles `stories 6-14` + `approvedStories` merge, `posts 15` + `approvedPosts` merge, IG-dark styling preserved.
- **src/components/Stories.tsx:1** — Extracted `StoryViewer 277`. Fix via unified `allStories` prop (see bug fix).
- **src/components/Reels.tsx:1** — Extracted `Reels 20-24 339 autoPlay 346`. Fix drift (see below).
- **src/components/Search.tsx:1** — Extracted `Search 304` username/name filter.
- **src/components/Chat.tsx:1** — Extracted `Chat 416` with deterministic `keyFor 425` fix. Preserves 1-1 + youth_group.
- **src/components/CallScreen.tsx:1** — Extracted `CallScreen 391` voice/video overlay.
- **src/components/ViewUser.tsx:1** — Extracted `ViewUser 364`. Wires `toggleFollow` + mutual guard.
- **src/components/HarvestMap.tsx:1** — Extracted `Map 707` + `groupCoords 50-57`. Exports `groupCoords` for onboarding map reuse. Fixes L icon 404 and coords leak 723.
- **src/components/Music.tsx:1** — Extracted `Music 632` local ↔ iTunes search tabs.
- **src/components/Admin.tsx:1** — Extracted `Admin 559` with `pending 109` hybrid queue (member submit → admin approve). Approve moves to posts/stories/reels.
- **src/components/PostCreate.tsx:1** — Extracted `PostCreate 527` feed/story/reel submit-for-approval. Now delegates to `onSubmit` → App `submitPost` instead of direct localStorage race.
- **src/components/Groups.tsx:1** — Revived dead `Groups 603` (was defined never rendered). Now rendered inside `Profile` at `src/App.jsx:312`. Auto-groups by `u.group`, interactive.

`src/App.jsx` slimmed from 771 → ~310 lines orchestrator; retains IG-core not cut: Home, Stories, Reels, Search, Chat, Profile, Map, Music, Groups, Admin with hybrid pending→approve flow (all users post, admin approves).

## 2) Shallow Fixes — before → after

- **like 74 memory → likes table** — `src/App.jsx:74` `const [liked,setLiked]=useState({2:true})` index-keyed, lost on reload. **After** `src/state/auth.tsx:67` `LS_LIKES='harvest_likes_table'` Record<string,boolean> + `src/components/Home.tsx:52` `getLikesTable()/toggleLikeKey(key)` where `key=post_${user}_${img}_${i}`. Persisted, toggled count = `p.likes + (liked?1:0)` at `src/components/Home.tsx:67`.
- **toggleFollow 84 never wired vs ViewUser 387 dead** — `src/App.jsx:84` `toggleFollow` defined but `src/App.jsx:387` `<button>Follow</button>` had no `onClick`. **After** `src/components/ViewUser.tsx:25` `toggleFollowMutual(currentUser, target)` + `src/components/ViewUser.tsx:42` button wired with `onClick={toggle}` and state tick to re-render. Also removed legacy `following.includes` single array.
- **StoryViewer 285 length mismatch vs 278** — `src/App.jsx:285` progress dots mapped over `stories` (static 7) while `src/App.jsx:278` `allStories2` included approved. Navigation bounds used `stories.length-1`. **After** `src/components/Stories.tsx:8` unified `allStories` prop used everywhere: dots `allStories.map`, nav `idx < allStories.length-1`, auto-advance timeout uses `allStories.length`.
- **Reels 346 vs allReels 349 drift** — `src/App.jsx:346` `reelsData[idx].video` but `src/App.jsx:349` `allReels[idx].cap` → when approved reels exist indices diverged. **After** `src/components/Reels.tsx:14` single `cur = allReels[idx]` used for video, cap, views, img consistently at `src/components/Reels.tsx:19-23`.
- **L icon 404 4** — Leaflet default `marker-icon.png` 404 under Vite. **After** `src/App.jsx:12` and `src/components/HarvestMap.tsx:5` `L.Icon.Default.mergeOptions({iconRetinaUrl: 'https://unpkg.com/leaflet...', iconUrl: ..., shadowUrl:...})` + `delete _getIconUrl`.
- **App.css unused** — `src/App.css` 184 lines vite template never imported. **After** deleted file at `src/App.css` (rm). `src/index.css` retained (tailwind).
- **chats 30 orphan** — `src/App.jsx:30` `const chats=[...]` never read; `Chat` derived from `users`. **After** constant removed entirely in new `src/App.jsx`.
- **single follow 98 → mutual** — `src/App.jsx:98` `return following.includes(target)` single follow leaked location. **After** `src/state/auth.tsx:38` `isMutual(viewer,target)` checks both directions in `harvest_follows_map`. Applied at `src/components/ViewUser.tsx:19` and `src/components/HarvestMap.tsx:33` `canSee=isAdmin||isMutual(...)`. UI shows `🔒 Hidden — mutual follow to see` vs `✓ Mutual`.
- **coords leak 723** — `src/App.jsx:723` `users.map(u=> <Marker position={[u.lat,u.lng]})` exposed precise coords to all. **After** `src/components/HarvestMap.tsx:38` splits `visibleUsers`/`hiddenUsers`; hidden markers jittered `jitter(groupCoords[group])` with `opacity 0.6` and popup `Hidden — mutual follow required (approx)`. List also gated via `canSee`.
- **chats keyFor 425 ambiguity** — `src/App.jsx:425` `['harvest_chat',...[a,b].sort()].join('_')` collides if username contains `_`. **After** `src/components/Chat.tsx:18` `keyFor=(a,b)=> 'harvest:chat:'+[a,b].sort().join(':')` deterministic colon separator.
- **Guard Admin 622 188** — see Protected above. `src/App.jsx:115` wraps `<Admin>` with `<RequireRole role="admin">`. Profile admin button now shows purple `Admin ✓` when `isAdmin` at `src/App.jsx:305`.
- **Prototype Step 1 COMPEL polish #7C3AED** — `src/App.jsx:180` onboarding Step 1 was black/white inputs. **After** `src/App.jsx:132-200` matches `/tmp/harvest_proto.png`: header HF purple `bg-[#7C3AED]`, pill `Skip` border, progress `bg-[#7C3AED]` vs `bg-[#EDE9FE]`, card gradient `from-[#EDE9FE] via-[#F5F0FF] to-[#FFFBEB]` with amber `Step 1` badge `bg-[#F59E0B]`, title `text-[#5B21B6]`, waving `👋` with drop-shadow, inputs with leading person icon and `focus:border-[#7C3AED] focus:ring-[#EDE9FE]`, quote pill `bg-[#F5F0FF] border-[#EDE9FE]` `COMPEL · RAISE · RELEASE` in `#7C3AED`, CTA `bg-[#7C3AED] hover:bg-[#6D28D9]` `Continue →`. `tailwind.config.js:7` updated `harvest.purple` `#5B21B6` → `#7C3AED`, `dark` → `#5B21B6`.

## 3) IG-core Kept, Hybrid Flow

IG dark preserved: `bg-black`, `border-zinc-800`, `Harvest` cursive header, heart/comment/share icons, stories gradient ring, reels fullscreen, bottom nav 49px. Hybrid `pending → approve` retained: `PostCreate` → `harvest_pending` → `Admin` Approve/Reject → `harvest_approved_*` → Home/Reels/Stories. Member and admin both use same path; admin PIN only gates approval.

## 4) Verification

- `npm run build` in `/home/nyorii/Projects/church-harvest-harvestfamily` → pass `413.60kB gzip 119.25kB` (was 771-line monolith).
- Manual checks: follow toggles, likes persist on reload, StoryViewer dots match story count, Reels nav stable with approved reels, Map hidden users approx only, Admin PIN prompt appears, Step 1 visual matches prototype.
