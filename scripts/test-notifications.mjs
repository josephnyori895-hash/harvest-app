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
const hook = await readFile(new URL('../src/lib/useModalFocus.ts', import.meta.url), 'utf8')
const commentsSheet = await readFile(new URL('../src/components/Comments.tsx', import.meta.url), 'utf8')
const homeFeed = await readFile(new URL('../src/components/Home.tsx', import.meta.url), 'utf8')

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
  assert.match(notificationsRoute, /actor = \{ name: u\.name \|\| u\.username, username: u\.username/)
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
  assert.match(app, /className="absolute right-3 z-30 flex h-11 w-11/)
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
  assert.match(app, /useModalFocus\(dmSheet, dmLayerRef, \(\) => setDmSheet\(false\), \(\) => document\.querySelector\('\[data-testid="chat-fab"\]'\)\)/)
})

test('the inbox and the DM card stay floating cards, never fullscreen', () => {
  assert.match(app, /id="notifications-drawer"[\s\S]*?sm:h-\[min\(70dvh,560px\)\]/)
  assert.doesNotMatch(app, /id="notifications-drawer"[\s\S]{0,600}bottom-\[calc\(env\(safe-area-inset-bottom\)\+72px\)\]/)
  assert.match(app, /id="dm-layer"[\s\S]*?h-\[min\(56dvh,380px\)\]/)
  // The chat panel is cropped for the card, otherwise its header stack leaves
  // no room for a single conversation row.
  assert.match(app, /id="dm-layer"[\s\S]*?<Chat\s+compact/)
})

test('a failed refresh is reported instead of leaving a stale badge', () => {
  assert.match(app, /if \(!r\.ok\) throw new Error\(String\(r\.status\)\)/)
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
  assert.match(commentsSheet, /useModalFocus\(true, sheetRef, onClose\)/)
  assert.match(commentsSheet, /ref=\{sheetRef\} tabIndex=\{-1\}/)
  assert.match(homeFeed, /import \{ useModalFocus \} from '\.\.\/lib\/useModalFocus'/)
  assert.match(homeFeed, /useModalFocus\(!!menuPost, postMenuRef, \(\) => setMenuPost\(null\)\)/)
  assert.match(homeFeed, /ref=\{postMenuRef\} tabIndex=\{-1\}/)
})

test('the DM card is a dialog too: modal, focus in, Escape out', () => {
  assert.match(app, /ref=\{dmLayerRef\}[\s\S]{0,200}aria-modal="true"/)
  assert.match(app, /useModalFocus\(dmSheet, dmLayerRef, \(\) => setDmSheet\(false\), \(\) => document\.querySelector\('\[data-testid="chat-fab"\]'\)\)/)
  assert.match(app, /useModalFocus\(showNotifications, notificationsDrawerRef, \(\) => setShowNotifications\(false\)\)/)
  assert.match(hook, /const dialogs = Array\.from\(document\.querySelectorAll\('\[role="dialog"\]'\)\)/)
})
