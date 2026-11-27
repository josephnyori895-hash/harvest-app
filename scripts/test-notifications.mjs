import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const feedRoute = await readFile(new URL('../workers/src/routes/feed.js', import.meta.url), 'utf8')
const usersRoute = await readFile(new URL('../workers/src/routes/users.js', import.meta.url), 'utf8')
const socialRoute = await readFile(new URL('../workers/src/routes/social.js', import.meta.url), 'utf8')
const notificationsRoute = await readFile(new URL('../workers/src/routes/notifications.js', import.meta.url), 'utf8')
const notif = await readFile(new URL('../src/components/NotificationsScreen.jsx', import.meta.url), 'utf8')
const lib = await readFile(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8')
const pushLib = await readFile(new URL('../src/lib/push.ts', import.meta.url), 'utf8')
const adminCodeBanner = await readFile(new URL('../src/components/AdminCodeBanner.tsx', import.meta.url), 'utf8')
const hook = await readFile(new URL('../src/lib/useModalFocus.ts', import.meta.url), 'utf8')
const commentsSheet = await readFile(new URL('../src/components/Comments.tsx', import.meta.url), 'utf8')
const homeFeed = await readFile(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')
const realtime = await readFile(new URL('../workers/src/realtime.js', import.meta.url), 'utf8')
const pendingRoute = await readFile(new URL('../workers/src/routes/pending.js', import.meta.url), 'utf8')
const notifLib = await readFile(new URL('../workers/src/lib/notif.js', import.meta.url), 'utf8')

test('comments notify the post owner and replies notify the comment author', () => {
  assert.match(feedRoute, /recordNotificationsSafe/)
  assert.match(feedRoute, /SELECT id, user_id FROM posts WHERE id=\? AND approved_at IS NOT NULL/)
  assert.match(feedRoute, /const notifyUserId = parentId \? parentAuthorId : target\.rows\[0\]\?\.user_id/)
  assert.match(feedRoute, /type: parentId \? 'comment_reply' : 'comment'/)
})

test('a like notifies the owner and never the actor', () => {
  assert.match(feedRoute, /if \(liked && target\.rows\[0\]\.user_id && target\.rows\[0\]\.user_id !== fresh\.id\)/)
  assert.match(feedRoute, /recordNotificationsSafe/)
})

test('a new follower notifies the followee; a story reply notifies the author', () => {
  assert.match(usersRoute, /type: 'follow'/)
  assert.match(usersRoute, /recordNotificationsSafe/)
  assert.match(socialRoute, /type: 'story_reply'/)
  assert.match(socialRoute, /SELECT id, user_id FROM stories WHERE id=\? AND expires_at>\?/)
})

test('inbox press routing opens the liked/commented content, and carries a username', () => {
  assert.match(app, /notification\.type === 'like' \|\| notification\.type === 'comment' \|\| notification\.type === 'comment_reply'/)
  assert.match(app, /notification\.type === 'story_reply'/)
  // Actor resolution is batched now, but the shape still carries a username so
  // the row has somewhere to route.
  assert.match(notificationsRoute, /actors\.set\(String\(u\.id\), \{ name: u\.name \|\| u\.username, username: u\.username/)
})

test('family activity is normalized into notification rows by the lib', () => {
  assert.match(lib, /export async function fetchFamilyActivity/)
  assert.match(lib, /category: 'family'/)
  assert.match(lib, /type: 'member_joined'/)
  assert.match(lib, /type: 'followed_you'/)
  assert.match(lib, /type: 'you_followed'/)
})

test('App merges family activity into the single notifications inbox', () => {
  assert.match(app, /fetchFamilyActivity\(\)/)
  // Merged by id — the 60s poll must not stack duplicate activity rows.
  assert.match(app, /seen\.has\(String\(n\.id\)\)/)
  assert.match(app, /\[\.\.\.withLocalRead\(fam\)\.filter\(n => !seen\.has\(String\(n\.id\)\)\), \.\.\.prev\]/)
})

test('family-activity reads are recorded on the device, not POSTed as unknown ids', () => {
  // These rows are derived client-side, so the server has no record to mark.
  // Posting them 404'd, rolled back the optimistic read, and let the poll put
  // the unread badge straight back.
  assert.match(app, /const ACTIVITY_READ_KEY = 'harvest:activity-read'/)
  assert.match(app, /if \(isLocalNotification\(notificationId\)\)/)
  assert.match(app, /saveActivityRead\(read\)/)
  assert.match(app, /withLocalRead\(fam\)/)
})

test('Inbox press routing opens the member profile from family activity rows', () => {
  assert.match(app, /notification\.type === 'member_joined' \|\| notification\.type === 'followed_you' \|\| notification\.type === 'you_followed/)
  assert.match(app, /openProfile\(\{ username: String\(actor\.username\)/)
})

test('Inbox exposes a Family filter and maps family rows to it', () => {
  assert.match(notif, /id: 'family', label: 'Family/)
  assert.match(notif, /member_joined.*followed_you.*you_followed/)
})

test('Activity screen is merged away — single notifications surface remains', () => {
  assert.doesNotMatch(app, /tab === 'activity' && <Activity \/>/)
  assert.doesNotMatch(app, /function Activity\(\)/)
})

test('the profile activity entrance opens that same surface, not a second screen', () => {
  // Audit item F keeps activity one tap from Profile; both entrances must land
  // on the one inbox, with activity rows pre-filtered.
  assert.match(app, /onOpenActivity=\{\(\) => \{ setNotificationFilter\('family'\); setShowNotifications\(true\)/)
  assert.match(app, /activityRows|withLocalRead\(rows\)\.filter/, 'family activity rides the notification list')
})

test('the inbox retry actually refreshes — a dead button is a silent failure', () => {
  assert.doesNotMatch(app, /onRetry=\{\(\) => \{\}\}/)
  assert.match(app, /onRetry=\{\(\) => \{ void refreshNotifications\(\) \}\}/)
})

test('the bell anchors to the app column and controls the drawer it opens', () => {
  assert.match(app, /aria-expanded=\{showNotifications\}/)
  assert.match(app, /aria-controls="notifications-drawer"/)
  assert.doesNotMatch(app, /className="fixed right-3 z-30 flex h-10 w-10/, 'a viewport-fixed bell floats away from the centred column on desktop')
  assert.match(app, /absolute right-3 z-30 flex h-11 w-11/)
})

test('the badge is decorative — the count is announced once, by the button', () => {
  assert.match(app, /aria-hidden="true" className="absolute -right-0\.5 -top-0\.5/)
})

test('the inbox behaves like a dialog: modal, focus in, Escape out', () => {
  assert.match(app, /id="notifications-drawer"[\s\S]{0,200}aria-modal="true"/)
  assert.match(app, /notificationsDrawerRef/)
  assert.match(hook, /e\.key === 'Escape'/)
  // Restore falls back to a selector-resolved opener because the chat button
  // unmounts in the same commit that opens the card.
  assert.match(hook, /if \(opener && opener !== document\.body && opener\.isConnected\)/)
  assert.match(hook, /requestAnimationFrame\(\(\) => \{ getReturnFocus\(\)\?\.focus\?\.\(\) \}\)/)
  assert.match(app, /useModalFocus\(dmSheet && !dmMinimized, dmLayerRef, \(\) => setDmSheet\(false\), \(\) => document\.querySelector\('\[data-testid="chat-fab"\]'\)\)/)
})

test('the inbox and the DM card stay floating cards, never fullscreen', () => {
  assert.match(app, /id="notifications-drawer"[\s\S]*?sm:h-\[min\(70dvh,560px\)\]/)
  assert.doesNotMatch(app, /id="notifications-drawer"[\s\S]{0,600}bottom-\[calc\(env\(safe-area-inset-bottom\)\+72px\)\]/)
  assert.match(app, /id="dm-layer"[\s\S]*?h-\[min\(50dvh,420px\)\] min-h-\[320px\]/, 'Mini Chat shows at least three messages without becoming a full screen')
  // The chat panel is cropped for the card, otherwise its header stack leaves
  // no room for a single conversation row.
  assert.match(app, /id="dm-layer"[\s\S]*?<Chat\s+compact/)
})

test('a failed refresh is reported instead of leaving a stale badge', () => {
  // The refresh now goes through apiGet (timeout + one retry), which rejects on
  // a non-OK response; the catch still has to put the failure on screen.
  assert.match(app, /const d = await apiGet\([^)]*\/api\/notifications\?limit=40/)
  assert.match(app, /Notifications are unavailable right now\./)
})

test('the background poll rides the read-mutation queue', () => {
  assert.match(app, /enqueueNotificationMutation\(\(\) => refreshNotifications\(true\)\)/)
})

test('an open card freezes the feed behind it, then unfreezes on close', () => {
  // The feed lives in .app-content.app-scroll, which is a sibling of the cards,
  // so the lock has to target the shell's scroller and put its overflow back.
  assert.match(hook, /function lockScroll\(panel: HTMLElement \| null\)[\s\S]*?querySelector\('\.app-content\.app-scroll'\)/)
  assert.match(hook, /scrollLockDepth === 0\) scrollLockRestore\(\)/)
  assert.match(hook, /const releaseScroll = lockScroll\(panel\)/)
  assert.match(hook, /releaseScroll\(\)/)
  assert.match(hook, /node\.style\.overflow = previous\[i\]\.overflow/)
})

test('the comment sheet and the post options sheet use the shared dialog hook', () => {
  assert.match(commentsSheet, /import \{ useModalFocus \} from '\.\.\/lib\/useModalFocus'/)
  assert.match(commentsSheet, /useModalFocus\(!inline, sheetRef, onClose\)/)
  assert.match(commentsSheet, /ref=\{sheetRef\}/)
  assert.match(commentsSheet, /tabIndex=\{inline \? undefined : -1\}/)
  assert.match(homeFeed, /import \{ useModalFocus \} from '\.\.\/lib\/useModalFocus'/)
  assert.match(homeFeed, /useModalFocus\(!!menuPost, postMenuRef, \(\) => setMenuPost\(null\)\)/)
  assert.match(homeFeed, /ref=\{postMenuRef\} tabIndex=\{-1\}/)
})

test('the Mini Chat is a compact non-blocking panel: focus in, Escape out', () => {
  // It must not claim modality: the member keeps scrolling the app underneath.
  assert.match(app, /ref=\{dmLayerRef\}[\s\S]{0,200}aria-modal="false"/)
  assert.match(app, /ref=\{dmLayerRef\}[\s\S]{0,400}aria-label="Mini chat"/)
  assert.match(app, /useModalFocus\(dmSheet && !dmMinimized, dmLayerRef, \(\) => setDmSheet\(false\), \(\) => document\.querySelector\('\[data-testid="chat-fab"\]'\)\)/)
  assert.match(app, /onMinimize=\{\(\) => setDmMinimized\(true\)\}/)
  assert.match(app, /data-testid="chat-mini-bubble"/)
  assert.match(app, /useModalFocus\(showNotifications, notificationsDrawerRef, \(\) => setShowNotifications\(false\)\)/)
  assert.match(hook, /const dialogs = Array\.from\(document\.querySelectorAll\('\[role="dialog"\]'\)\)/)
})

test('a message sent over the socket lands in the inbox, not only in push', () => {
  // Chat prefers the realtime DO path. That path used to fan out FCM only, so
  // the bell stayed empty for most messages while REST-sent ones appeared.
  assert.match(realtime, /import \{ recordNotificationsSafe \} from '\.\/lib\/notif\.js'/)
  assert.match(realtime, /type: 'department_chat'[^}]*category: 'departments'/s)
  assert.match(realtime, /type: 'group_chat'[^}]*category: 'groups'/s)
  assert.match(realtime, /type: 'chat'[^}]*category: 'messages'/s)
  // The DM row must carry the peer so the tap opens that conversation.
  assert.match(realtime, /peer_username: me\.username[^}]*conversation_key: conv/s)
  const recordsInRealtime = (realtime.match(/recordNotificationsSafe\(this\.env/g) || []).length
  assert.equal(recordsInRealtime, 3, 'DM, group and department sends all record')
})

test('chat collapses to one unread row per conversation, not one per message', () => {
  assert.match(notifLib, /const CHAT_TYPES = new Set\(\['chat', 'group_chat', 'department_chat'\]\)/)
  assert.match(notifLib, /DELETE FROM notifications[\s\S]{0,160}read_at IS NULL AND target LIKE \? ESCAPE '\\\\'/)
  // Wildcards inside the conversation key must not widen the match.
  assert.match(notifLib, /replace\(\/\[\\\\%_\]\/g, ch => `\\\\\$\{ch\}`\)/)
  // A batch carrying several messages for one conversation still inserts one row.
  assert.match(notifLib, /lastChatRow\.get\(`\$\{r\.userId\}\|\$\{r\.type\}\|\$\{key\}`\) === i/)
  // Big fan-outs are chunked under D1's bound-parameter cap.
  assert.match(notifLib, /const INSERT_CHUNK = 25/)
})

test('an admin announcement reaches the bell and push, not just the chat inbox', () => {
  assert.match(usersRoute, /SELECT id, username FROM users WHERE active=1 AND id<>\\?/)
  assert.match(usersRoute, /const announcementId = uuid\(\)/)
  assert.match(usersRoute, /recordNotificationsSafe\(env, records\)/)
  assert.match(usersRoute, /collapseKey: `chat:announce:\$\{announcementId\}`/)
  assert.match(usersRoute, /requestKey: `announce:\$\{announcementId\}`/)
})

test('moderation outcomes are reported to the member whose upload was reviewed', () => {
  assert.match(pendingRoute, /type: 'moderation'/)
  assert.match(pendingRoute, /Your upload is live/)
  assert.match(pendingRoute, /Your upload was not approved/)
  assert.match(pendingRoute, /Reason: \$\{reason\}/)
  assert.match(pendingRoute, /userId: item\.user_id/)
  assert.match(pendingRoute, /userId: rows\[0\]\.user_id/)
})

test('Capacitor plugin proxies are never resolved directly from an async function', () => {
  // The Android bridge answers every property with a native method, including
  // `then`. An async function resolving to the proxy is therefore treated as a
  // thenable and rejects with "LocalNotifications.then() is not implemented".
  assert.doesNotMatch(lib, /return mod\.LocalNotifications/)
  assert.match(lib, /return \{ ln: mod\.LocalNotifications \}/)
  assert.doesNotMatch(pushLib, /return plugin as MessagingPlugin/)
  assert.match(pushLib, /return \{ messaging: plugin as MessagingPlugin \}/)
})

test('the FCM token is read from the field the plugin actually returns', () => {
  // @capacitor-firebase/messaging resolves getToken with { token }. Reading a
  // different key produced an empty string on every device, so registration
  // never posted and the admin sign-in code had no destination.
  assert.match(pushLib, /getToken\(options: \{ vapidKey\?: string \}\): Promise<\{ token\?: string/)
  assert.match(pushLib, /result\?\.token \|\| result\?\.value/)
})

test('an admin sign-in code reaching the app while it is open is always visible', () => {
  // Android draws no FCM notification while the app is foregrounded. The code is
  // needed within seconds by a browser, so it cannot be a four-second toast that
  // the admin was not looking at.
  const banner = adminCodeBanner
  assert.match(pushLib, /if \(data\.kind === 'admin_login_code' && data\.code\) void showAdminCodeNotification/)
  assert.match(lib, /export async function showAdminCodeNotification/)
  assert.match(lib, /channelId: 'admin-code'/, 'the code needs its own high-importance channel')
  assert.match(banner, /harvest:push-received/, 'the banner must follow the push event')
  assert.match(banner, /localStorage\.setItem\(KEY/, 'the code must survive the app being switched away')
  assert.match(app, /<AdminCodeBanner \/>/)
  assert.match(app, /if \(String\(n\?\.data\?\.kind \|\| ''\) === 'admin_login_code'\) return/, 'a code must not expire as a toast')
})

test('the badge reflects the server unread total, not the loaded page size', () => {
  // A 40-row page can only count 40; the count endpoint answers for the account.
  assert.match(notificationsRoute, /SELECT COUNT\(\*\) AS unread FROM notifications WHERE user_id=\? AND read_at IS NULL/)
  assert.match(notificationsRoute, /unread: Number\(unreadRow\.rows\[0\]\?\.unread\) \|\| 0/)
  assert.match(app, /const unreadCount = serverUnread \+ activityUnread/)
  assert.match(app, /setServerUnread\(count => Math\.max\(0, count - 1\)\)/)
  assert.match(app, /setServerUnread\(previousUnread\)/)
})

test('the bell badge updates live for announcements and DMs', () => {
  // One session-wide socket is the source of truth; the 60s poll is only a
  // fallback for when no socket is connected.
  assert.match(app, /connectSocket\(\)/)
  assert.match(app, /const offNew = onSocket\('notification:new', refreshBadge\)/)
  assert.match(app, /const offMessage = onSocket\('chat:message', refreshBadge\)/)
  assert.match(app, /enqueueNotificationMutation\(\(\) => refreshNotifications\(true\)\)/)
  // Announcements write bell rows and wake the recipient's socket.
  assert.match(usersRoute, /recordNotificationsSafe\(env, records\)/)
  assert.match(notifLib, /if \(live\) await Promise\.all\(list\.map\(record => publishLive\(env, record\)\)\)/)
  assert.match(realtime, /event: 'notification:new'/)
  // Incoming DMs also emit a chat frame, so the badge wakes even if the inbox
  // row lands a moment before the notification wake-up.
  assert.match(realtime, /event: 'chat:message', data:/)
})

test('signing out clears the previous member\'s inbox and derived read state', () => {
  assert.match(app, /const resetNotificationState = \(\) => \{/)
  assert.match(app, /localStorage\.removeItem\(ACTIVITY_READ_KEY\)/)
  assert.match(app, /disconnectSocket\(\)\n    resetNotificationState\(\)/, 'the realtime channel closes with the session')
  assert.match(app, /resetNotificationState\(\)\n    setOnboarded\(false\)/)
})

test('the inbox table is pruned by the cron, and actors load in one query', () => {
  assert.match(pendingRoute, /DELETE FROM notifications[\s\S]{0,200}read_at IS NOT NULL AND created_at < \?/)
  assert.match(notificationsRoute, /FROM users WHERE id IN \(\$\{placeholders\}\)/)
})

test('a push delivered while the app is open is surfaced, not silently dropped', () => {
  assert.match(app, /useForegroundPushToast\(\)/)
  assert.match(app, /addEventListener\('harvest:push-received', onPush\)/)
  assert.match(app, /showToast\(body \? `\$\{title\} — \$\{body\}` : title, 'info'/)
})
