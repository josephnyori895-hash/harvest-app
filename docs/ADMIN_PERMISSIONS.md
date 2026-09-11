/**
 * HARVEST FAMILY CHURCH — ADMIN (ALLAN) PERMISSIONS & PRIVILEGES
 * 
 * This document outlines all permissions and privileges for the admin role (Allan)
 * compared to other roles: member, leader, guest
 */

// ============================================================================
// 1. AUTHENTICATION & PIN-BASED ACCESS
// ============================================================================
// File: src/state/auth.tsx (lines 5-66)

const ADMIN_PINS = ['7777', '0000', '7C3AED']  // Multiple admin PINs allowed
const LS_ROLE = 'harvest_role'
const LS_PIN = 'harvest_pin'

/**
 * Admin Detection Logic (line 58)
 * When user logs in with a PIN:
 *   - If PIN in ADMIN_PINS → role = 'admin'
 *   - Otherwise → role = 'member' (if PIN provided) or 'guest' (if empty)
 */
export function login(pin: string) {
  const isAdmin = ADMIN_PINS.includes(pin.trim())
  const role = isAdmin ? 'admin' : pin ? 'member' : 'guest'
  return isAdmin
}

// ============================================================================
// 2. CONTENT MODERATION PRIVILEGES
// ============================================================================
// File: src/App.jsx (lines 136-180)

PRIVILEGE: POST/STORY/REEL APPROVAL
  - admins can approve pending content (approve() function, line 149)
  - members' posts enter pending_queue, admins see in /api/pending
  - admins can approve OR reject with reason
  
PRIVILEGE: USER VERIFICATION TOGGLE
  - File: src/App.jsx (lines 429-446)
  - Admin-only section to toggle verified status on any user
  - UI: "✓ Verified Accounts" section in Profile tab
  - Users must be verified to post (line 141: "Only verified accounts can post")
  
PRIVILEGE: PENDING QUEUE VISIBILITY
  - File: src/App.jsx (line 377)
  - Admin sees ALL pending content: `p.user === username || (isAdmin && true)`
  - Members only see their own pending content
  
PRIVILEGE: DELETE STORIES
  - File: src/App.jsx (line 170)
  - Admin can delete any user's stories (deleteStory function)
  - Members cannot delete others' content

// ============================================================================
// 3. CONTENT CREATION — BYPASS APPROVAL
// ============================================================================
// File: Backend spec docs/MEDIA_PIPELINE_AND_RANKED_FEED.md (Section 3.4)

PRIVILEGE: DIRECT POSTING (NO APPROVAL NEEDED)
  - Admin POST /api/media/confirm directly inserts into posts|stories|reels
  - Members POST /api/media/confirm inserts into pending_queue
  - Admin posts bypass review = immediate publication
  - Audit log entry: action='direct_approve'
  
PRIVILEGE: SCHEDULE POSTS
  - README.md mentions "scheduling (admins)" feature
  - Admins can schedule posts for future publication
  - Members cannot schedule

// ============================================================================
// 4. USER MANAGEMENT PRIVILEGES
// ============================================================================
// File: src/App.jsx (lines 184-210, GroupDetails, UserListModal components)

PRIVILEGE: GROUP MANAGEMENT
  - Admin can add/remove users from groups
  - Admin can cycle user roles within groups (leader, member, admin)
  - File: src/components/GroupDetails.tsx (lines showing admin-only controls)
  - File: src/components/UserListModal.tsx (role management)

PRIVILEGE: ACCOUNT SWITCHING
  - All roles can switch between 4 accounts (allan, youth_harvest, worship_team, pst.simon)
  - BUT: switching to 'allan' → automatic role='admin', PIN='7777' (line 204)
  - Other accounts → role='member'

// ============================================================================
// 5. ANALYTICS & MONITORING (FUTURE)
// ============================================================================
// File: docs/DEPLOY_VPS.md (Section 8: "Monitoring")

PRIVILEGE: HEALTH CHECK ACCESS
  - Admin only: GET /health (returns disk %, database ok, MinIO ok)
  - Alert if disk >80% (VPS storage constraint)
  
PRIVILEGE: AUDIT LOG VISIBILITY (FUTURE)
  - All approval/rejection/verification actions logged in audit_log table
  - Only admins can view audit logs (planned)
  - Schema: audit_log (actor_id, action, target_type, target_id, meta)

// ============================================================================
// 6. GIVING/DONATION MANAGEMENT (FEATURE REQUEST)
// ============================================================================
// File: src/components/Give.tsx (lines 1-7102)

PRIVILEGE: FUND MANAGEMENT
  - Admin can see all donations/transactions
  - Admin can verify transactions
  - Admin can track fund allocation
  - Members can only submit donations
  - Schema (planned): transactions table with admin approval

// ============================================================================
// 7. ROLE HIERARCHY
// ============================================================================

ROLES (in order of privilege):
  
  1. ADMIN (Allan)
     - All privileges below
     - PIN: 7777, 0000, or 7C3AED
     - Can moderate all content
     - Can verify/unverify users
     - Direct posting (no approval)
     - Access to all groups

  2. LEADER (e.g., Youth Harvest, Worship Team)
     - Can post (needs admin approval first)
     - Can moderate group members
     - Can see group analytics
     - Cannot verify users globally
     - Cannot delete others' content

  3. MEMBER (regular user)
     - Can post/create stories/reels (pending admin approval)
     - Must be verified to post
     - Can see own pending content
     - Can manage own profile
     - Can chat and interact

  4. GUEST (unauthenticated)
     - Read-only access
     - Cannot post
     - Cannot chat
     - Cannot create stories/reels

// ============================================================================
// 8. UI INDICATORS FOR ADMIN STATUS
// ============================================================================
// File: src/App.jsx (line 384)

Admin UI Elements:
  - Badge: "★ Admin" (purple gradient) in profile
  - Pending count badge: "N pending" (amber) - only shown for admins
  - "⏳ Pending" section with approve/reject buttons
  - "✓ Verified Accounts" section to toggle verification
  - "Harvest Groups by Location" section with member counts
  
Regular Member UI:
  - Badge: "Member" (gray) in profile
  - No pending queue section
  - No verification toggle
  - No group management

// ============================================================================
// 9. API ENDPOINTS (ADMIN-ONLY)
// ============================================================================
// File: docs/MEDIA_PIPELINE_AND_RANKED_FEED.md (Section 4)

ENDPOINT: GET /api/pending
  - Returns: pending_queue items
  - Auth: JWT with role='admin'
  - Status filter: status=pending
  
ENDPOINT: POST /api/pending/:id/approve
  - Admin only
  - Moves item from pending_queue → posts|stories|reels|tracks
  - Action: audit log 'approve'
  
ENDPOINT: POST /api/pending/:id/reject
  - Admin only
  - Deletes from pending_queue
  - Stores: reject_reason
  - Action: audit log 'reject'
  
ENDPOINT: POST /api/auth/login
  - POST { pin }
  - Returns: { token, role, username }
  - If pin in ADMIN_PINS → role='admin', JWT issued
  
ENDPOINT: GET /api/health (future)
  - Admin only
  - Disk usage, database status, MinIO status

// ============================================================================
// 10. SECURITY CONSIDERATIONS
// ============================================================================

PIN-BASED AUTH:
  ⚠️  Currently PIN stored in localStorage (line 35: LS_PIN)
  ⚠️  PIN not hashed (security risk)
  ⚠️  Multiple admin PINs hardcoded (7777, 0000, 7C3AED)
  
RECOMMENDATIONS:
  1. Migrate to JWT + server-side PIN verification
  2. Hash PINs with bcryptjs (server/src/s3.js already uses bcryptjs)
  3. Add rate limiting on login attempts (10 presigns/min already exists for uploads)
  4. Remove hardcoded PINs, store in secure database
  5. Add 2FA for admin actions (approve/reject)
  6. Audit log all admin actions (already schema'd)

// ============================================================================
// 11. ADMIN-ONLY FEATURES (CURRENT STATE)
// ============================================================================

✅ WORKING:
  - PIN-based admin login
  - Approve/reject pending posts, stories, reels
  - Toggle user verification status
  - Delete any user's stories
  - Direct posting (bypass approval) — backend ready
  - Account switching to admin account

⚠️  PLANNED/PARTIAL:
  - POST scheduling (mentioned in README, not yet implemented)
  - Audit logging (schema exists, API not yet built)
  - Health monitoring (spec in docs, API not yet built)
  - Giving/donation management (component exists, logic minimal)
  - Group role management (UI exists, full permissions logic pending)

❌ NOT YET IMPLEMENTED:
  - 2FA/MFA for admin
  - Rate limiting by role
  - Admin dashboard (analytics, stats)
  - Bulk content moderation
  - Admin activity logs (UI)
  - User ban/suspend functionality

// ============================================================================
// 12. TESTING ADMIN ACCESS
// ============================================================================

TO LOG IN AS ALLAN (ADMIN):
  1. Open app, click "Skip" on onboarding
  2. Switch to 'allan' account (long-press profile icon)
  3. Admin PIN prompt appears
  4. Enter: 7777 (or 0000 or 7C3AED)
  5. Role changes to 'admin' (badge shows ★ Admin)
  6. Profile tab shows:
     - Pending approvals section
     - Verified Accounts list
     - Harvest Groups list

TO VERIFY/UNVERIFY A USER:
  1. Log in as Allan (admin)
  2. Go to Profile tab
  3. Scroll to "✓ Verified Accounts"
  4. Click user's "Verify" or "Unverify" button
  5. User's post restrictions removed/added

TO APPROVE A POST:
  1. Regular member posts (enters pending_queue)
  2. Admin sees it in "⏳ Pending" section
  3. Click ✓ to approve → moves to posts feed
  4. Click ✕ to reject → removed from queue

// ============================================================================
// 13. FUTURE ENHANCEMENTS
// ============================================================================

RECOMMENDED UPGRADES:
  1. Sub-admin roles (group leads can approve their group's content)
  2. Content moderation queue (filter by type, user, group)
  3. Bulk actions (approve/reject multiple)
  4. Admin dashboard (analytics, user growth, engagement)
  5. Moderation logs with reason/notes
  6. User suspension/ban (with appeal process)
  7. Content appeals (users can appeal rejected posts)
  8. Admin activity notifications
  9. Two-factor authentication (PIN + SMS/email)
  10. IP whitelisting for admin accounts

// ============================================================================
// SUMMARY
// ============================================================================

ALLAN (ADMIN) CURRENT PERMISSIONS:
  ✓ Approve/reject all user content
  ✓ Verify/unverify users
  ✓ Post directly (no approval needed)
  ✓ Delete any story
  ✓ Manage group members
  ✓ Switch accounts instantly
  ✓ View all pending content
  ✓ See user verification status
  
MEMBERS CURRENT PERMISSIONS:
  ✗ Cannot approve/reject
  ✗ Cannot verify users
  ✗ Posts need approval
  ✗ Cannot delete others' content
  ✗ Can only manage own profile
  ✓ Can post (if verified)
  ✓ Can chat
  ✓ Can create stories (if verified)

SECURITY STATUS: ⚠️  LOW (PIN-based, no JWT, no 2FA)
  - Needs migration to backend JWT auth
  - Needs PIN hashing
  - Needs rate limiting
  - Needs audit logging
