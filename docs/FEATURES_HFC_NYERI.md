# Harvest Family Church Nyeri — Feature Spec (HFC Nyeri Edition)

**Admin:** Allan | **Users:** 3 types (Normal / Verified / Admin)

---

## 1. User Types & Permissions

### 1.1 Normal Members
- **Posting**: Stories only (24h expiry)
- **Viewing**: Feed (home), stories, reels, music, groups, map, chat
- **Giving**: Can contribute via giving interface
- **Projects**: Can view and join church projects, get reminders, track giving
- **Music**: Can browse, download, and stream church music
- **Admin Tools**: None

**Verification Path**: Ask Allan (admin) to verify → becomes "Verified" → unlocks photos, reels, music uploads

### 1.2 Verified Members
- **Posting**: Stories, photos/posts, reels, music uploads
- **Viewing**: All (feed, stories, reels, music, groups, map, chat)
- **Giving**: Contribute with receipts
- **Projects**: Full participation, reminders
- **Music**: Browse, download, stream, upload church music
- **Admin Tools**: None

**Promotion**: Allan toggles verified flag in Admin Panel

### 1.3 Admin (Allan)
- **Posting**: All types, instant approval (no queue)
- **Moderation**: Approve/reject pending posts, stories, reels, music
- **User Management**: Verify accounts, manage roles
- **Music Library**: Upload, organize, feature church music
- **Content Editing**: Rich editor for video/reels, captions, scheduling
- **Analytics**: View engagement (likes, comments, views)
- **Projects**: Create, manage, assign, send reminders, track giving
- **Broadcast**: Pin posts, feature stories, priority content
- **Admin Dashboard**: Dedicated interface for all management tasks

---

## 2. Content Posting Flow (RBAC-Enforced)

### 2.1 Normal User Posts Story
```
1. Tap "Create" → Only "Story" option visible
2. Add caption (optional for stories)
3. Upload image or skip
4. Submit → Instant post (no approval needed, 24h TTL)
5. Auto-disappears after 24h
```

### 2.2 Verified User Posts Photo/Reel/Music
```
1. Tap "Create" → "Story", "Photo", "Reel", "Music" visible
2. Choose type
3. Add caption
4. Upload media (image/video/audio)
5. Submit → pending_queue (status=pending)
6. Allan reviews in Admin Panel
7. Approve/Reject → moves to posts/reels/tracks table
```

### 2.3 Admin (Allan) Posts Content
```
1. Tap "Create" → All types visible
2. Choose type
3. Add caption + media
4. Submit → **INSTANT APPROVED** (no queue, direct to feed)
5. Jobs: thumb.js + transcode.js process in background
6. Appears in feed immediately
```

---

## 3. Enhanced Admin Dashboard (For Allan)

### 3.1 Core Responsibilities
1. **Content Approval** (most frequent)
   - Pending posts, stories, reels, music
   - Quick approve/reject with reason
   - Bulk actions (approve multiple)
   - Search/filter by user, type, date

2. **User Management**
   - Verify/unverify accounts
   - View user profiles & stats
   - See who's active
   - Ban/suspend if needed

3. **Music Library Management**
   - Upload church music (worship, choir, hymns, praise)
   - Organize by category
   - Set featured tracks
   - Enable member uploads (music from members)
   - Track downloads

4. **Church Projects**
   - Create new projects (building fund, outreach, etc.)
   - Assign members to projects
   - Track giving/contributions
   - Send reminders to participants
   - View project dashboard

5. **Content Management**
   - Pin important posts (stay at top)
   - Feature stories on homepage
   - Schedule posts (post at specific time)
   - Edit captions/metadata
   - Delete inappropriate content

6. **Analytics & Insights**
   - Top posts/reels (engagement)
   - Member activity (who's active)
   - Giving trends per project
   - Content performance (views, likes, comments)

### 3.2 Admin UI Layout

```
┌─ ADMIN PANEL (Accessible via Profile tab + PIN 7777) ─────────────┐
│                                                                      │
│ ┌─ TAB BAR ──────────────────────────────────────────────────────┐ │
│ │ ⏳ PENDING  │ ✓ VERIFY  │ 🎵 MUSIC  │ 👥 PROJECTS  │ 📊 STATS │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ TAB: PENDING (Content Approval Queue) ────────────────────────┐ │
│ │ Filter: [All ▼] [By user] [By type: Post/Reel/Story/Music] │ │
│ │                                                                 │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ youth_harvest — REEL                           2 hrs ago │ │ │
│ │ │ "Sunday worship highlights..."                           │ │ │
│ │ │ [Thumbnail preview]                                      │ │ │
│ │ │ [✓ Approve] [✕ Reject] [View Full] [Edit Caption]       │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ pst.simon — MUSIC                             1 day ago  │ │ │
│ │ │ "Psalm 42 — New arrangement"                             │ │ │
│ │ │ [🎵 Audio player]                                        │ │ │
│ │ │ [✓ Approve] [✕ Reject] [Add to Library] [Edit Metadata] │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ • Shows: user, type, caption, media thumbnail, actions      │ │
│ │ • Bulk actions: [Approve All] [Reject All Selected]         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ TAB: VERIFY (User Verification) ──────────────────────────────┐ │
│ │ [Search users] [Filter: Pending / Verified]                   │ │
│ │                                                                │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 👤 youth_harvest    ✓ Verified                          │ │ │
│ │ │    Followers: 2014 | Posts: 28 | Reels: 15             │ │ │
│ │ │ [Unverify] [View Profile] [Stats]                      │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 👤 pst.simon       ✗ Unverified                         │ │ │
│ │ │    Followers: 890 | Posts: 5 | Reels: 0                │ │ │
│ │ │ [Verify] [View Profile] [Stats]                        │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ TAB: MUSIC (Church Music Library) ────────────────────────────┐ │
│ │ [+ Upload Music] [Organize] [Categories]                      │ │
│ │ Filter: [All] [Worship] [Choir] [Hymns] [Praise]              │ │
│ │                                                                 │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 🎵 Compelled Anthem — Harvest Worship    [Featured ⭐]  │ │ │
│ │ │    Worship · 4:32 · 1.2K downloads                      │ │ │
│ │ │ [Play] [Edit] [Unfeature] [Delete] [Download Stats]     │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 🎵 Psalm 42 — Pst Simon (Member Upload)                │ │ │
│ │ │    Hymn · 3:18 · 234 downloads · Pending Review        │ │ │
│ │ │ [Play] [Feature] [Approve] [Reject] [Edit Details]     │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ TAB: PROJECTS (Church Development) ──────────────────────────┐ │
│ │ [+ New Project] [View All]                                    │ │
│ │                                                                │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 🏗️ New Sanctuary Building Fund                          │ │ │
│ │ │    Goal: KES 500,000 | Raised: KES 185,000 (37%) ▓▓▓   │ │ │
│ │ │    Members: 42 | Participants: 38                       │ │ │
│ │ │ [View Details] [Send Reminder] [Edit] [Export Report]   │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ │ ┌──────────────────────────────────────────────────────────┐ │ │
│ │ │ 👥 Youth Outreach Program                               │ │ │
│ │ │    Status: Active | Members: 23 | Budget: KES 50,000   │ │ │
│ │ │ [View Details] [Send Reminder] [Edit] [Export Report]   │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ TAB: STATS (Analytics & Performance) ──────────────────────────┐ │
│ │ Period: [This Week ▼]  Last 7 days | Last 30 days | All time   │ │
│ │                                                                 │ │
│ │ 📊 Content Performance                                         │ │
│ │ Top Post: "Sunday Reflection" — 347 likes, 52 comments        │ │
│ │ Top Reel: "Worship Highlights" — 1.2K views, 89 likes         │ │
│ │ Most Liked Music: "Compelled" — 567 likes, 2.3K streams       │ │
│ │                                                                │ │
│ │ 👥 Member Activity                                            │ │
│ │ Active Members: 156 / 200 (78%)                               │ │
│ │ Most Active: youth_harvest (28 posts, 15 reels)               │ │
│ │ New Members: 12 (this week)                                    │ │
│ │                                                                │ │
│ │ 💰 Giving Insights                                             │ │
│ │ Total Given: KES 234,000 (this week)                          │ │
│ │ Top Project: Building Fund (KES 145,000)                       │ │
│ │ Avg Contribution: KES 1,500                                    │ │
│ │                                                                 │ │
│ │ [View Full Report] [Export CSV] [Send Announcement]           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Backend Support (Already Implemented)

### Required Endpoints

#### Content Approval (Already implemented)
- `GET /api/pending` — list by status (pending/transcoding/approved/rejected)
- `POST /api/pending/:id/approve` — move to posts/reels/tracks table
- `POST /api/pending/:id/reject` — reject with reason

#### User Verification (Already implemented)
- `POST /api/admin/verify/:username` — toggle verified flag
- `GET /api/users` — search users

#### Content Restrictions (Needs DB enforcement)
- Normal users: INSERT into stories table only (stories.ts)
- Verified users: INSERT into pending_queue (requires admin approval for posts/reels/music)
- Admin: INSERT directly to posts/reels/tracks (bypass pending_queue)

#### Music Endpoints (Needs implementation)
- `GET /api/music` — list music library
- `POST /api/music/upload` — presigned POST for audio
- `POST /api/music/:id/feature` — toggle featured flag
- `POST /api/music/:id/edit` — edit metadata (title, artist, category)

#### Project Endpoints (Needs implementation)
- `GET /api/projects` — list all projects
- `POST /api/projects` — create new project (admin only)
- `POST /api/projects/:id/members/invite` — add members, send reminders
- `POST /api/projects/:id/giving` — record contributions
- `GET /api/projects/:id/stats` — project dashboard (goal, raised, participants)

---

## 5. Frontend Components to Improve

### 5.1 PostCreate.tsx (RBAC enforcement)
```typescript
- Check role (normal/verified/admin)
- Show allowed post types
- Normal: [Story only]
- Verified: [Story, Photo, Reel, Music]
- Admin: [Story, Photo, Reel, Music] + "Instant Approve" banner
- Add role warning if normal
```

### 5.2 Admin.tsx (Redesigned dashboard)
```typescript
- 5 tabs: Pending, Verify, Music, Projects, Stats
- Pending: filter by type/user, bulk actions, edit captions
- Verify: search, toggle verified, view stats
- Music: upload, organize, feature, member submissions
- Projects: create, manage, assign, track giving
- Stats: engagement, activity, giving insights
```

### 5.3 Music.tsx (Enhanced music interface)
```typescript
- Browse by category (worship, choir, hymn, praise)
- Download button (track downloads)
- Stream with player
- For verified: "Upload" button
- For admin: Manage library
```

### 5.4 Give.tsx (Enhanced giving interface)
```typescript
- List active projects
- Progress bars (KES raised / goal)
- Members contributing
- Easy one-tap giving
- Receipt + tax acknowledgment (future)
```

### 5.5 Profile.tsx (Role-based profile)
```typescript
- Show role badge (Member / Verified / Admin)
- Admin only: "Admin Panel" button → full dashboard
- Stats: posts, followers, following (by role)
- Edit profile (name, location, bio)
```

---

## 6. Database Schema Enhancements

### 6.1 Existing Tables (Use as-is)
- `users` — role (admin/pastor/member/guest), verified
- `posts` — caption, approved_at
- `reels` — caption, approved_at, hls_master_key
- `stories` — expires_at (24h)
- `pending_queue` — status (pending/transcoding/approved/rejected)

### 6.2 New Tables Needed

#### tracks (Music library)
```sql
CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  title TEXT,
  artist TEXT,
  category TEXT, -- worship, choir, hymn, praise
  original_key TEXT, -- audio file in MinIO
  preview_key TEXT, -- optional short clip
  duration INT, -- seconds
  download_count INT DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
```

#### projects (Church development initiatives)
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name TEXT,
  description TEXT,
  category TEXT, -- building, outreach, ministry, etc.
  goal_amount INT, -- KES
  raised_amount INT DEFAULT 0,
  lead_user_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'active', -- active, paused, completed
  created_at TIMESTAMP,
  deadline TIMESTAMP
);

CREATE TABLE project_members (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  user_id UUID REFERENCES users(id),
  contribution_amount INT DEFAULT 0,
  joined_at TIMESTAMP DEFAULT now()
);

CREATE TABLE project_reminders (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  sent_at TIMESTAMP DEFAULT now(),
  recipient_count INT
);
```

#### audit_log (Already in schema, track all admin actions)
```sql
-- Existing: actor_id, action, target_type, target_id, meta
-- Actions: approve, reject, verify_toggle, music_feature, project_create
```

---

## 7. Deployment Checklist (KES 1k VPS)

- [ ] Deploy backend with music + project endpoints
- [ ] Create tracks, projects, project_members tables
- [ ] Update PostCreate.tsx with RBAC
- [ ] Redesign Admin.tsx with 5-tab dashboard
- [ ] Enhance Music.tsx with categories + downloads
- [ ] Create Give.tsx for projects
- [ ] Test role-based posting (Normal/Verified/Admin)
- [ ] Verify Allan can instant-approve
- [ ] Test music upload + organization
- [ ] Test project creation + member invites
- [ ] Set Allan's role to admin on deploy
- [ ] Document admin PIN (7777) for Allan

---

## 8. Quick Reference: Allan's Workflow

**Monday Morning:**
1. Open Admin Panel (Profile → long-press → PIN 7777)
2. Check **Pending** tab (new posts/reels from members)
3. Approve good content (appears in feed immediately)
4. Reject with feedback if needed
5. Check **Music** tab (new songs from worship team)
6. Feature Sundays' worship track
7. Check **Projects** tab (giving progress)
8. Send reminder: "Building fund at 37% — thank you!"
9. Check **Stats** tab (what's trending this week)

**Content Posting (Allan):**
1. Tap Create → choose Photo/Reel/Music
2. Add caption
3. Upload (auto-processed by thumb.js + transcode.js)
4. Appears in feed **instantly** ✨

**Broadcasting (Allan):**
1. Create announcement (pin it)
2. Feature story for visibility
3. Post in Groups (youth, worship team, etc.)
4. Send Telegram reminder to active members

---

## 9. Success Metrics

- **Admin Efficiency**: Allan spends <30 min/day on approvals
- **User Adoption**: 70%+ of members verified within 3 months
- **Engagement**: 40%+ of members post/share monthly
- **Giving**: KES 1M+ raised per project
- **Music**: 500+ church songs in library by EOY

