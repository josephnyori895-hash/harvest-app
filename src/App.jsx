import { lazy, Suspense, useState, useEffect, useMemo, useRef } from 'react'
import { useModalFocus } from './lib/useModalFocus'
import { useAndroidBack } from './lib/useAndroidBack'
import { AuthProvider, useAuth } from './state/auth'
import { useCongregations } from './lib/useCongregations'
import Home from './components/Home'
import Reels from './components/Reels'
import Search from './components/Search'
import Chat from './components/Chat'
import ViewUser from './components/ViewUser'
import EditProfile from './components/EditProfile'
import Music from './components/Music'
import Sermons from './components/Sermons'
import Give from './components/Give'
import PostCreate from './components/PostCreate'
import Groups from './components/Groups'
import Departments from './components/Departments'
import { RequireRole } from './components/Protected'
import UserListModal from './components/UserListModal'
import { showToast, ToastContainer } from './components/Toast'
import { AdminCodeBanner } from './components/AdminCodeBanner'
import UploadPill from './components/UploadPill'
import NowPlayingBar from './components/NowPlayingBar'
import ErrorMessage from './components/ErrorMessage'
import NotificationsScreen from './components/NotificationsScreen'
import { Icon, Spinner } from './ui'
import { VerifiedBadge } from './components/VerifiedBadge'
import YouthChurchAnimation from './components/YouthChurchAnimation'
import LandingBackdrop from './components/LandingBackdrop'
import { installSessionGuard, SESSION_EXPIRED_EVENT } from './lib/session'
import { adminDeviceIdentity } from './lib/adminDevice'
import { connectSocket, disconnectSocket, onSocket } from './lib/realtime'
import { describeError } from './lib/actionFeedback'
import { apiGet } from './lib/api'

// Global fetch guard: any 401 from the API (expired 24h/7d JWT) raises ONE
// session-expired event so the app can return to login with a clear message,
// instead of Departments/Groups/Activity/comments failing silently.
installSessionGuard()

// Heavy screens sit behind a lazy boundary. Importing them statically put the
// map engine (~240 kB) and the whole admin console in the first-paint bundle,
// so a member opening the feed downloaded both before seeing a post.
const HarvestMap = lazy(() => import('./components/HarvestMap'))
const Admin = lazy(() => import('./components/Admin'))

import { initNotifications, fetchFamilyActivity } from './lib/notifications'
import { registerPush, disablePushOnLogout, getPushStatus, getPushTokenHint, isPushSupported, PUSH_STATUS_EVENT } from './lib/push'
import { getUploadHistory, getUploads, subscribeUploads, clearUploadHistory } from './lib/backgroundUploads'
// Push tap routing: a notification tap emits harvest:push-tap with a
// normalized deep link; route it through the app's existing navigation
// (DM → openDm, group/department → teamChat), everything else → tab switch.
function usePushTapRouting(openDm, setTab, setTeamChat) {
  useEffect(() => {
    const onTap = (e) => {
      const tap = (e && e.detail) || null
      if (!tap) return
      if (tap.tab === 'chat') {
        if (tap.kind === 'dm' && tap.dm) { openDm(tap.dm); setTab('chat') }
        else if (tap.kind === 'group' && tap.slug) { setTeamChat({ kind: 'group', slug: tap.slug, name: tap.name || tap.slug }); setTab('chat') }
        else if (tap.kind === 'department' && tap.slug) { setTeamChat({ kind: 'department', slug: tap.slug, name: tap.name || tap.slug }); setTab('chat') }
        else setTab('chat')
      } else if (tap.tab && tap.tab !== 'home') setTab(tap.tab)
      else setTab('home')
    }
    window.addEventListener('harvest:push-tap', onTap)
    return () => window.removeEventListener('harvest:push-tap', onTap)
  }, [openDm, setTab, setTeamChat])
}

// The OS does not draw an FCM notification while the app is in the foreground,
// so a delivery during use used to be silent. Surface it as the in-app toast.
// Admin codes are the exception: they need to stay on screen, so they get the
// persistent banner instead of a toast nobody can retype from.
function useForegroundPushToast() {
  useEffect(() => {
    const onPush = (e) => {
      const n = (e && e.detail) || {}
      if (String(n?.data?.kind || '') === 'admin_login_code') return
      const title = String(n.title || 'Harvest Family')
      const body = String(n.body || '').trim()
      showToast(body ? `${title} — ${body}` : title, 'info', 4000)
    }
    window.addEventListener('harvest:push-received', onPush)
    return () => window.removeEventListener('harvest:push-received', onPush)
  }, [])
}
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// Placeholder shown while a lazy tab's chunk arrives — the shell, header and
// bottom bar stay mounted around it.
function TabFallback({ label }) {
  return (
    <div className="grid min-h-[40vh] place-items-center gap-2 px-4 text-center text-sm text-ink-muted">
      <Spinner size={20} />
      <p>{label}</p>
    </div>
  )
}

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Family activity (new members, follows) is derived on the client, so the server
// has no row to mark read. Without a local read record, every poll resurrected
// those rows as unread — the bell badge could never be cleared and tapping one
// sent an unknown id to /api/notifications/:id/read, which 404s.
const ACTIVITY_READ_KEY = 'harvest:activity-read'
const isLocalNotification = id => String(id || '').startsWith('activity:')
function loadActivityRead() {
  try { return new Set(JSON.parse(localStorage.getItem(ACTIVITY_READ_KEY) || '[]')) } catch { return new Set() }
}
function saveActivityRead(read) {
  try { localStorage.setItem(ACTIVITY_READ_KEY, JSON.stringify([...read].slice(-300))) } catch { /* storage full/private mode */ }
}

// Real member directory from the server (replaces the old mock user list).
// Auto-refreshes when verification/admin actions fire 'harvest:verified'.
function useDirectory(enabled, refreshMs = 120000) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const load = () => {
    if (users.length === 0) setLoading(true)
    fetch(API + '/api/users/map', { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('directory unavailable'))))
      .then(d => {
        if (!Array.isArray(d.users)) throw new Error('directory unavailable')
        const me = localStorage.getItem('harvest_username') || ''
        setUsers(d.users.map(u => ({ ...u, group: u.group_name, me: u.username === me })))
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (!enabled) return
    load()
    window.addEventListener('harvest:verified', load)
    window.addEventListener('harvest:profile-updated', load)
    // Group settings save a new registration location; the map must pick the
    // new coordinates up without waiting for the next 30s poll or a reload.
    window.addEventListener('harvest:groups-changed', load)
    const refreshOnVisible = () => { if (document.visibilityState === 'visible') load() }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, refreshMs)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshOnVisible)
      window.removeEventListener('harvest:verified', load)
      window.removeEventListener('harvest:profile-updated', load)
      window.removeEventListener('harvest:groups-changed', load)
    }
  }, [enabled, refreshMs])
  return [users, setUsers, loading, error, load]
}

// In-app update prompt (Android): compares installed versionCode against the
// Worker's release; 'Later' hides for 24h. Web builds never see it.
function UpdateGate({ children }) {
  const [update, setUpdate] = useState(null)
  const [hidden, setHidden] = useState(true)
  const [install, setInstall] = useState(null)
  const updatePanelRef = useRef(null)
  const installStopRef = useRef(null)
  useEffect(() => {
    let live = true
    let busy = false
    // The check belongs to the app logo, not to the session. It runs on a cold
    // open, whenever the app returns to the foreground, and every ten minutes,
    // so a release published while someone is sitting on the welcome screen is
    // still offered to them. No token is required: /api/app-version is public.
    //
    // The opening check ignores "Remind me later": that button quiets the
    // in-session checks for an hour, but a member who closed the prompt and then
    // reopened the app is told again. Honouring the cooldown here made the
    // prompt appear exactly once, which is how a stale install went unnoticed.
    const check = async (opening = false) => {
      if (busy) return
      busy = true
      try {
        const { checkForUpdate, isDismissed } = await import('./lib/appUpdate')
        const info = await checkForUpdate()
        if (!live) return
        if (info.available && (opening || !isDismissed(info.versionCode))) {
          setUpdate(info)
          setHidden(false)
        }
      } catch { /* offline is not an update failure the user can act on */ }
      finally { busy = false }
    }
    void check(true)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, 10 * 60_000)
    return () => {
      live = false
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  // The native plugin reports download progress here. Keeping the listener
  // mounted lets it continue after the one-time Android install-permission
  // screen, which is the only moment the member leaves the app.
  useEffect(() => () => { installStopRef.current?.() }, [])

  // Returning from the package installer means the member either installed the
  // update (this process is replaced) or cancelled. Reset the button so a
  // cancelled install can be retried instead of staying disabled forever.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setInstall(current => (current?.status === 'installing' ? null : current))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const installBusy = install?.status === 'starting' || install?.status === 'downloading' ||
    install?.status === 'permission' || install?.status === 'installing'

  const updateNow = async () => {
    if (installBusy) return
    installStopRef.current?.()
    installStopRef.current = null
    setInstall({ status: 'starting', message: 'Starting download…' })
    try {
      const { checkForUpdate, startUpdateInstall } = await import('./lib/appUpdate')
      // The prompt can sit open for up to ten minutes while a release is
      // published. Re-read the manifest so the URL and digest describe the same
      // bytes instead of downloading a newer APK against the old checksum.
      const latest = await checkForUpdate()
      const target = latest.available ? latest : update
      if (latest.available) setUpdate(latest)
      installStopRef.current = await startUpdateInstall(target.apkUrl, target.sha256, setInstall)
    } catch {
      setInstall({
        status: 'error',
        message: 'Couldn’t start the update. Check your connection and try again.',
      })
    }
  }

  const later = () => {
    // The visible buttons are disabled while downloading, but Escape reaches
    // this handler through useModalFocus. Closing here would remove the status
    // listener while the native download keeps running and later opens the
    // installer unannounced.
    if (installBusy) return
    installStopRef.current?.()
    installStopRef.current = null
    setInstall(null)
    import('./lib/appUpdate').then(({ dismissUpdate }) => {
      dismissUpdate(update?.versionCode || 0)
      setHidden(true)
    })
  }
  useModalFocus(Boolean(update && !hidden), updatePanelRef, later)

  return (
    <>
      {children}
      {update && !hidden && (
        <div
          data-testid="update-prompt"
          className="fixed inset-0 z-[100] grid place-items-center bg-ink/65 px-5 py-8 backdrop-blur-sm"
        >
          <div
            ref={updatePanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-prompt-title"
            aria-describedby="update-prompt-copy"
            tabIndex={-1}
            className="w-full max-w-[380px] overflow-hidden rounded-[28px] border border-white/10 bg-[#1d1629] p-6 text-center text-white shadow-2xl outline-none"
            style={{ maxHeight: 'calc(100dvh - 4rem)', overflowY: 'auto' }}
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/20 text-gold">
              <Icon name="sparkle" size={26} />
            </div>
            <p className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.2em] text-gold">Harvest Family Church</p>
            <h2 id="update-prompt-title" className="mt-1.5 text-[22px] font-extrabold leading-tight">Update available</h2>
            <p id="update-prompt-copy" className="mx-auto mt-2 max-w-[300px] text-[13px] leading-6 text-white/60">
              A newer version of the church app is ready{update.versionName ? ` (v${update.versionName})` : ''}. Update now to keep everything working smoothly.
            </p>
            <button
              type="button"
              onClick={updateNow}
              disabled={installBusy}
              className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-full bg-accent px-4 text-[14px] font-extrabold text-white shadow-lg transition active:scale-[0.99] active:bg-accent-strong disabled:cursor-wait disabled:opacity-70"
            >
              {install?.status === 'downloading' ? `Downloading${install.percent != null ? ` ${install.percent}%` : '…'}`
                : install?.status === 'installing' ? 'Opening installer…'
                : install?.status === 'permission' ? 'Allow installs'
                : install?.status === 'starting' ? 'Starting download…'
                : install?.status === 'error' ? 'Try again'
                : 'Update now'}
            </button>
            {install?.message && (
              <p role="status" aria-live="polite" className={`mx-auto mt-3 max-w-[300px] text-[12px] leading-5 ${install.status === 'error' || install.status === 'permission-denied' ? 'text-rose-300' : 'text-white/55'}`}>
                {install.message}
              </p>
            )}
            <button
              type="button"
              onClick={later}
              disabled={installBusy}
              className="mt-2 min-h-11 w-full rounded-full text-[13px] font-bold text-white/60 underline-offset-4 active:text-white disabled:opacity-40"
            >Remind me later</button>
          </div>
        </div>
      )}
    </>
  )
}

// Floating panels (inbox, DM card) are dialogs: focus in, Tab trapped,
// Escape topmost-only, focus returned on close. Behaviour lives in lib/useModalFocus.

function InnerApp() {
  const { setUsername, setRole, setVerified, verified, isAdmin } = useAuth()
  const [onboarded, setOnboarded] = useState(() => !!localStorage.getItem('harvest_token'))
  const [tab, setTab] = useState('home')
  // Live browser sign-in approval for the admin phone. A browser that knows the
  // admin password asks this phone over the realtime socket; approving reveals
  // the code, denying kills the attempt.
  const [adminLoginAsk, setAdminLoginAsk] = useState(null)
  const [adminLoginBusy, setAdminLoginBusy] = useState('')
  const [adminLoginApproved, setAdminLoginApproved] = useState(false)
  // The phone answers here, not inside Nav: the request arrives on this
  // screen's authenticated socket and drives the modal below.
  useEffect(() => {
    if (!isAdmin || !onboarded) return
    return onSocket('admin:login-request', (data) => {
      if (!data?.challenge_id) return
      // Any already-trusted admin session may answer — the phone app, or a
      // browser the admin is signed in on — but never the device asking for a
      // code: that would approve itself.
      const me = adminDeviceIdentity()
      if (data.device_kind === me.device_kind && data.device_id === me.device_id) return
      setAdminLoginAsk(data)
      setAdminLoginApproved(false)
    })
  }, [isAdmin, onboarded])

  const decideAdminLogin = async (decision) => {
    const id = adminLoginAsk?.challenge_id
    if (!id || adminLoginBusy) return
    setAdminLoginBusy(decision)
    try {
      const response = await fetch(`${API}/api/auth/admin/requests/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('harvest_token') || ''}` },
        body: JSON.stringify({ decision }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not update the sign-in')
      if (decision === 'deny') { setAdminLoginAsk(null); return }
      setAdminLoginApproved(true)
    } catch (e) {
      showToast(e?.message || 'Could not update the sign-in', 'error')
    } finally { setAdminLoginBusy('') }
  }
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notificationFilter, setNotificationFilter] = useState('all')
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsRefreshing, setNotificationsRefreshing] = useState(false)
  const [notificationsError, setNotificationsError] = useState(null)
  const [notificationActionError, setNotificationActionError] = useState(null)
  const [notificationPendingIds, setNotificationPendingIds] = useState(() => new Set())
  const [notificationMarkAllPending, setNotificationMarkAllPending] = useState(false)
  // Paging: the inbox shows the newest page and asks for older activity as the
  // member scrolls, so a year of activity is reachable instead of only the
  // first screenful.
  const [notificationsNextOffset, setNotificationsNextOffset] = useState(0)
  const [notificationsHasMore, setNotificationsHasMore] = useState(false)
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false)
  // Scroll handoff can fire twice before React re-renders; guard synchronously.
  const notificationsPagingRef = useRef(false)
  const notificationMutationQueueRef = useRef(Promise.resolve())
  const dmLayerRef = useRef(null)
  const notificationsDrawerRef = useRef(null)
  const adminLoginPanelRef = useRef(null)
  // The server owns the true unread total. The inbox only holds one page, so
  // counting the visible rows capped the badge at the page size and it could
  // never show "47" once a member had more unread than a page.
  const [serverUnread, setServerUnread] = useState(0)
  // Family activity has no server row (it is derived from /api/activity), so
  // those unread rows are counted locally and added to the server total.
  const activityUnread = useMemo(
    () => notifications.reduce((count, n) => count + (isLocalNotification(n.id) && !n.read_at ? 1 : 0), 0),
    [notifications],
  )
  // One derivation for the badge, the bell's label and the panel's mark-all
  // button — the count used to be recomputed three times a render, which is
  // how the label and the visible badge drift apart.
  const unreadCount = serverUnread + activityUnread
  const activityReadRef = useRef(null)
  const activityReadSet = () => (activityReadRef.current ||= loadActivityRead())
  // Re-apply locally recorded reads whenever activity rows are merged, so the
  // optimistic read survives the background poll that replaces the list.
  const withLocalRead = rows => {
    const read = activityReadSet()
    return rows.map(r => (isLocalNotification(r.id) && !r.read_at && read.has(String(r.id)) ? { ...r, read_at: 'local' } : r))
  }
  const applyServerUnread = d => {
    const total = Number(d?.unread)
    if (d && d.unread !== undefined && Number.isFinite(total)) { setServerUnread(Math.max(0, total)); return }
    // Defensive for an older worker that does not send the total yet.
    const rows = Array.isArray(d?.notifications) ? d.notifications : []
    setServerUnread(rows.filter(n => !n.read_at && !isLocalNotification(n.id)).length)
  }
  // Sign-out (and an expired session) must not leave the previous member's
  // inbox or badge on screen for whoever signs in next.
  const resetNotificationState = () => {
    setNotifications([])
    setServerUnread(0)
    setNotificationFilter('all')
    setNotificationsError(null)
    setNotificationActionError(null)
    setNotificationPendingIds(new Set())
    setNotificationMarkAllPending(false)
    setNotificationsNextOffset(0)
    setNotificationsHasMore(false)
    try { localStorage.removeItem(ACTIVITY_READ_KEY) } catch { /* private mode */ }
    activityReadRef.current = null
  }
  const [sharedContent, setSharedContent] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const kind = params.get('shared')
      const id = params.get('id')?.trim()
      if (id && (kind === 'post' || kind === 'reel' || kind === 'story')) return { kind, id }
      if (params.has('shared') || params.has('id')) {
        params.delete('shared')
        params.delete('id')
        window.history.replaceState({}, '', params.toString() ? `${window.location.pathname}?${params.toString()}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`)
      }
      return null
    } catch { return null }
  })
  // Bumped whenever Home is chosen from the nav, so the feed can take the
  // member to the newest post instead of leaving them wherever they were.
  const [homeFocusKey, setHomeFocusKey] = useState(0)
  // A sponsored project card can open the exact campaign on the Give tab, not
  // just drop the member at the top of a long project list.
  const [giveFocusProject, setGiveFocusProject] = useState(null)
  useEffect(() => {
    if (!sharedContent) return
    if (sharedContent.kind === 'reel') setTab('reels')
    else setTab('home')
  }, [sharedContent])

  const clearSharedContent = () => {
    setSharedContent(null)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('shared')
      url.searchParams.delete('id')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    } catch {}
  }

  // Search → Reels deep link: reuse the shared-reel jump mechanism.
  const [searchReelId, setSearchReelId] = useState(null)
  const openReelFromSearch = (reelId) => {
    setSearchReelId(reelId)
    setBackTarget('search')
    setTab('reels')
  }
  // Search → Sermons deep link: auto-open the matched sermon.
  const [searchSermonId, setSearchSermonId] = useState(null)
  const openSermonFromSearch = (sermonId) => {
    setSearchSermonId(sermonId)
    setBackTarget('search')
    setTab('sermons')
  }

  // Per-tab scroll memory: display:none wipes an ancestor scroller's position,
  // so remember where each tab was and restore it on return — the IG feel
  // (leaving Home and coming back keeps your place in the feed).
  const scrollMemoryRef = useRef({})
  useEffect(() => {
    // Home owns its own landing position: every Home tap refreshes the head and
    // scrolls to the newest card. Restoring the old feed scroll here raced that
    // and could park the member halfway down the old page after the refresh.
    if (tab === 'home') return
    const target = scrollMemoryRef.current[tab] || 0
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { const el = document.querySelector('.app-content'); if (el) el.scrollTop = target })
    })
  }, [tab])

  const handleTab = (t) => {
    // Save the outgoing tab's scroll BEFORE React swaps the children — after
    // the swap the scroller's position is already clamped to the new content.
    if (t !== tab) {
      const el = document.querySelector('.app-content')
      if (el && el.scrollTop > 0) scrollMemoryRef.current[tab] = el.scrollTop
    }
    if (t === 'home') setHomeFocusKey(x => x + 1)
    if (t === 'chat' && tab !== 'chat') {
      setChatReturnTab(tab)
      setTeamChat(null)
    }
    // The nav sits above the drawer, so leaving it open across a tab switch
    // landed an old inbox over a new screen. Close it with the navigation.
    if (t !== tab) setShowNotifications(false)
    setTab(t)
  }
  const openGive = (projectId) => {
    setGiveFocusProject(projectId ? String(projectId) : null)
    handleTab('give')
  }
  const [viewUser, setViewUser] = useState(null)
  const [backTarget, setBackTarget] = useState('search')
  // Open someone's profile from wherever we are (feed, reels, stories) and
  // remember the origin tab so Back returns there — not always Search.
  const openProfile = (u) => { setBackTarget(tab); setViewUser(u); setTab('viewuser') }
  const [editProfileKey, setEditProfileKey] = useState(0)
  const [teamChat, setTeamChat] = useState(null)
  const [dmTarget, setDmTarget] = useState(null)
  const [dmSheet, setDmSheet] = useState(false)
  // Mini Chat: a compact panel that can be parked as a bubble while the member
  // keeps using the rest of the app. It stays mounted while minimised so the
  // open conversation and draft survive.
  const [dmMinimized, setDmMinimized] = useState(false)
  const [miniPeer, setMiniPeer] = useState(null)
  const [chatReturnTab, setChatReturnTab] = useState('home')
  // The floating chat bubble is an unread affordance, not a permanent shortcut.
  // It only exists while the server says there is something new to answer.
  const [chatUnread, setChatUnread] = useState({ count: 0, latest: null })
  // A single Chat surface owns all team conversations. Departments and Chats
  // only choose the same target; they never maintain separate chat state.
  const openTeamChat = (kind, slug, name) => {
    setChatReturnTab(tab)
    setTeamChat({ kind, slug, name })
    setTab('chat')
  }
  const closeTeamChat = () => {
    setTeamChat(null)
    setTab(chatReturnTab || 'home')
  }
  const enqueueNotificationMutation = (task) => {
    const run = notificationMutationQueueRef.current.then(() => task(), () => task())
    notificationMutationQueueRef.current = run.catch(() => {})
    return run
  }

  const markNotificationRead = async (notificationId) => {
    const previous = notifications.find(n => n.id === notificationId)
    if (!previous || previous.read_at) return true
    if (isLocalNotification(notificationId)) {
      const read = activityReadSet()
      read.add(String(notificationId))
      saveActivityRead(read)
      setNotifications(current => current.map(n => n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n))
      return true
    }
    const optimisticReadAt = new Date().toISOString()
    setNotifications(current => current.map(n => n.id === notificationId ? { ...n, read_at: optimisticReadAt } : n))
    setServerUnread(count => Math.max(0, count - 1))
    setNotificationPendingIds(current => new Set(current).add(notificationId))
    setNotificationActionError(null)
    return enqueueNotificationMutation(async () => {
      try {
        const r = await fetch(`${API}/api/notifications/${encodeURIComponent(notificationId)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
        })
        if (!r.ok) throw new Error('read failed')
        return true
      } catch {
        setNotifications(current => current.map(n => n.id === notificationId && n.read_at === optimisticReadAt ? previous : n))
        setServerUnread(count => count + 1)
        setNotificationActionError('Couldn’t mark notification as read. Please try again.')
        return false
      } finally {
        setNotificationPendingIds(current => {
          const next = new Set(current)
          next.delete(notificationId)
          return next
        })
      }
    })
  }

  // Fetch the notification list. Called once after sign-in and whenever the
  // bell panel opens, so the badge and the panel reflect fresh records.
  const [, setNotificationsLoadedOnce] = useState(false)
  useEffect(() => {
    if (!onboarded) return
    let cancelled = false
    setNotificationsLoading(true)
    apiGet('/api/notifications?limit=40')
      .then(d => {
        if (cancelled) return
        setNotifications(Array.isArray(d?.notifications) ? d.notifications : [])
        applyServerUnread(d)
        setNotificationsNextOffset(Number(d?.nextOffset) || 0)
        setNotificationsHasMore(Boolean(d?.hasMore))
        setNotificationsError(null)
      })
      .catch(() => { if (!cancelled) setNotificationsError('Notifications are unavailable right now.') })
      .finally(() => { if (!cancelled) { setNotificationsLoading(false); setNotificationsLoadedOnce(true) } })
    // Family-directory activity rides the same inbox (Activity+Notifications
    // merge): normalized into notification rows and prepended to the list.
    fetchFamilyActivity()
      .then(rows => {
        if (cancelled) return
        setNotifications(prev => {
          // Activity rides the same inbox; merge by id so the background poll
          // (or a fast panel reopen) can never stack the same row twice.
          const seen = new Set(prev.map(n => String(n.id)))
          return [...withLocalRead(rows).filter(r => !seen.has(String(r.id))), ...prev]
        })
      })
      .catch(() => { /* additive only — never block the inbox on it */ })
    return () => { cancelled = true }
  }, [onboarded])

  const refreshNotifications = async (silent = false) => {
    if (!silent) setNotificationsRefreshing(true)
    try {
      const d = await apiGet('/api/notifications?limit=40')
      setNotifications(Array.isArray(d?.notifications) ? d.notifications : [])
      applyServerUnread(d)
      setNotificationsNextOffset(Number(d?.nextOffset) || 0)
      setNotificationsHasMore(Boolean(d?.hasMore))
      // A transient failure used to leave "unavailable" on screen forever.
      setNotificationsError(null)
      const fam = await fetchFamilyActivity().catch(() => null)
      if (fam) setNotifications(prev => {
        const seen = new Set(prev.map(n => String(n.id)))
        return [...withLocalRead(fam).filter(n => !seen.has(String(n.id))), ...prev]
      })
    } catch {
      // Never fail silently: the last good list stays, the panel shows its
      // "couldn't refresh" banner with a retry, and a stale badge is visible
      // instead of being mistaken for a live one.
      setNotificationsError('Notifications are unavailable right now.')
    } finally {
      if (!silent) setNotificationsRefreshing(false)
    }
  }

  const loadMoreNotifications = async () => {
    if (notificationsPagingRef.current || !notificationsHasMore) return
    notificationsPagingRef.current = true
    setNotificationsLoadingMore(true)
    try {
      const d = await apiGet(`/api/notifications?limit=40&offset=${notificationsNextOffset}`)
      const incoming = Array.isArray(d?.notifications) ? d.notifications : []
      setNotifications(prev => {
        // Family activity is merged into this list locally, so dedupe by id
        // rather than trusting the server page to be non-overlapping.
        const seen = new Set(prev.map(n => String(n.id)))
        return [...prev, ...incoming.filter(n => !seen.has(String(n.id)))]
      })
      setNotificationsNextOffset(Number(d?.nextOffset) || notificationsNextOffset + incoming.length)
      setNotificationsHasMore(Boolean(d?.hasMore))
    } catch {
      setNotificationActionError('Couldn’t load older notifications. Check your connection and try again.')
    } finally {
      notificationsPagingRef.current = false
      setNotificationsLoadingMore(false)
    }
  }

  // The badge has to be live. Loading the inbox only at sign-in and when the
  // panel opens left the count stale for the whole session; poll quietly while
  // the app is in the foreground and refresh the moment it comes back.
  useEffect(() => {
    if (!onboarded) return
    let busy = false
    const tick = () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      // Ride the same queue as the read mutations: a poll that resolves after
      // a mark-read POST must not put the row back to unread.
      void enqueueNotificationMutation(() => refreshNotifications(true)).finally(() => { busy = false })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded])

  // Keep one realtime connection alive for the whole signed-in session. Chat
  // used to be the only component that connected, so the bell could not react
  // to announcements or DMs while the member stayed on Home. connectSocket is
  // a singleton, so opening Chat reuses this socket instead of adding another.
  useEffect(() => {
    if (!onboarded) return
    connectSocket()
    let timer = null
    const refreshBadge = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void enqueueNotificationMutation(() => refreshNotifications(true))
      }, 250)
    }
    const offNew = onSocket('notification:new', refreshBadge)
    const offMessage = onSocket('chat:message', refreshBadge)
    const offConnect = onSocket('connect', refreshBadge)
    return () => {
      window.clearTimeout(timer)
      offNew()
      offMessage()
      offConnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded])

  // Unread inbox for the floating reply bubble. Polling is intentionally light:
  // realtime events trigger an immediate refresh, and the 30 s poll catches the
  // case where the socket was asleep. The bubble never opens the full Chat tab.
  useEffect(() => {
    if (!onboarded) { setChatUnread({ count: 0, latest: null }); return }
    let cancelled = false
    const load = async () => {
      try {
        const d = await apiGet('/api/chat/conversations')
        if (cancelled) return
        const rows = [
          ...(Array.isArray(d?.conversations) ? d.conversations : []).map(c => ({
            kind: 'dm',
            id: String(c.peer || ''),
            username: String(c.peer || ''),
            name: c.peer_name || c.peer || 'Message',
            avatar_url: c.avatar_url || null,
            unread: Number(c.unread) || 0,
            last_at: c.last_at || null,
          })),
          ...(Array.isArray(d?.team_conversations) ? d.team_conversations : []).map(c => ({
            kind: c.kind === 'group' ? 'group' : 'department',
            slug: String(c.slug || ''),
            name: c.name || c.slug || 'Chat',
            unread: Number(c.unread) || 0,
            last_at: c.last_at || null,
          })),
        ].filter(c => c.unread > 0 && (c.kind !== 'dm' || c.username))
        rows.sort((a, b) => (Date.parse(b.last_at || 0) || 0) - (Date.parse(a.last_at || 0) || 0))
        setChatUnread({ count: rows.reduce((sum, c) => sum + c.unread, 0), latest: rows[0] || null })
      } catch { /* keep the last known unread bubble */ }
    }
    void load()
    const id = window.setInterval(load, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    const offMessage = onSocket('chat:message', () => { void load() })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      offMessage()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [onboarded, dmSheet, tab])

  // Open the latest unread conversation in the existing compact Chat card. The
  // feed stays mounted underneath; sending a reply never changes the tab.
  const openChatBubble = () => {
    const latest = chatUnread.latest
    if (!latest) return
    setChatReturnTab(tab)
    setDmMinimized(false)
    setDmTarget(null)
    setTeamChat(null)
    if (latest.kind === 'dm') {
      setDmTarget({ id: latest.id, username: latest.username, name: latest.name })
    } else {
      setTeamChat({ kind: latest.kind, slug: latest.slug, name: latest.name })
    }
    setDmSheet(true)
  }

  useModalFocus(showNotifications, notificationsDrawerRef, () => setShowNotifications(false))
  useModalFocus(dmSheet && !dmMinimized, dmLayerRef, () => setDmSheet(false), () => document.querySelector('[data-testid="chat-fab"]'))
  // The admin sign-in approval is a security dialog: focus must move into it,
  // Tab must stay inside, and Escape must deny rather than leave it open behind
  // the rest of the page.
  useModalFocus(Boolean(adminLoginAsk), adminLoginPanelRef, () => { setAdminLoginAsk(null); setAdminLoginApproved(false) })

  const openFullChatFromMini = () => {
    if (miniPeer?.username) {
      setDmTarget({
        id: String(miniPeer.id || miniPeer.username),
        username: String(miniPeer.username),
        name: miniPeer.name || String(miniPeer.username),
      })
    }
    setChatReturnTab(tab)
    setDmSheet(false)
    setDmMinimized(false)
    setTab('chat')
  }

  const markAllNotificationsRead = async () => {
    if (!notifications.some(n => !n.read_at) || notificationMarkAllPending) return true
    const previous = notifications
    const previousUnread = serverUnread
    const optimisticReadAt = new Date().toISOString()
    // Record the derived rows locally first: read-all only touches rows the
    // server owns, so activity notifications would come back unread otherwise.
    const readSet = activityReadSet()
    const addedLocal = []
    for (const n of notifications) {
      if (isLocalNotification(n.id) && !readSet.has(String(n.id))) { readSet.add(String(n.id)); addedLocal.push(String(n.id)) }
    }
    if (addedLocal.length) saveActivityRead(readSet)
    setNotifications(current => current.map(n => n.read_at ? n : { ...n, read_at: optimisticReadAt }))
    setServerUnread(0)
    setNotificationMarkAllPending(true)
    setNotificationActionError(null)
    return enqueueNotificationMutation(async () => {
      try {
        const r = await fetch(`${API}/api/notifications/read-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
        })
        if (!r.ok) throw new Error('mark all failed')
        return true
      } catch {
        if (addedLocal.length) {
          const rollback = activityReadSet()
          addedLocal.forEach(id => rollback.delete(id))
          saveActivityRead(rollback)
        }
        setNotifications(current => current.map(n => {
          if (n.read_at !== optimisticReadAt) return n
          return previous.find(p => p.id === n.id) || n
        }))
        setServerUnread(previousUnread)
        setNotificationActionError('Couldn’t mark all notifications as read. Please try again.')
        return false
      } finally {
        setNotificationMarkAllPending(false)
      }
    })
  }

  const handleNotificationPress = (notification, alsoIds = []) => {
    if (!notification) return
    if (!notification.read_at) void markNotificationRead(notification.id)
    // Aggregated rows ("Joy and 3 others liked") stand for several records;
    // opening one marks all of them read so the badge cannot disagree.
    for (const id of alsoIds) void markNotificationRead(id)
    const target = notification.target || {}
    if (target.type === 'chat' && target.user_id) {
      openDm({ id: target.user_id, username: target.peer_username || target.username, name: target.peer_name || target.name })
    } else if (target.type === 'group_chat') {
      openTeamChat('group', target.slug || target.group_id, target.name || 'Group')
    } else if (target.type === 'department_chat') {
      openTeamChat('department', target.slug || target.department_id, target.name || 'Department')
    } else if (notification.type === 'reel' && target.id) {
      setSearchReelId(String(target.id))
      setTab('reels')
    } else if (notification.type === 'project' && target.id) {
      setBackTarget(tab)
      setTab('give')
    } else if (notification.type === 'sermon' && target.id) {
      setSearchSermonId(String(target.id))
      setTab('sermons')
    } else if (notification.type === 'like' || notification.type === 'comment' || notification.type === 'comment_reply' || notification.type === 'mention') {
      // Instagram grammar: the tap lands on the thing that was liked/commented.
      // Posts have no detail route in this app, so a post comment opens the
      // member who wrote it instead of a dead link.
      if (target.type === 'reel' && target.id) { setSearchReelId(String(target.id)); setTab('reels') }
      else if (target.type === 'sermon' && target.id) { setSearchSermonId(String(target.id)); setTab('sermons') }
      else {
        const actor = notification.actor || {}
        if (actor.username) openProfile({ username: String(actor.username), name: actor.name || String(actor.username), verified: !!actor.verified })
      }
    } else if (notification.type === 'story_reply' || notification.type === 'follow' || notification.type === 'member_joined' || notification.type === 'followed_you' || notification.type === 'you_followed') {
      const actor = notification.actor || {}
      if (actor.username) openProfile({ username: String(actor.username), name: actor.name || String(actor.username), verified: !!actor.verified })
    }
    setShowNotifications(false)
  }

  // 'Pray with Pastor': open a 1:1 DM with the pastor's account from Home.
  // Instagram grammar: a DM opened from anywhere but the chat tab arrives as
  // a slide-in layer over the current screen — never a fullscreen tab swap.
  const openDm = (user) => {
    if (!user?.id || !user?.username) return
    setTeamChat(null)
    setDmTarget({ id: String(user.id), username: String(user.username), name: user.name || user.username })
    if (tab === 'chat') { setChatReturnTab('chat'); return }
    setChatReturnTab(tab)
    setDmSheet(true)
  }

  // Prayer is a destination, not a quick reply. Instagram keeps transient DMs in
  // the floating card, but "Ask for prayer" should land in the full Chat screen
  // with the pastor selected — the member can read history and compose there.
  const openFullDm = (user) => {
    if (!user?.id || !user?.username) return
    setChatReturnTab(tab)
    setTeamChat(null)
    setDmSheet(false)
    setDmMinimized(false)
    setDmTarget({ id: String(user.id), username: String(user.username), name: user.name || user.username })
    setTab('chat')
  }

  // Route notification taps (DM / group / department / tab deep links).
  usePushTapRouting(openDm, setTab, setTeamChat)
  useForegroundPushToast()

  // Admins get a faster directory refresh: the map's live-location view is
  // only useful if presence and pins are current.
  const [users, , directoryLoading, directoryError, refreshDirectory] = useDirectory(onboarded, isAdmin ? 60000 : 120000)

  const [userList, setUserList] = useState(null)

  const handleAuthSuccess = (data) => {
    localStorage.setItem('harvest_token', data.token)
    localStorage.setItem('harvest_username', data.username)
    localStorage.setItem('harvest_role', data.role)
    localStorage.setItem('harvest_verified', data.verified ? '1' : '0')
    setUsername(data.username)
    setRole(data.role)
    setVerified(Boolean(data.verified))
    setOnboarded(true)
    // Ask for notification permission right after sign-in — the OS prompt is
    // allowed only in direct response to a user action, which this is.
    void initNotifications()
    // FCM: acquire + register this device for push (fail-soft; native only).
    void registerPush()
  }

  const signOut = () => {
    // Disable push delivery for this installation before clearing the session
    // (the API call needs the token, so fire it first — fail-soft inside).
    void disablePushOnLogout()
    localStorage.removeItem('harvest_token')
    localStorage.removeItem('harvest_username')
    localStorage.removeItem('harvest_role')
    localStorage.removeItem('harvest_verified')
    localStorage.removeItem('harvest_msgs')
    localStorage.removeItem('harvest_pinned_chats')
    // Close the realtime socket too: leaving it open kept the previous member's
    // channel authenticated while the sign-in screen was showing.
    disconnectSocket()
    resetNotificationState()
    setOnboarded(false)
    setTab('home')
  }

  // Expired session: log out + tell the user why (members' tokens last 24h).
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem('harvest_token')
      localStorage.removeItem('harvest_username')
      localStorage.removeItem('harvest_role')
      localStorage.removeItem('harvest_verified')
      disconnectSocket()
      resetNotificationState()
      setOnboarded(false)
      setTab('home')
      showToast('Session expired — please sign in again', 'warning', 4000)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  // Boot check: a stored-but-invalid token logs out immediately (via the guard).
  useEffect(() => {
    if (!onboarded) return
    const t = localStorage.getItem('harvest_token') || ''
    if (!t) { setOnboarded(false); return }
    apiGet('/api/me')
      .then(d => {
        const u = d?.user
        if (!u) return
        setUsername(u.username || '')
        setRole(u.role === 'admin' ? 'admin' : 'member')
        setVerified(Boolean(u.verified))
      })
      .catch(() => {})
  }, [])

  // Register this device for push on every session start, not just on a fresh
  // sign-in. Updating the app or restoring a stored session used to skip
  // handleAuthSuccess entirely, so the phone never sent a token and the admin
  // sign-in code had nowhere to land. Re-running also picks up a rotated token
  // when the app comes back to the foreground; the server dedupes by token.
  useEffect(() => {
    if (!onboarded) return
    let cancelled = false
    const sync = () => {
      if (cancelled) return
      if (!(localStorage.getItem('harvest_token') || '')) return
      void registerPush()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [onboarded])

  // Verification is server-authoritative. An admin can verify (or unverify)
  // an account at any moment; the member's screen must reflect that without a
  // fresh login. Poll /api/me slowly, re-read on foreground, and react to the
  // events admin actions already broadcast.
  useEffect(() => {
    if (!onboarded) return
    let cancelled = false
    const syncIdentity = () => {
      const t = localStorage.getItem('harvest_token') || ''
      if (!t) return
      apiGet('/api/me')
        .then(d => {
          const u = d?.user
          if (!u || cancelled) return
          if (u.username) setUsername(u.username)
          setRole(u.role === 'admin' ? 'admin' : 'member')
          setVerified(Boolean(u.verified))
        })
        .catch(() => { /* keep the last known identity */ })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') syncIdentity() }
    const id = window.setInterval(syncIdentity, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('harvest:verified', syncIdentity)
    window.addEventListener('harvest:profile-updated', syncIdentity)
    syncIdentity()
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('harvest:verified', syncIdentity)
      window.removeEventListener('harvest:profile-updated', syncIdentity)
    }
  }, [onboarded, setRole, setUsername, setVerified])

  // Android hardware back: pop overlays/tabs; exit only from Home.
  useEffect(() => {
    if (!onboarded) return
    let sub = null
    let disposed = false
    import('@capacitor/app').then(({ App: CapApp }) => {
      if (disposed) return
      CapApp.addListener('backButton', () => {
        // Let nested Groups/Departments/Chat screens consume Android back first.
        const nestedBack = { handled: false }
        window.dispatchEvent(new CustomEvent('harvest:nested-back', { detail: nestedBack }))
        if (nestedBack.handled) return
        if (userList) return setUserList(null)
        if (dmSheet) return setDmSheet(false)
        if (showNotifications) return setShowNotifications(false)
        if (viewUser) { setViewUser(null); return setTab(backTarget) }
        if (tab === 'editprofile') return setTab('profile')
        if ((tab === 'groups' || tab === 'departments') && chatReturnTab === 'chat') return setTab('chat')
        if (tab !== 'home') return setTab('home')
        // departments has no back stack of its own — treat like other tabs
        CapApp.exitApp()
      }).then(s => { sub = s })
    }).catch(() => { /* web build: no hardware back */ })
    return () => { disposed = true; try { sub?.remove?.() } catch {} }
  }, [onboarded, tab, userList, viewUser, backTarget, chatReturnTab, dmSheet, showNotifications])

  // Global silent-failure net: any unhandled rejection or runtime error raises a
  // visible, readable toast. The member never has to guess whether something
  // worked — "no silence" applies to the whole app, not just known actions.
  useEffect(() => {
    const onRejection = (e) => {
      const text = describeError(e?.reason, 'An action failed')
      if (/AbortError|NetworkError when attempting|cancelled/i.test(text)) return
      showToast(`Something went wrong — ${text}`, 'error', 6000)
    }
    const onError = (e) => {
      if (!e?.message) return
      showToast(`Something went wrong — ${e.message}`.slice(0, 200), 'error', 6000)
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  // The update check has to run on OPEN, not on sign-in. Returning Onboarding
  // here put the first screen outside UpdateGate, so a member sitting on the
  // sign-up screen with an outdated build was never told — the exact case the
  // prompt exists for (verified on Waydroid: 1629 installed, 1632 released, no
  // prompt until after login).
  if (!onboarded) return (
    <UpdateGate>
      <Onboarding onAuthSuccess={handleAuthSuccess} />
    </UpdateGate>
  )

  return (
    <UpdateGate>
    <div className="app-shell flex bg-surface" style={{ minHeight: 'var(--app-viewport-height, 100dvh)' }}>
      <Sidebar tab={tab} setTab={handleTab} />
      {/* Fluid on phones; on desktop the content column sits beside the rail
          instead of stretching a phone layout across the whole window. */}
      <div className="app-shell relative mx-auto flex w-full min-w-0 max-w-[560px] flex-col bg-surface xl:max-w-[620px]" style={{ height: 'var(--app-viewport-height, 100dvh)', maxHeight: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}>
        {/* absolute, not fixed: the content column is centred beside the desktop
            rail, so a viewport-anchored bell floated in the empty page margin —
            far from the drawer it opens. */}
        <button
          type="button"
          onClick={() => setShowNotifications(v => { const next = !v; if (next) void refreshNotifications(); return next })}
          aria-expanded={showNotifications}
          aria-controls="notifications-drawer"
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          className={`absolute right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card focus:outline-none focus-visible:ring-2 ${tab === 'post' ? 'hidden' : ''}`}
          style={{ top: 'calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + 8px)' }}
        >
          <Icon name="bell" size={20} />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-2xs font-bold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        <div className={`app-content app-scroll flex-1 ${tab === 'chat' ? 'overflow-hidden' : 'app-scroll-bottom-safe'}`}>
          <div className="contents">
          {/* Home stays mounted when switching tabs (hidden, not unmounted) so
              scroll position and loaded feed state survive the round-trip —
              the IG feel. Other tabs still mount on demand. */}
          <div className={tab === 'home' ? 'contents' : 'hidden'}>
            <Home setTab={handleTab} users={users} directoryLoading={directoryLoading} directoryError={directoryError} onRefreshDirectory={refreshDirectory} focusLatestKey={homeFocusKey} onOpenUser={openProfile} sharedContent={sharedContent} onSharedContentHandled={clearSharedContent} onOpenDm={openFullDm} onOpenGive={openGive} />
          </div>
          {tab === 'search' && <Search users={users} onView={u => { setBackTarget('search'); setViewUser(u); setTab('viewuser') }} onOpenUser={openProfile} onOpenGroups={() => { setBackTarget('search'); setTab('groups') }} onOpenDepartments={() => { setBackTarget('search'); setTab('departments') }} onOpenSermons={openSermonFromSearch} onOpenReel={openReelFromSearch} />}
          {tab === 'reels' && <Reels onOpenUser={openProfile} sharedReelId={sharedContent?.kind === 'reel' ? sharedContent.id : searchReelId} onSharedReelHandled={() => { if (sharedContent) clearSharedContent(); else setSearchReelId(null) }} />}
          {tab === 'post' && <PostCreate onDone={() => setTab('home')} />}
          {tab === 'profile' && <Profile users={users} onOpenAdmin={()=>setTab('admin')} onSignOut={signOut} onEditProfile={() => setTab('editprofile')} onOpenActivity={() => { setNotificationFilter('family'); setShowNotifications(true); void refreshNotifications() }} />}
          {tab === 'editprofile' && <EditProfile key={editProfileKey} onDone={() => { setEditProfileKey(k => k + 1); setTab('profile') }} />}
          {tab === 'chat' && (
            <Chat
              onBack={closeTeamChat}
              users={users}
              teamChat={teamChat}
              dmTarget={dmTarget}
              onDmOpened={() => setDmTarget(null)}
              onCloseTeam={closeTeamChat}
              onOpenGroups={() => { setChatReturnTab('chat'); setTeamChat(null); setTab('groups') }}
              onOpenDepartments={() => { setChatReturnTab('chat'); setTeamChat(null); setTab('departments') }}
              onOpenUser={openProfile}
            />
          )}
          {tab === 'viewuser' && <ViewUser user={viewUser} onBack={() => setTab(backTarget)} onEditProfile={viewUser?.me || viewUser?.username === localStorage.getItem('harvest_username') ? () => setTab('editprofile') : undefined} />}
          {tab === 'music' && <Music />}
          {tab === 'sermons' && <Sermons isAdmin={isAdmin} verified={verified} focusId={searchSermonId} onFocused={() => setSearchSermonId(null)} />}
          {tab === 'give' && <Give focusProjectId={giveFocusProject} onFocusHandled={() => setGiveFocusProject(null)} />}
          {tab === 'map' && (
            <Suspense fallback={<TabFallback label="Loading map…" />}>
              <HarvestMap users={users} onOpenUser={openProfile} onRefresh={refreshDirectory} />
            </Suspense>
          )}
          {tab === 'groups' && <Groups onOpenChat={(slug, name) => openTeamChat('group', slug, name)} onOpenUser={openProfile} />}
          {tab === 'departments' && <Departments onOpenDeptChat={(slug, name) => openTeamChat('department', slug, name)} onOpenUser={openProfile} />}
          {tab === 'admin' && (
            <RequireRole role="admin">
              <Suspense fallback={<TabFallback label="Loading admin console…" />}>
                <Admin
                  onBack={() => setTab('profile')}
                  users={users}
                  setUsers={()=>{}}
                  onOpenGroups={() => setTab('groups')}
                  onOpenDepartments={() => setTab('departments')}
                  onOpenSermons={() => setTab('sermons')}
                  onOpenMusic={() => setTab('music')}
                  onOpenGive={() => setTab('give')}
                  onOpenMap={() => setTab('map')}
                />
              </Suspense>
            </RequireRole>
          )}
          </div>
        </div>
        {userList && <UserListModal type={userList.type} userId={userList.userId} users={users} onBack={()=>setUserList(null)} />}
        {/* Instagram-style notifications: a slide-over drawer on top of the
            feed — never a fullscreen tab swap. The feed stays mounted
            underneath, the bottom bar stays visible, Android back closes it. */}
        {showNotifications && (
          <>
          {/* Scrim lets the feed show through, dimmed — the drawer is an
              overlay, not a screen swap. Tap the feed to dismiss. */}
          <button
            type="button"
            onClick={() => setShowNotifications(false)}
            aria-label="Close notifications"
            data-testid="notifications-drawer-backdrop"
            className="absolute inset-0 z-20 cursor-default bg-ink/30 backdrop-blur-[2px]"
          />
          {/* Phone: the Activity experience — full width, from under the bell to
              the top of the tab bar, no floating-card margin. Desktop keeps the
              compact dropdown beside the feed. */}
          <div
            id="notifications-drawer"
            ref={notificationsDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications drawer"
            tabIndex={-1}
            className="drawer-anim absolute inset-x-0 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+56px)] bottom-[calc(var(--safe-area-inset-bottom,0px)+60px)] z-30 flex flex-col overflow-hidden border-y border-line bg-surface outline-none sm:inset-x-auto sm:right-3 sm:bottom-auto sm:h-[min(70dvh,560px)] sm:w-[380px] sm:rounded-3xl sm:border sm:shadow-2xl lg:top-[72px]"
          >
            <NotificationsScreen
              notifications={notifications}
              filter={notificationFilter}
              loading={notificationsLoading}
              refreshing={notificationsRefreshing}
              error={notificationsError}
              actionError={notificationActionError}
              unreadCount={unreadCount}
              pendingNotificationIds={notificationPendingIds}
              markAllPending={notificationMarkAllPending}
              onFilterChange={setNotificationFilter}
              onNotificationPress={handleNotificationPress}
              onRetry={() => { void refreshNotifications() }}
              onMarkAllRead={markAllNotificationsRead}
              onDismissActionError={() => setNotificationActionError(null)}
              onBack={() => setShowNotifications(false)}
              hasMore={notificationsHasMore}
              loadingMore={notificationsLoadingMore}
              onLoadMore={() => { void loadMoreNotifications() }}
            />
          </div>
          </>
        )}
        {/* Mini Chat: a compact floating panel, not a screen swap. There is no
            backdrop, so the feed underneath stays visible and scrollable. It
            minimises to a bubble without unmounting, and can hand the same
            conversation to the full-screen chat. */}
          {dmSheet && tab !== 'chat' && (
            <div
              ref={dmLayerRef}
              id="dm-layer"
              role="dialog"
              aria-modal="false"
              aria-label="Mini chat"
              tabIndex={-1}
              data-testid="dm-layer"
              className={`drawer-anim absolute bottom-[calc(env(safe-area-inset-bottom,0px)+68px)] left-3 right-3 z-30 h-[min(50dvh,420px)] min-h-[320px] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl sm:left-auto sm:right-3 sm:w-[360px] ${dmMinimized ? 'hidden' : 'flex'}`}
            >
              <Chat
                compact
                onBack={() => { setDmSheet(false); setDmMinimized(false) }}
                users={users}
                teamChat={teamChat}
                dmTarget={dmTarget}
                onDmOpened={() => setDmTarget(null)}
                onActiveChange={setMiniPeer}
                onMinimize={() => setDmMinimized(true)}
                onExpand={openFullChatFromMini}
                onCloseTeam={() => setTeamChat(null)}
                onOpenGroups={() => { setDmSheet(false); setChatReturnTab(tab); setTeamChat(null); setTab('groups') }}
                onOpenDepartments={() => { setDmSheet(false); setChatReturnTab(tab); setTeamChat(null); setTab('departments') }}
                onOpenUser={(u) => { setDmSheet(false); openProfile(u) }}
              />
            </div>
          )}

        {dmSheet && dmMinimized && tab !== 'chat' && (
          <button
            type="button"
            onClick={() => setDmMinimized(false)}
            data-testid="chat-mini-bubble"
            aria-label={miniPeer ? `Reopen chat with ${miniPeer.name || miniPeer.username}` : 'Reopen mini chat'}
            className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] right-3 z-30 grid h-12 w-12 place-items-center overflow-hidden rounded-full border-2 border-surface bg-ink text-sm font-extrabold text-white shadow-raised transition active:scale-95"
          >
            {miniPeer?.avatar_url
              ? <img src={miniPeer.avatar_url} alt="" className="h-full w-full object-cover" />
              : miniPeer
                ? String(miniPeer.name || miniPeer.username || '?')[0].toUpperCase()
                : <Icon name="chat" size={20} />}
          </button>
        )}
        {/* Unread-only chat bubble. Tapping it opens the newest unread thread in
            the compact card above, so the member can reply without leaving the
            feed. No unread messages means no bubble at all. */}
        {onboarded && chatUnread.count > 0 && chatUnread.latest && tab !== 'chat' && tab !== 'reels' && tab !== 'post' && !dmSheet && (
          <button
            type="button"
            onClick={openChatBubble}
            aria-label={`New messages, ${chatUnread.count} unread — reply to ${chatUnread.latest.name || 'the latest chat'}`}
            data-testid="chat-fab"
            className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] right-3 z-20 grid h-10 w-10 place-items-center overflow-visible rounded-full border-2 border-surface bg-ink text-white shadow-raised transition active:scale-95"
          >
            {chatUnread.latest.kind === 'dm' && chatUnread.latest.avatar_url
              ? <img src={chatUnread.latest.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
              : <Icon name="chat" size={18} />}
            <span aria-hidden="true" className="absolute -right-1 -top-1 flex min-h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-extrabold leading-none text-white">
              {chatUnread.count > 9 ? '9+' : chatUnread.count}
            </span>
          </button>
        )}
        <UploadPill />
        <NowPlayingBar onOpen={t => setTab(t)} />
        {adminLoginAsk && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
            <div ref={adminLoginPanelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-login-ask-title" className="w-full max-w-[420px] rounded-3xl border border-line bg-surface p-5 pb-6 text-ink shadow-raised outline-none">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-strong">Admin sign-in request</p>
              <h2 id="admin-login-ask-title" className="mt-1 text-lg font-extrabold">
                {adminLoginApproved ? 'Browser approved' : 'Is this you signing in?'}
              </h2>
              {adminLoginApproved ? (
                <>
                  <p className="mt-2 text-[13px] text-ink-muted">Type this code in the browser within 10 minutes.</p>
                  <p className="mt-3 rounded-2xl border border-line bg-surface-sunken py-4 text-center text-4xl font-extrabold tracking-[0.3em]">{adminLoginAsk.code}</p>
                  <button type="button" onClick={() => { setAdminLoginAsk(null); setAdminLoginApproved(false) }} className="mt-4 min-h-12 w-full rounded-full bg-accent text-sm font-extrabold text-white">Done</button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[13px] leading-5 text-ink-muted">A browser is trying to sign in as the church admin.</p>
                  <div className="mt-3 space-y-1 rounded-2xl border border-line bg-surface-sunken p-3 text-[12px] text-ink-muted">
                    <p><span className="font-bold text-ink">Device:</span> {adminLoginAsk.label || 'Unknown browser'}</p>
                    <p><span className="font-bold text-ink">Network:</span> {adminLoginAsk.ip || 'unknown'}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" disabled={!!adminLoginBusy} onClick={() => void decideAdminLogin('deny')} className="min-h-12 flex-1 rounded-full border border-line bg-surface-sunken text-sm font-extrabold text-ink-muted disabled:opacity-50">Deny</button>
                    <button type="button" disabled={!!adminLoginBusy} onClick={() => void decideAdminLogin('approve')} className="min-h-12 flex-[1.4] rounded-full bg-accent text-sm font-extrabold text-white disabled:opacity-50">{adminLoginBusy === 'approve' ? 'Approving…' : 'Authorize'}</button>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-ink-subtle">If this isn't you, tap Deny and change the admin password.</p>
                </>
              )}
            </div>
          </div>
        )}
        {tab !== 'chat' && <Nav tab={tab} setTab={handleTab} />}
      </div>
    </div>
    </UpdateGate>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <InnerApp />
      {/* One mount for the whole app, including onboarding: showToast() used to
          publish to zero subscribers because nothing rendered this. */}
      <ToastContainer />
      <AdminCodeBanner />
    </AuthProvider>
  )
}

// Mirror of the server's rules (workers/src/routes/auth.js:32-41) so the
// member learns what to fix before waiting on the network. The server stays
// the authority for uniqueness, reserved usernames and the group existing.
const REG_USERNAME_RE = /^[a-z0-9._-]{3,32}$/
const REG_PHONE_RE = /^(?:\+?254|0)?[17]\d{8}$/
const cleanPhone = v => String(v || '').replace(/[^\d+]/g, '')
const REG_FIELD_IDS = {
  username: 'reg-username', name: 'reg-name', phone: 'reg-phone',
  password: 'reg-password', confirm: 'reg-confirm', group_name: 'reg-group',
}

function validateRegister(f) {
  const errors = {}
  const username = String(f.username || '').trim().toLowerCase()
  if (!username) errors.username = 'Choose a username — it is how you sign in.'
  else if (!REG_USERNAME_RE.test(username)) errors.username = 'Use at least 3 letters, numbers, dots, dashes or underscores — no spaces.'
  if (String(f.name || '').trim().length < 2) errors.name = 'Enter your full name as the church knows you.'
  if (!REG_PHONE_RE.test(cleanPhone(f.phone))) errors.phone = 'Enter a Safaricom or Airtel number, e.g. 0712 345 678.'
  if (String(f.password || '').length < 8) errors.password = 'Use at least 8 characters.'
  else if (String(f.password).length > 128) errors.password = 'Keep your password under 128 characters.'
  if (!f.confirm) errors.confirm = 'Re-type your password to confirm it.'
  else if (f.confirm !== f.password) errors.confirm = 'The two passwords do not match.'
  if (!f.group_name) errors.group_name = 'Choose your Harvest Group.'
  return errors
}

function AuthFieldError({ id, children }) {
  return (
    <p id={id} role="alert" className="auth-field-error mt-1.5 flex items-start gap-1.5 text-[12px] font-semibold leading-4 text-danger">
      <Icon name="alert" size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Onboarding({ onAuthSuccess }) {
  // A member who already signed in on this phone is returning, so the first
  // thing they should see is the sign-in form — including after the session
  // expires (the toast tells them to sign in again). A fresh install has no
  // stored username and starts on registration.
  const [mode, setMode] = useState('landing')
  // Public artwork is part of the website content the church owns. It loads
  // before sign-in so the landing page uses the same logo and welcome photo as
  // the signed-in Home screen.
  const [siteArt, setSiteArt] = useState({ logo_url: '', landing_hero_url: '', landing_background_url: '', social_instagram_url: '', social_youtube_url: '', social_tiktok_url: '' })
  useEffect(() => {
    let alive = true
    const loadArtwork = () => {
      fetch(`${API}/api/content?view=public&t=${Date.now()}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(d => {
          if (!alive) return
          setSiteArt({
            logo_url: String(d?.content?.logo_url || ''),
            landing_hero_url: String(d?.content?.landing_hero_url || ''),
            landing_background_url: String(d?.content?.landing_background_url || ''),
            social_instagram_url: String(d?.content?.social_instagram_url || ''),
            social_youtube_url: String(d?.content?.social_youtube_url || ''),
            social_tiktok_url: String(d?.content?.social_tiktok_url || ''),
          })
        })
        .catch(() => { /* shipped artwork stays */ })
    }
    loadArtwork()
    const onUpdated = (e) => {
      const next = e?.detail
      if (!next || typeof next !== 'object') return
      setSiteArt({
        logo_url: String(next.logo_url || ''),
        landing_hero_url: String(next.landing_hero_url || ''),
        landing_background_url: String(next.landing_background_url || ''),
        social_instagram_url: String(next.social_instagram_url || ''),
        social_youtube_url: String(next.social_youtube_url || ''),
        social_tiktok_url: String(next.social_tiktok_url || ''),
      })
    }
    window.addEventListener('harvest:content-updated', onUpdated)
    return () => { alive = false; window.removeEventListener('harvest:content-updated', onUpdated) }
  }, [])
  const brandLogo = siteArt.logo_url || '/logo.png'
  const landingHero = siteArt.landing_hero_url || '/landing/hero.jpg'
  // Social icons on the landing page. The admin saves either a full profile
  // link or a bare @handle; a handle is expanded to the platform's profile URL.
  // With no link saved yet the icon still shows and opens the platform itself,
  // so the row is never empty on the landing page while the admin fills it in.
  const socialLinks = [
    { key: 'instagram', label: 'Instagram', icon: 'instagram', value: siteArt.social_instagram_url, base: 'https://instagram.com/', fallback: 'https://instagram.com/' },
    { key: 'youtube', label: 'YouTube', icon: 'youtube', value: siteArt.social_youtube_url, base: 'https://youtube.com/@', fallback: 'https://youtube.com/' },
    { key: 'tiktok', label: 'TikTok', icon: 'tiktok', value: siteArt.social_tiktok_url, base: 'https://tiktok.com/@', fallback: 'https://tiktok.com/' },
  ].map(({ value, base, fallback, ...rest }) => {
    const raw = String(value || '').trim()
    const href = !raw ? fallback : (/^https?:\/\//i.test(raw) ? raw : base + raw.replace(/^@/, ''))
    return { ...rest, href }
  })
  // The page backdrop is a separate set of photos that rotate on their own; the
  // hero photo never doubles as the page background. Missing files drop out, so
  // the gradient shows when nothing has been added.
  // Anonymous visitors can see the landing, but every feature card and
  // congregation chip must lead somewhere. Instead of dropping them on a form
  // with no context, open a small choice sheet that explains what they get and
  // offers both paths: create an account or sign in.
  const [landingPrompt, setLandingPrompt] = useState(null)
  const { congregations: REG_GROUP_OPTIONS, live: groupsLive, loading: groupsLoading, retry: retryGroups } = useCongregations(true)
  const [form, setForm] = useState({ username: '', name: '', phone: '', password: '', confirm: '', group_name: '' })
  const [loginId, setLoginId] = useState('')
  const [loginPass, setLoginPass] = useState('')
  // Set only after the server accepted the admin password and pushed a code to
  // the bound phone. Until the code verifies, no JWT is issued.
  const [adminChallenge, setAdminChallenge] = useState(null)
  const [adminCode, setAdminCode] = useState('')
  // Break-glass path: when the bound phone cannot receive the code (push not
  // configured, notifications denied, phone lost) the admin can approve this
  // browser with the server-held recovery code instead of being locked out.
  const [adminRecovery, setAdminRecovery] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [showRegPass, setShowRegPass] = useState(false)
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Which kind of auth error is showing: 'network' | 'credentials' | 'server'
  // — drives the banner styling and the recovery hint per kind.
  const [errorKind, setErrorKind] = useState('')
  // Per-field messages, rendered under the field that needs fixing.
  const [fieldErrors, setFieldErrors] = useState({})
  const errorRef = useRef(null)

  // Put the server/network banner where the member is looking instead of
  // letting it sit off-screen below the form after a failed submit.
  const showAuthError = (kind, message) => {
    setErrorKind(kind); setError(message)
    requestAnimationFrame(() => {
      const el = errorRef.current
      if (!el) return
      el.scrollIntoView({ block: 'nearest' })
      el.focus({ preventScroll: true })
    })
  }

  // Any edit invalidates the message about the previous attempt: a stale
  // "password too short" while the member fixes the password reads as if the
  // fix did not take.
  const clearErrors = (field) => {
    if (error) { setError(''); setErrorKind('') }
    if (field) {
      setFieldErrors(fe => {
        if (!fe[field]) return fe
        const next = { ...fe }; delete next[field]; return next
      })
    }
  }

  // Switching between landing, sign-in and sign-up must not carry the other
  // form's rejection across (a signup error under "Welcome back" is nonsense).
  const enter = (next) => {
    setLandingPrompt(null)
    setMode(next)
    setAdminChallenge(null); setAdminCode(''); setAdminRecovery(''); setShowRecovery(false)
    setError(''); setErrorKind(''); setFieldErrors({})
    // The landing is tall and auth is a separate screen; without this, tapping
    // "Join" near the bottom opens the form halfway down the page with the
    // title and back control already scrolled away.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 })
      document.scrollingElement?.scrollTo({ top: 0, left: 0 })
    })
  }

  // Server validation text is for us to classify, not for the member to read.
  // Keep the actionable meaning (taken name, bad phone) in plain language and
  // fall back to one calm sentence for anything we do not recognise.
  const registerMessage = (raw) => {
    const msg = String(raw || '')
    if (/reserved/i.test(msg)) return 'That username is reserved. Choose a different one.'
    if (/username.*(taken|exists|already)|already.*username/i.test(msg)) return 'That username is already taken. Choose another one.'
    if (/phone.*(taken|exists|already)|already.*phone/i.test(msg)) return 'That phone number is already registered. Try signing in instead.'
    if (/phone|number/i.test(msg)) return 'Enter a valid Safaricom or Airtel number, e.g. 0712 345 678.'
    if (/password/i.test(msg)) return 'Use at least 8 characters for your password.'
    if (/group/i.test(msg)) return 'Choose a valid Harvest Group.'
    if (/name/i.test(msg)) return 'Enter your full name as the church knows you.'
    return 'We couldn’t create your account. Check the details and try again.'
  }

  // Fetch failure -> member-useful message: never conflate "wrong password"
  // with "the internet is down". Sign-in stays generic so a wrong password
  // never leaks which half was wrong, and unexpected server text never reaches
  // a normal member.
  const authError = (e, fallback) => {
    if (e instanceof TypeError || /fetch|network|Failed to fetch/i.test(String(e?.message))) {
      return { kind: 'network', message: 'Check your internet and try again. Nothing you typed has been lost.' }
    }
    return { kind: 'credentials', message: fallback }
  }

  const submitRegister = async () => {
    if (busy) return
    // Check locally first: every empty or too-short field would otherwise be
    // a network round trip on mobile data just to learn the same rule.
    const problems = validateRegister(form)
    setFieldErrors(problems)
    if (Object.keys(problems).length) {
      setError(''); setErrorKind('')
      const firstId = REG_FIELD_IDS[Object.keys(problems)[0]]
      requestAnimationFrame(() => {
        const el = firstId ? document.getElementById(firstId) : null
        el?.scrollIntoView?.({ block: 'center' })
        el?.focus?.()
      })
      return
    }
    setBusy(true); setError(''); setErrorKind('')
    try {
      // `confirm` is a local check only — never sent.
      const payload = {
        username: form.username.trim(),
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        group_name: form.group_name,
      }
      const response = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Registration failed')
      onAuthSuccess?.(data)
      showToast(`Karibu! You're in ${data.group_name || form.group_name}.`, 'success', 4000)
    } catch (e) {
      const kind = authError(e, 'We couldn’t create your account. Check the details and try again.')
      if (kind.kind === 'network') { showAuthError(kind.kind, kind.message); return }
      // Classify on the server's wording, but only ever display our own copy.
      const msg = String(e?.message || '')
      const field = /username/i.test(msg) ? 'username'
        : /full name|name/i.test(msg) ? 'name'
          : /number|phone/i.test(msg) ? 'phone'
            : /password/i.test(msg) ? 'password'
              : /group/i.test(msg) ? 'group_name' : ''
      const friendly = registerMessage(msg)
      if (field) {
        setFieldErrors({ [field]: friendly })
        requestAnimationFrame(() => document.getElementById(REG_FIELD_IDS[field])?.focus())
      } else {
        showAuthError('server', friendly)
      }
    } finally { setBusy(false) }
  }

  const submitLogin = async () => {
    if (busy) return
    setBusy(true); setError(''); setErrorKind('')
    try {
      const response = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginId, password: loginPass, ...adminDeviceIdentity() }) })
      const data = await response.json().catch(() => ({}))
      if (data.verification_required) {
        setAdminChallenge(data)
        setAdminCode('')
        setAdminRecovery('')
        // Only promise a code that can actually arrive. `delivery: 'unavailable'`
        // means the server found no push target for the admin phone: the code
        // can only be revealed by the app that is already open there. Start on
        // the recovery field instead of leaving the admin waiting for a code
        // that no channel is going to deliver.
        const noDelivery = data.delivery === 'unavailable' && Boolean(data.recovery_available)
        setShowRecovery(noDelivery)
        setError(''); setErrorKind('')
        requestAnimationFrame(() => document.getElementById(noDelivery ? 'admin-recovery' : 'admin-code')?.focus())
        return
      }
      if (!response.ok || !data.token) {
        throw Object.assign(new Error(data.error || 'Sign in failed'), { status: response.status })
      }
      onAuthSuccess?.(data)
    } catch (e) {
      // Device-policy and delivery errors are actionable and already written
      // for the member; wrong credentials stay deliberately generic.
      if (e.status === 409 || e.status === 503 || e.status === 429) showAuthError('server', e.message)
      else {
        const kind = authError(e, 'Check your username or phone number and password, then try again.')
        showAuthError(kind.kind, kind.message)
      }
    } finally { setBusy(false) }
  }

  const submitAdminCode = async () => {
    if (busy || !adminChallenge) return
    const code = adminCode.replace(/\s+/g, '')
    const recovery = adminRecovery.trim()
    if (!recovery && !/^\d{6}$/.test(code)) {
      setErrorKind('credentials')
      setError(showRecovery ? 'Enter the admin recovery code.' : 'Enter the 6-digit code from the admin phone.')
      return
    }
    setBusy(true); setError(''); setErrorKind('')
    try {
      const response = await fetch(`${API}/api/auth/admin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: adminChallenge.challenge_id,
          device_id: adminDeviceIdentity().device_id,
          ...(recovery ? { recovery_code: recovery } : { code }),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) {
        throw Object.assign(new Error(data.error || 'That code could not be verified.'), { status: response.status })
      }
      setAdminChallenge(null)
      setAdminCode('')
      setAdminRecovery('')
      setShowRecovery(false)
      onAuthSuccess?.(data)
    } catch (e) {
      showAuthError(e.status === 429 || e.status === 503 ? 'server' : 'credentials', e.message || 'That code could not be verified.')
    } finally { setBusy(false) }
  }

  const set = (k) => (e) => {
    const value = e.target.value
    setForm(f => ({ ...f, [k]: value }))
    clearErrors(k)
  }

  // Auth is the doorway into Home, so it uses the same cream surface and the
  // same navy/gold hero as the signed-in feed. The previous pastel card
  // read like a separate product bolted onto the church app.
  const hero = (
    <div className="relative mx-5 mt-3 overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-br from-[#3a2f86] via-[#221a56] to-[#151036] p-5 text-white shadow-card">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full" style={{ background: 'radial-gradient(circle, rgb(245 185 66 / .28) 0%, transparent 68%)' }} />
      <span className="relative inline-flex rounded-full bg-gold px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-[#2b1c0b]">Karibu</span>
      <h1 className="relative mt-3.5 text-[27px] font-extrabold leading-[1.12] tracking-tight">Welcome to<br />Harvest Family<br />Church Nyeri</h1>
      <div className="relative mt-3 h-px bg-white/15" />
      <p className="relative mt-2.5 text-[11px] font-extrabold tracking-[0.22em] text-gold">COMPEL · RAISE · RELEASE</p>
    </div>
  )

  if (mode === 'landing') {
    const congregations = REG_GROUP_OPTIONS.slice(0, 8)
    return (
      <div className="landing-page relative isolate flex justify-center overflow-hidden bg-[#120f19] text-white" style={{ minHeight: 'var(--app-viewport-height, 100dvh)' }}>
        <LandingBackdrop variant="landing" urls={siteArt.landing_background_url} />
        <YouthChurchAnimation />
        <div className="relative z-10 flex w-full max-w-[460px] flex-col" style={{ minHeight: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))', paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))' }}>
          <header className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img src={brandLogo} alt="" className="w-9 h-9 shrink-0 rounded-xl object-contain bg-gold shadow-sm" />
              <div className="min-w-0 leading-tight">
                <p className="text-[15px] font-extrabold truncate">Harvest Family Church</p>
                <p className="text-[10px] font-bold tracking-[0.22em] text-gold">NYERI</p>
              </div>
            </div>
            <button type="button" onClick={() => enter('login')} className="shrink-0 text-[13px] font-bold px-4 min-h-11 rounded-full border border-white/20 bg-white/10 text-white backdrop-blur active:bg-white/20">Sign in</button>
          </header>

          <section className="relative mx-4 mt-2 min-h-[520px] overflow-hidden rounded-[34px] border border-white/10 shadow-2xl">
            <div className="landing-sky" aria-hidden="true" />
            <img
              src={landingHero}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="landing-photo"
            />
            <div className="landing-photo-tint" aria-hidden="true" />
            <div className="landing-aurora" aria-hidden="true" />
            <div className="landing-beams" aria-hidden="true" />
            <div className="landing-arches" aria-hidden="true" />
            <div className="landing-dust" aria-hidden="true" />
            <div className="landing-grain" aria-hidden="true" />
            <div className="landing-glow landing-glow-gold landing-float" aria-hidden="true" />
            <div className="landing-glow landing-glow-navy landing-float landing-float-slow" aria-hidden="true" />
            <div className="relative z-10 flex min-h-[520px] flex-col justify-end p-6">
              <span className="landing-rise inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" /> Karibu · Nyeri
              </span>
              <h1 className="landing-rise landing-rise-2 mt-5 text-[47px] font-black leading-[0.93] tracking-[-0.055em] drop-shadow-[0_2px_18px_rgba(0,0,0,0.38)]">A family<br />to belong to.</h1>
              <p className="landing-rise landing-rise-3 mt-4 max-w-[300px] text-[14px] leading-6 text-white/75">Come as you are. Worship with us, grow in a congregation, and walk through life with people who care.</p>
              <button type="button" onClick={() => enter('register')} className="landing-rise landing-rise-4 landing-cta relative mt-6 flex min-h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-white text-[15px] font-extrabold text-[#221a56] shadow-xl transition active:scale-[0.99]">Join the family <span aria-hidden="true">→</span></button>
              <button type="button" onClick={() => enter('login')} className="landing-rise landing-rise-5 mt-2 min-h-11 text-[13px] font-bold text-white/70 underline-offset-4 active:text-white">I already have an account</button>
            </div>
          </section>

          {/* Visitors on a phone need the app itself, not just a sign-in form:
              this links to the Worker's stable APK URL (always the current
              release, served as an attachment with the versioned filename). */}
          <a
            href={`${API}/harvest-family.apk`}
            className="mx-4 mt-3 flex min-h-[60px] items-center gap-3 rounded-[24px] border border-gold/40 bg-[#1d1629]/90 p-3.5 pl-4 shadow-[0_12px_34px_rgba(0,0,0,0.32)] backdrop-blur transition active:scale-[0.99] active:bg-[#251b34]"
          >
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-[#2b1c0b]"><Icon name="download" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold">Download the app</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-white/55">Install Harvest on Android — free</span>
            </span>
            <span aria-hidden="true" className="pr-1 text-[15px] text-gold">↓</span>
          </a>

          <main className="flex-1 px-5 pb-8 pt-7">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-gold">Compel · Raise · Release</p>
            <h2 className="mt-2 max-w-[330px] text-[27px] font-extrabold leading-[1.08] tracking-[-0.03em]">More than a service.<br />A family.</h2>
            <p className="mt-3 text-[14px] leading-6 text-white/60">Harvest Family Church Nyeri is one church across many congregations — a place to worship, belong, and serve.</p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                { icon: 'heart', title: 'Worship', copy: 'Gather with the family and grow in faith.', prompt: 'Join us for worship, sermons and moments from the life of the church.' },
                { icon: 'users', title: 'Congregations', copy: 'Find the Harvest family nearest to you.', prompt: 'Find your congregation and stay connected with the family nearest to you.' },
                { icon: 'chat', title: 'Community', copy: 'Stay connected through the week.', prompt: 'Stay close to your church family through chats, groups and encouragement all week.' },
                { icon: 'gift', title: 'Give', copy: 'Support the work of the church.', prompt: 'Give securely and support the work God is doing through Harvest Family Church.' },
              ].map(item => (
                <button key={item.title} type="button" onClick={() => setLandingPrompt({ title: item.title, copy: item.prompt })} className="group rounded-3xl border border-white/10 bg-[#191222] p-4 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur transition active:scale-[0.98] active:bg-[#21172e]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-gold"><Icon name={item.icon} size={20} /></div>
                    <span aria-hidden="true" className="text-white/30 transition group-active:translate-x-0.5 group-active:text-white/70">→</span>
                  </div>
                  <p className="mt-3 text-[13px] font-extrabold">{item.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-white/55">{item.copy}</p>
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-[#191222] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/60">Find your congregation</p>
                {!groupsLive && <span className="text-[10px] font-semibold text-white/40">{groupsLoading ? 'Loading…' : 'Offline'}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {congregations.length
                  ? congregations.map(g => (
                    <button key={g} type="button" onClick={() => setLandingPrompt({ title: g, copy: 'Create an account to connect with this congregation and receive updates from your church family.' })} className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[12px] font-semibold text-white/80 transition active:scale-95 active:bg-white/15">{g}</button>
                  ))
                  : <p className="text-[12px] leading-5 text-white/55">{groupsLoading ? 'Loading congregations…' : 'Congregations will appear here when the church office publishes them.'}</p>}
              </div>
              {congregations.length > 0 && <p className="mt-3 text-[11px] leading-5 text-white/40">Tap your congregation to become part of it.</p>}
            </div>

            {socialLinks.length > 0 && (
              <div className="mt-8 text-center">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/40">Follow the church</p>
                <div className="mt-3 flex items-center justify-center gap-3">
                  {socialLinks.map(l => (
                    <a
                      key={l.key}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Harvest Family Church on ${l.label}`}
                      title={l.label}
                      className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-white/80 transition active:scale-95 active:bg-white/15"
                    >
                      <Icon name={l.icon} size={21} />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-6 text-center text-[11px] font-semibold text-white/35">Harvest Family Church Nyeri</p>
          </main>

          {landingPrompt && (
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16 backdrop-blur-sm"
              onClick={() => setLandingPrompt(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="landing-prompt-title"
                tabIndex={-1}
                className="w-full max-w-[420px] rounded-[28px] border border-white/15 bg-[#1d1629] p-6 text-white shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-gold">Karibu · Harvest Nyeri</p>
                    <h2 id="landing-prompt-title" className="mt-2 text-[24px] font-extrabold leading-tight">{landingPrompt.title}</h2>
                  </div>
                  <button type="button" onClick={() => setLandingPrompt(null)} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 active:bg-white/15"><Icon name="close" size={18} /></button>
                </div>
                <p className="mt-3 text-[14px] leading-6 text-white/65">{landingPrompt.copy}</p>
                <p className="mt-4 text-[12px] leading-5 text-white/45">Create an account to take part, or sign in if you are already part of the family.</p>
                <button type="button" onClick={() => enter('register')} className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white text-[14px] font-extrabold text-[#221a56] active:scale-[0.99]">Create my account <span aria-hidden="true">→</span></button>
                <button type="button" onClick={() => enter('login')} className="mt-2 min-h-11 w-full rounded-full text-[13px] font-bold text-white/70 underline-offset-4 active:text-white">I already have an account</button>
                <button type="button" onClick={() => setLandingPrompt(null)} className="mt-1 min-h-10 w-full text-[12px] font-semibold text-white/40 active:text-white/70">Keep looking around</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen relative isolate flex justify-center overflow-hidden bg-[#120f19] text-white" style={{ minHeight: 'var(--app-viewport-height, 100dvh)' }}>
      <LandingBackdrop variant="auth" urls={siteArt.landing_background_url} />
      {/* Safe-area padding keeps the app name + toggle clear of Android status-bar icons */}
      <div className="relative z-10 flex w-full max-w-[460px] flex-col" style={{ minHeight: 'var(--app-viewport-height, 100dvh)', paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))', paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => enter('landing')} aria-label="Back to welcome page" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/70 active:bg-white/10"><Icon name="arrow-left" size={20} /></button>
            <img src={brandLogo} alt="" className="h-9 w-9 shrink-0 rounded-xl bg-gold object-contain shadow-sm" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[14px] font-extrabold text-white">Harvest Family</p>
              <p className="text-[11px] font-bold tracking-wide text-gold">NYERI</p>
            </div>
          </div>
          <button type="button" onClick={() => enter(mode === 'register' ? 'login' : 'register')} aria-label={mode === 'register' ? 'Switch to sign in' : 'Switch to create an account'} className="shrink-0 text-[13px] font-bold px-4 min-h-11 rounded-full border border-white/20 bg-white/10 text-white backdrop-blur active:bg-white/20">
            {mode === 'register' ? 'Sign in' : 'New here?'}
          </button>
        </div>

        {hero}

        {mode === 'register' ? (
          <form id="auth-form" noValidate onSubmit={e => { e.preventDefault(); void submitRegister() }} className="px-5 mt-5 flex-1 space-y-4 overflow-auto">
            <div>
              <h2 className="text-[17px] font-extrabold text-white">Create your account</h2>
              <p className="mt-1 text-[13px] text-white/55">Use your phone number and a password you'll remember.</p>
            </div>
            {error && (
              <div ref={errorRef} tabIndex={-1} className="outline-none">
                <ErrorMessage kind={errorKind} message={error} />
              </div>
            )}
            <div>
              <label htmlFor="reg-username" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Username</label>
              <input id="reg-username" name="username" autoComplete="username" value={form.username} onChange={set('username')} placeholder="e.g. joy_wambui" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} aria-invalid={!!fieldErrors.username} aria-describedby={fieldErrors.username ? 'reg-username-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
              {fieldErrors.username && <AuthFieldError id="reg-username-error">{fieldErrors.username}</AuthFieldError>}
            </div>
            <div>
              <label htmlFor="reg-name" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Full name</label>
              <input id="reg-name" name="name" autoComplete="name" value={form.name} onChange={set('name')} placeholder="e.g. Joy Wambui" maxLength={120} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'reg-name-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
              {fieldErrors.name && <AuthFieldError id="reg-name-error">{fieldErrors.name}</AuthFieldError>}
            </div>
            <div>
              <label htmlFor="reg-phone" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Phone number</label>
              <input id="reg-phone" name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="07xx or 01xx" inputMode="tel" maxLength={16} aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'reg-phone-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
              {fieldErrors.phone && <AuthFieldError id="reg-phone-error">{fieldErrors.phone}</AuthFieldError>}
            </div>
            <div>
              <label htmlFor="reg-password" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Password</label>
              <div className="relative">
                <input id="reg-password" name="password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" type={showRegPass ? 'text' : 'password'} maxLength={128} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'reg-password-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 pr-14 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
                <button type="button" onClick={() => setShowRegPass(v => !v)} aria-label={showRegPass ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-lg text-white/50 active:opacity-60"><span className="text-2xs font-extrabold">{showRegPass ? 'Hide' : 'Show'}</span></button>
              </div>
              {fieldErrors.password && <AuthFieldError id="reg-password-error">{fieldErrors.password}</AuthFieldError>}
              <p className="mt-1.5 text-[12px] text-white/45">{showRegPass ? 'Password is visible — make sure no one is looking.' : 'Tap Show to check what you typed.'}</p>
            </div>
            <div>
              <label htmlFor="reg-confirm" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Confirm password</label>
              <input id="reg-confirm" name="confirm-password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} placeholder="Re-type your password" type={showRegPass ? 'text' : 'password'} maxLength={128} aria-invalid={!!fieldErrors.confirm} aria-describedby={fieldErrors.confirm ? 'reg-confirm-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
              {fieldErrors.confirm
                ? <AuthFieldError id="reg-confirm-error">{fieldErrors.confirm}</AuthFieldError>
                : <p className="mt-1.5 text-[12px] text-white/45">Both boxes must match. Tap Show above to compare them.</p>}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <label htmlFor="reg-group" className="mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-white/55">Choose Harvest Group *</label>
              <div className="relative">
                <select id="reg-group" value={form.group_name} onChange={set('group_name')} aria-invalid={!!fieldErrors.group_name} aria-describedby={fieldErrors.group_name ? 'reg-group-error' : undefined} className="w-full appearance-none rounded-xl border border-white/15 bg-[#1d1629] py-3.5 pl-4 pr-10 text-[15px] font-semibold text-white outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
                  {/* An empty select with no empty option renders the FIRST
 congregation as if chosen, while form state stays '' — the waydroid
 device pass showed 'Alphas 1' checked with the validator still
 refusing. The placeholder keeps the display honest with the state. */}
                  {!form.group_name && <option value="" disabled>Choose your congregation…</option>}
                  {!REG_GROUP_OPTIONS.length && <option value="">{groupsLoading ? 'Loading groups…' : groupsLive ? 'No groups available' : 'Couldn’t load groups'}</option>}
                  {REG_GROUP_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-white/50">▾</span>
              </div>
              {fieldErrors.group_name && <div className="mt-2"><AuthFieldError id="reg-group-error">{fieldErrors.group_name}</AuthFieldError></div>}
              <p className="mt-2 text-[12px] font-medium text-white/45">This exact group is saved on your profile.</p>
              {!groupsLive && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
                  <p className="flex items-center gap-1 text-[12px] text-gold">
                    <Icon name="alert" size={14} className="shrink-0" /> {groupsLoading ? 'Fetching the latest group list…' : 'Couldn’t load the group list.'}
                  </p>
                  {!groupsLoading && (
                    <button type="button" onClick={retryGroups} className="text-[12px] font-bold text-accent-strong underline underline-offset-2 min-h-11 px-1">Retry</button>
                  )}
                </div>
              )}
              {groupsLive && !REG_GROUP_OPTIONS.length && (
                <p className="mt-1.5 text-[12px] text-gold">No Harvest Groups exist yet — ask a church admin to add one.</p>
              )}
            </div>
          </form>
        ) : (
          <form id="auth-form" noValidate onSubmit={e => { e.preventDefault(); void (adminChallenge ? submitAdminCode() : submitLogin()) }} className="px-5 mt-5 flex-1 space-y-4 overflow-auto">
            {adminChallenge ? (
              <>
                <div>
                  <h2 className="text-[17px] font-extrabold text-white">
                    {showRecovery ? 'Approve with the recovery code'
                      : adminChallenge.delivery === 'dev' ? 'Local test code'
                        : adminChallenge.delivery === 'push' ? 'Check the admin phone'
                          : 'Approve on the admin phone'}
                  </h2>
                  <p className="mt-1 text-[13px] text-white/55">
                    {showRecovery
                      ? 'This phone cannot receive a code right now. Enter the recovery code to approve this browser.'
                      : adminChallenge.delivery === 'dev'
                        ? 'Use the local test code shown below — no message is sent in development.'
                        : adminChallenge.delivery === 'push'
                          ? `We sent a 6-digit code to the phone bound to ${loginId || 'HFC Nyeri'}. Enter it to approve this browser.`
                          : `Open the Harvest app on the phone bound to ${loginId || 'HFC Nyeri'} and authorize this browser — the code appears there. If that phone has no request, use the recovery code below.`}
                  </p>
                </div>
                {error && (
                  <div id="auth-error" ref={errorRef} tabIndex={-1} className="outline-none">
                    <ErrorMessage kind={errorKind} message={error} />
                  </div>
                )}
                <div className="rounded-2xl border border-gold/25 bg-gold/[0.07] p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold">Admin sign-in</p>
                  <p className="mt-1.5 text-[12px] leading-5 text-white/60">The admin account trusts two devices. This browser is approved with a code from the admin phone, and adding a third device signs out the one used longest ago.</p>
                </div>
                {adminChallenge.delivery !== 'push' && adminChallenge.delivery !== 'dev' && !showRecovery && (
                  <div className="rounded-2xl border border-line bg-white/[0.05] p-4">
                    <p className="text-[12px] leading-5 text-white/70">
                      A request is waiting on the admin phone. Tap <span className="font-extrabold text-white">Authorize</span> there, then type the 6-digit code it shows here.
                    </p>
                  </div>
                )}
                {showRecovery ? (
                  <div>
                    <label htmlFor="admin-recovery" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Recovery code</label>
                    <input
                      id="admin-recovery"
                      name="recovery-code"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={adminRecovery}
                      onChange={e => { setAdminRecovery(e.target.value.slice(0, 96)); clearErrors() }}
                      placeholder="Recovery code"
                      aria-invalid={errorKind === 'credentials'}
                      aria-describedby={error ? 'auth-error' : 'admin-recovery-help'}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-semibold tracking-wider text-white outline-none placeholder:text-white/25 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20"
                    />
                    <p id="admin-recovery-help" className="mt-1.5 text-[12px] text-white/45">The church's saved recovery code. Wrong codes are limited to 5 tries per sign-in.</p>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="admin-code" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">6-digit code</label>
                    <input
                      id="admin-code"
                      name="one-time-code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={adminCode}
                      onChange={e => { setAdminCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); clearErrors() }}
                      placeholder="000000"
                      aria-invalid={errorKind === 'credentials'}
                      aria-describedby={error ? 'auth-error' : 'admin-code-help'}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-center text-[26px] font-extrabold tracking-[0.42em] text-white outline-none placeholder:text-white/20 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20"
                    />
                    <p id="admin-code-help" className="mt-1.5 text-[12px] text-white/45">The code expires in 10 minutes and can only be used once.</p>
                    {import.meta.env.DEV && adminChallenge.dev_code && (
                      <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-[12px] font-semibold text-gold">Local test code: {adminChallenge.dev_code}</p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setShowRecovery(v => !v); setAdminCode(''); setAdminRecovery(''); clearErrors() }}
                  className="min-h-11 text-[12px] font-bold text-white/55 underline underline-offset-4 active:text-white"
                >
                  {showRecovery ? 'Use the 6-digit phone code instead' : 'Phone not receiving a code? Use a recovery code'}
                </button>
                <button type="button" onClick={() => { setAdminChallenge(null); setAdminCode(''); setAdminRecovery(''); setShowRecovery(false); clearErrors() }} className="min-h-11 text-[12px] font-bold text-white/55 underline underline-offset-4 active:text-white">Back to sign in</button>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-[17px] font-extrabold text-white">Welcome back</h2>
                  <p className="mt-1 text-[13px] text-white/55">Sign in with your username or phone number.</p>
                </div>
                {error && (
                  <div id="auth-error" ref={errorRef} tabIndex={-1} className="outline-none">
                    <ErrorMessage kind={errorKind} message={error} />
                  </div>
                )}
                <div>
                  <label htmlFor="login-id" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Username or phone</label>
                  <input id="login-id" name="username" autoComplete="username" value={loginId} onChange={e => { setLoginId(e.target.value); clearErrors() }} placeholder="e.g. joy_wambui or 07xx" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} aria-invalid={errorKind === 'credentials'} aria-describedby={error ? 'auth-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
                </div>
                <div>
                  <label htmlFor="login-pass" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-white/50">Password</label>
                  <div className="relative">
                    <input id="login-pass" name="password" autoComplete="current-password" value={loginPass} onChange={e => { setLoginPass(e.target.value); clearErrors() }} placeholder="Your password" type={showLoginPass ? 'text' : 'password'} maxLength={128} aria-invalid={errorKind === 'credentials'} aria-describedby={error ? 'auth-error' : undefined} className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5 pr-14 text-[15px] font-medium text-white outline-none placeholder:text-white/35 focus:border-accent focus:bg-white/[0.09] focus:ring-2 focus:ring-accent/20" />
                    <button type="button" onClick={() => setShowLoginPass(v => !v)} aria-label={showLoginPass ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-lg text-white/50 active:opacity-60"><span className="text-2xs font-extrabold">{showLoginPass ? 'Hide' : 'Show'}</span></button>
                  </div>
                  <p className="mt-1.5 text-[12px] text-white/45">Forgot your password? Ask a church admin to reset it for you.</p>
                </div>
              </>
            )}
          </form>
        )}

        <div className="px-5 pt-4 pb-5">
          <button
            type="submit"
            form="auth-form"
            disabled={busy}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-4 text-[16px] font-extrabold shadow-sm ${busy ? 'bg-white/10 text-white/40' : 'bg-accent text-white active:bg-accent-strong'}`}
          >
            {busy ? 'Please wait…' : adminChallenge ? 'Verify and sign in →' : mode === 'register' ? 'Create my account →' : 'Sign in →'}
          </button>
          <p className="mt-3 text-center text-[11px] font-semibold text-white/40">
            {adminChallenge ? 'Only the code sent to the admin phone can approve this browser.' : mode === 'register' ? 'Already a member? Tap “Sign in” at the top right.' : 'New to Harvest? Tap “New here?” at the top right.'}
          </p>
        </div>
      </div>
    </div>
  )
}

// Relative time for the saved-posts shelf — module scope so Profile can use it.
const savedAgo = iso => {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(m) || m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

// Real profile: everything comes from /api/me + the member directory.
// Plain-language meaning of the last push registration attempt. The phone is
// the only place a blocked permission or a missing Firebase token is visible,
// so the wording points at the next thing the member can actually do.
function pushStatusText(status) {
  const detail = status?.detail ? ` (${status.detail})` : ''
  switch (status?.state) {
    case 'registered': return 'On. Admin sign-in codes and announcements can reach this phone.'
    case 'permission-denied': return 'Android is blocking notifications for this app. Open Settings → Apps → Harvest Family Church → Notifications, allow them, then tap Retry.'
    case 'no-token': return `Notifications are allowed, but Android did not issue a push token${detail}. Check that Google Play services is installed and up to date, then tap Retry.`
    case 'plugin-missing': return 'This build has no push service. Install the latest app update, then tap Retry.'
    case 'unreachable': return `This phone could not reach the church server${detail}. Check the connection, then tap Retry.`
    case 'signed-out': return 'Sign in to receive notifications on this phone.'
    case 'error': return `Push setup failed${detail}. Tap Retry.`
    default: return 'Not set up yet. Allow notifications so admin sign-in codes can reach this phone.'
  }
}

function Profile({ users, onOpenAdmin, onSignOut, onEditProfile, onOpenActivity }) {
  const { isAdmin, role, username } = useAuth()
  const [me, setMe] = useState(null)
  const [busy, setBusy] = useState(false)
  // Push registration state, reported by lib/push so a silent failure becomes
  // something the person holding the phone can read and act on.
  const [pushStatus, setPushStatus] = useState(() => getPushStatus())
  const [pushBusy, setPushBusy] = useState(false)
  useEffect(() => {
    const onStatus = e => setPushStatus(e?.detail || getPushStatus())
    window.addEventListener(PUSH_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(PUSH_STATUS_EVENT, onStatus)
  }, [])
  const retryPush = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try { await registerPush() } finally { setPushBusy(false) }
  }
  // Upload activity: live transfers + last 20 finished (successes and failures).
  const [uploads, setUploads] = useState(getUploads())
  const [history, setHistory] = useState(getUploadHistory())
  const [savedReels, setSavedReels] = useState([])
  const [savedReelsLoading, setSavedReelsLoading] = useState(false)
  const [savedReelsError, setSavedReelsError] = useState('')
  const [savedReelSearch, setSavedReelSearch] = useState('')
  const [savedReelDateFilter, setSavedReelDateFilter] = useState('all')
  const [savedPosts, setSavedPosts] = useState([])
  const [savedPostsLoading, setSavedPostsLoading] = useState(false)
  const [savedPostsError, setSavedPostsError] = useState('')
  useEffect(() => subscribeUploads(() => { setUploads(getUploads()); setHistory(getUploadHistory()) }), [])
  useEffect(() => {
    let cancelled = false
    setSavedPostsLoading(true)
    setSavedPostsError('')
    apiGet('/api/posts/saved?limit=50')
      .then(d => { if (!cancelled) setSavedPosts(d.posts || []) })
      .catch(e => { if (!cancelled) setSavedPostsError(e?.message || 'Could not load saved posts') })
      .finally(() => { if (!cancelled) setSavedPostsLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    setSavedReelsLoading(true)
    setSavedReelsError('')
    apiGet('/api/reels/saved?limit=50')
      .then(d => { if (!cancelled) setSavedReels(d.reels || []) })
      .catch(e => { if (!cancelled) setSavedReelsError(e?.message || 'Could not load saved videos') })
      .finally(() => { if (!cancelled) setSavedReelsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const loadMe = () => {
    apiGet('/api/me')
      .then(d => setMe(d.user))
      .catch(() => { /* last known profile stays rendered */ })
  }
  useEffect(loadMe, [])
  // Re-fetch after profile edits (name/photo/group changed in EditProfile).
  useEffect(() => {
    window.addEventListener('harvest:profile-updated', loadMe)
    return () => window.removeEventListener('harvest:profile-updated', loadMe)
  }, [])

  const [memberGroups, setMemberGroups] = useState([])
  const loadMemberGroups = () => {
    apiGet('/api/groups/mine')
      .then(d => setMemberGroups(Array.isArray(d.groups) ? d.groups : []))
      .catch(() => { /* the group rail simply stays as it was */ })
  }
  useEffect(() => {
    loadMemberGroups()
    window.addEventListener('harvest:groups-changed', loadMemberGroups)
    return () => window.removeEventListener('harvest:groups-changed', loadMemberGroups)
  }, [])

  const toggleVerified = async (u) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/api/admin/verify/${encodeURIComponent(u.username)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ verified: !u.verified }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'failed')
      loadMe()
    } catch (e) {
      alert(e?.message || 'Could not update verification')
    } finally { setBusy(false) }
  }

  const displayName = me?.name || username || 'Member'

  return (
    <div className="bg-surface text-ink pb-8">
      <div className="px-4 pt-5 pb-3 border-b border-line flex justify-between items-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-muted font-bold">Harvest Family</p>
          <h1 className="text-2xl font-extrabold">{displayName}</h1>
        </div>
        <span className={`mr-12 text-[10px] px-2 py-0.5 rounded-full font-bold ${role === 'admin' ? 'bg-accent text-white' : 'bg-surface-sunken text-ink-muted'}`}>
          {role === 'admin' ? <span className="inline-flex items-center gap-1"><Icon name="shield" size={11} /> Admin</span> : me?.verified ? <span className="inline-flex items-center gap-1">Verified <VerifiedBadge size={15} /></span> : 'Member'}
        </span>
      </div>

      <div className="px-4 mt-4 flex gap-4 items-center">
        <div className="w-[86px] h-[86px] rounded-full bg-gradient-to-tr from-gold to-accent p-[3px]">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt="" className="w-full h-full rounded-full object-cover border-[3px] border-surface" />
          ) : (
            <div className="w-full h-full rounded-full bg-surface-sunken text-ink flex items-center justify-center font-bold border-[3px] border-surface text-xl">
              {displayName.split(/[\s_.]/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()}
            </div>
          )}
        </div>
        <div className="text-sm space-y-1">
          <p className="font-semibold">@{me?.username || username}</p>
          {/* The member's own words, not an admin's queue state: "pending
              verification by admin" told every new member they were waiting on
              someone else and gave them nothing to read. The verified state
              already shows as the chip beside the name. */}
          {me?.faith ? (
            <p className="line-clamp-2 max-w-[230px] text-xs italic leading-snug text-ink-muted">“{me.faith}”</p>
          ) : (
            <p className="max-w-[230px] text-xs text-ink-muted">
              {me?.verified ? <span className="inline-flex items-center gap-1"><VerifiedBadge size={16} /> Verified member</span> : 'Add your faith testimony in Edit profile'}
            </p>
          )}
          <button onClick={() => onEditProfile?.()} className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-4 py-1.5 text-xs font-bold text-ink active:opacity-70"><Icon name="pencil" size={13} /> Edit profile</button>
        </div>
      </div>

      <div className="px-4 mt-3">
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-1 text-xs"><Icon name="map" size={12} /> {me?.location || 'Nyeri'}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-1 text-xs font-semibold text-gold-strong"><Icon name="users" size={12} /> {me?.group_name || 'Harvest Nyeri'}</span>
          {me?.phone && <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-1 text-xs"><Icon name="phone" size={12} /> {me.phone}</span>}
        </div>
      </div>

      {isPushSupported() && (
        <div className="mt-4 border-t border-line px-4 pt-3" data-testid="push-status">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-accent">Notifications on this phone</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${pushStatus?.state === 'registered' ? 'bg-accent/15 text-accent-strong' : 'bg-surface-sunken text-ink-muted'}`}>
              {pushStatus?.state === 'registered' ? 'On' : 'Off'}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">{pushStatusText(pushStatus)}</p>
          {pushStatus?.state === 'registered' ? (
            getPushTokenHint() && <p className="mt-1 text-[11px] text-ink-muted">Device key ends {getPushTokenHint()}</p>
          ) : (
            <button type="button" onClick={() => void retryPush()} disabled={pushBusy} className="mt-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-60">
              {pushBusy ? 'Connecting…' : 'Turn on notifications'}
            </button>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-line px-4 pt-3">
          {/* The only entry to the Admin Centre used to be a button labelled
              “moderation queue” (plus a Giving-admin link deeper in Give), so an
              administrator looking for members, sermons or the website had no
              obvious way in. Name the destination for what it is. */}
          <button onClick={() => onOpenAdmin?.()} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-accent text-xs font-extrabold text-white shadow-card"><Icon name="shield" size={14} /> Admin Centre</button>
          <p className="mt-2 text-center text-[11px] leading-4 text-ink-muted">Members, ministries, giving, sermons, website content and approvals</p>
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 px-4 text-sm font-bold text-accent">Verified accounts</h3>
          <div className="space-y-2 px-4">
            {users.filter(u => u.verified).map(u => (
              <div key={u.username} className="flex items-center justify-between p-2 rounded-xl bg-white border border-line">
                <div className="flex gap-2 items-center">
                  <div className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center text-xs">{String(u.username)[0].toUpperCase()}</div>
                  <p className="text-xs font-semibold">{u.name || u.username}</p>
                </div>
                <button disabled={busy} onClick={() => void toggleVerified(u)} className="px-3 py-1 rounded-full text-[10px] font-bold bg-white text-black">{u.verified ? 'Unverify' : 'Verify'}</button>
              </div>
            ))}
            {users.filter(u => u.verified).length === 0 && <p className="text-xs text-ink-muted">No verified accounts yet.</p>}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="px-4 mb-2">
          <h3 className="text-sm font-bold text-ink">My Groups</h3>
          <p className="text-[11px] text-ink-muted">Live membership from the Groups service</p>
        </div>
        <div className="space-y-2 px-4">
          {memberGroups.map(g => (
            <div key={g.slug} className="w-full flex justify-between items-center p-3 rounded-xl bg-white border border-line">
              <div className="min-w-0"><p className="text-sm font-semibold text-ink truncate">{g.name}</p><p className="text-xs text-ink-muted">{g.my_role === 'admin' ? 'Group admin' : 'Member'}</p></div>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-sunken text-ink"><Icon name="users" size={14} /></span>
            </div>
          ))}
          {memberGroups.length === 0 && <p className="text-xs text-ink-muted px-4">You are not in any groups.</p>}
        </div>
      </div>

      {/* Uploads: live transfers + recent history */}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-sm font-bold px-4 text-ink mb-2">My uploads</h3>
        {uploads.length > 0 && (
          <div className="space-y-2 px-4 mb-3">
            {uploads.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-line">
                <div className="w-9 h-9 shrink-0 rounded-full border-2 border-line flex items-center justify-center text-[10px] font-bold text-ink" style={{ background: `conic-gradient(#a78bfa ${u.pct}%, #F4E8D0 0)` }}>{u.pct >= 100 ? <Icon name="check" size={12} /> : `${u.pct}`}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{u.label}</p>
                  <p className="text-[10px] text-ink-muted">{u.status === 'waiting' ? `Waiting for network — retry ${u.attempt}/5` : `Uploading… ${u.pct}%`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length === 0 && uploads.length === 0 && (
          <p className="text-xs text-ink-muted px-4">No uploads yet — share a story, post or video and it shows here.</p>
        )}
        {history.length > 0 && (
          <div className="space-y-2 px-4">
            {history.slice(0, 8).map(h => (
              <div key={h.id + h.at} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-line">
                <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm ${h.status === 'done' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>{h.status === 'done' ? <Icon name="check" size={13} /> : <Icon name="close" size={13} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{h.label}</p>
                  {h.status === 'done'
                    ? <p className="text-[10px] text-ink-muted truncate">Published</p>
                    : <div className="mt-1"><ErrorMessage message={h.detail || 'Upload failed — try sharing again.'} /></div>}
                </div>
                <span className="text-[10px] text-ink-muted shrink-0">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            <button onClick={() => clearUploadHistory()} className="text-[10px] text-ink-muted underline px-1">Clear history</button>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="px-4 flex items-center justify-between mb-2">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink"><Icon name="bookmark" size={15} /> Saved Posts</h3>
          <span className="text-[10px] text-ink-muted">Saved on every device</span>
        </div>
        {savedPostsLoading && <p className="text-xs text-ink-muted px-4 py-2">Loading saved posts…</p>}
        {savedPostsError && <p className="text-xs text-rose-400 px-4 py-2">{savedPostsError}</p>}
        {!savedPostsLoading && !savedPostsError && savedPosts.length === 0 && (
          <div className="mx-4 p-4 rounded-2xl bg-white border border-line">
            <p className="text-xs font-semibold">No saved posts yet.</p>
            <p className="text-[11px] text-ink-muted mt-1">Tap Save on a post to keep it here for later.</p>
          </div>
        )}
        {savedPosts.length > 0 && (
          <div className="px-4 grid grid-cols-2 gap-3">
            {savedPosts.map(sp => (
              <div key={sp.id} className="rounded-2xl overflow-hidden bg-white border border-line">
                {sp.thumb_url ? (
                  <img src={sp.thumb_url} alt={sp.caption || 'Saved post'} loading="lazy" className="w-full aspect-[4/3] object-cover" />
                ) : (
                  <div className="w-full aspect-[4/3] bg-surface-sunken flex items-center justify-center p-3 text-center">
                    <span className="text-[11px] font-semibold text-ink-muted line-clamp-4">{sp.caption || 'Post'}</span>
                  </div>
                )}
                <div className="p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                    <span className="inline-flex min-w-0 items-center gap-1 truncate font-bold text-ink">@{sp.username}{sp.verified ? <Icon name="check" size={11} className="text-accent" /> : ''}</span>
                    <span className="truncate">{savedAgo(sp.saved_at)}</span>
                  </div>
                  <p className="text-[11px] text-ink-muted line-clamp-2 mt-0.5">{sp.caption}</p>
                  <button type="button"
                    onClick={async () => {
                      // Optimistic, but never silent: if the server refuses, put
                      // the card back so Saved is not lying about what the
                      // member still has.
                      setSavedPosts(list => list.filter(x => x.id !== sp.id))
                      try {
                        const r = await fetch(`${API}/api/posts/${encodeURIComponent(sp.id)}/save`, { method: 'DELETE', headers: authHeaders() })
                        if (!r.ok) throw new Error(`Could not remove this saved post (${r.status})`)
                      } catch (e) {
                        setSavedPosts(list => list.some(x => x.id === sp.id) ? list : [sp, ...list])
                        showToast(describeError(e, 'Could not remove this saved post'), 'error')
                      }
                    }}
                    className="mt-1.5 text-[10px] font-extrabold text-gold-strong" aria-label={`Remove ${sp.caption ? 'saved post' : 'post'} from Saved`}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="px-4 flex items-center justify-between mb-2">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink"><Icon name="bookmark" size={15} /> Saved Videos</h3>
          <span className="text-[10px] text-ink-muted">Saved on every device</span>
        </div>
        {savedReelsLoading && <p className="text-xs text-ink-muted px-4 py-2">Loading saved videos…</p>}
        {savedReelsError && <p className="text-xs text-rose-400 px-4 py-2">{savedReelsError}</p>}
        {!savedReelsLoading && !savedReelsError && savedReels.length === 0 && (
          <div className="mx-4 p-4 rounded-2xl bg-white border border-line">
            <p className="text-xs font-semibold">Nothing saved yet.</p>
            <p className="mt-1 text-2xs text-ink-muted">Tap Save on a Reel to keep it here for later.</p>
          </div>
        )}
        {savedReels.length > 0 && (() => {
          const q = savedReelSearch.trim().toLowerCase()
          const now = Date.now()
          const filtered = savedReels.filter(r => {
            const haystack = `${r.username || ''} ${r.name || ''} ${r.caption || ''}`.toLowerCase()
            if (q && !haystack.includes(q)) return false
            if (savedReelDateFilter !== 'all') {
              const savedAt = Date.parse(r.saved_at || '')
              if (!Number.isFinite(savedAt)) return false
              const age = now - savedAt
              const limit = savedReelDateFilter === 'today' ? 24 * 60 * 60 * 1000
                : savedReelDateFilter === '7d' ? 7 * 24 * 60 * 60 * 1000
                : 30 * 24 * 60 * 60 * 1000
              if (age < 0 || age > limit) return false
            }
            return true
          })
          return (
            <>
              <div className="px-4 space-y-2 mb-3">
                <label className="relative block">
                  <span className="sr-only">Search saved videos</span>
                  <input
                    value={savedReelSearch}
                    onChange={e => setSavedReelSearch(e.target.value)}
                    placeholder="Search creator or caption"
                    className="w-full min-h-11 rounded-xl bg-white border border-line px-3 pl-9 text-xs text-ink placeholder:text-ink-subtle outline-none focus:border-line-strong"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm" aria-hidden>⌕</span>
                </label>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {[
                    ['all', 'All'],
                    ['today', 'Today'],
                    ['7d', '7 days'],
                    ['30d', '30 days'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSavedReelDateFilter(value)}
                      className={`min-h-9 shrink-0 rounded-full px-3 text-[11px] font-semibold border ${savedReelDateFilter === value ? 'bg-ink text-white border-ink' : 'bg-white text-ink-muted border-line'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {filtered.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 px-4">
                  {filtered.map(r => (
                    <button key={r.id} type="button"
                      onClick={() => { window.location.href = `/?shared=reel&id=${encodeURIComponent(String(r.id))}` }}
                      className="relative aspect-[9/13] overflow-hidden rounded-2xl bg-white border border-line text-left active:scale-[0.98] transition-transform">
                      {r.poster_url ? <img src={r.poster_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" /> : <div className="absolute inset-0 grid place-items-center"><Icon name="reels" size={26} className="text-ink-subtle" /></div>}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/85 to-transparent">
                        <p className="text-[11px] font-bold truncate">{r.username}</p>
                        <p className="text-[10px] text-white/70 line-clamp-2">{r.caption || 'Saved video'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mx-4 p-4 rounded-2xl bg-white border border-line">
                  <p className="text-xs font-semibold">No saved videos match.</p>
                  <p className="text-[11px] text-ink-muted mt-1">Try a different creator, caption, or saved-date filter.</p>
                </div>
              )}
            </>
          )
        })()}
      </div>

      <div className="px-4 mt-5">
        {/* Give took the bottom bar slot Activity used to hold; Activity stays
            one tap away here so nothing members relied on disappears. */}
        <button onClick={() => onOpenActivity?.()} className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-line bg-surface py-2.5 text-xs font-semibold text-accent-strong active:opacity-70"><Icon name="clock" size={14} /> Your activity</button>
        <button onClick={() => onSignOut?.()} className="w-full py-2.5 rounded-full border border-line text-ink-muted text-xs font-semibold">Sign out</button>
      </div>
    </div>
  )
}

// Five destinations is the most a 320 px phone can show without the first and
// last labels sitting flush against the screen edge (the reported defect).
// The remaining destinations stay one tap away in More instead of being cut or
// squeezed into 40 px columns.
const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'reels', label: 'Reels', icon: 'reels' },
  { id: 'post', label: 'Create', icon: 'plus' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'profile', label: 'Profile', icon: 'user' },
]
const MORE_ITEMS = [
  { id: 'search', label: 'Search', icon: 'search', hint: 'Find members and conversations' },
  { id: 'give', label: 'Give', icon: 'gift', hint: 'Instructions, projects and your history' },
  { id: 'map', label: 'Map', icon: 'map', hint: 'Church location and directions' },
]

// Phones: fixed bottom bar with edge breathing room. Desktop: hidden — the
// sidebar in the shell takes over.
function Nav({ tab, setTab }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef(null)
  useModalFocus(moreOpen, moreRef, () => setMoreOpen(false))
  useAndroidBack(moreOpen, () => setMoreOpen(false))
  useEffect(() => { setMoreOpen(false) }, [tab])
  const secondaryActive = MORE_ITEMS.some(item => item.id === tab)
  return (
    <>
      <nav
        aria-label="Primary"
        className="app-fixed-nav fixed bottom-0 left-1/2 z-40 flex w-full max-w-[560px] -translate-x-1/2 items-stretch gap-0.5 border-t border-line bg-surface/95 px-2 backdrop-blur lg:hidden xl:max-w-[620px]"
        style={{ paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))', boxShadow: '0 -6px 24px rgb(var(--accent) / 0.08)' }}
      >
        {NAV_ITEMS.map(item => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-2xs font-semibold transition-colors ${active ? 'text-accent' : 'text-ink-subtle'}`}
            >
              <Icon name={item.icon} size={22} strokeWidth={active ? 2.1 : 1.7} />
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(v => !v)}
          aria-label="More destinations"
          aria-expanded={moreOpen}
          aria-controls="more-destinations"
          className={`relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-2xs font-semibold transition-colors ${secondaryActive || moreOpen ? 'text-accent' : 'text-ink-subtle'}`}
        >
          <Icon name="dots" size={22} strokeWidth={secondaryActive ? 2.1 : 1.7} />
          <span className="max-w-full truncate">More</span>
          {secondaryActive && <span aria-hidden="true" className="absolute right-2 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
      </nav>
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close more destinations"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 z-40 cursor-default bg-ink/20 backdrop-blur-[1px] lg:hidden"
          />
          <div
            id="more-destinations"
            ref={moreRef}
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            tabIndex={-1}
            className="drawer-anim absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+68px)] z-50 overflow-hidden rounded-3xl border border-line bg-surface-raised p-2 shadow-2xl lg:hidden"
          >
            {MORE_ITEMS.map(item => {
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setTab(item.id); setMoreOpen(false) }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? 'bg-accent-soft text-accent-strong' : 'text-ink hover:bg-surface-sunken'}`}
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? 'bg-accent text-white' : 'bg-surface-sunken text-accent'}`}><Icon name={item.icon} size={19} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">{item.label}</span>
                    <span className="mt-0.5 block text-2xs text-ink-muted">{item.hint}</span>
                  </span>
                  <Icon name="chevron-right" size={16} className="shrink-0 text-ink-subtle" />
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// Desktop-only navigation rail. Static (not fixed) so it never covers content,
// and it retires the phone layout as the only way to move around the app.
// It carries navigation only: the logo and wordmark live in the Home header,
// and showing them in both places put the same brand twice on a wide screen.
function Sidebar({ tab, setTab }) {
  return (
    <aside className="hidden shrink-0 border-r border-line bg-surface-raised lg:flex lg:w-[248px] lg:flex-col" aria-label="Primary">
      <nav className="flex flex-col gap-1 px-3 pt-5">
        {[...NAV_ITEMS, ...MORE_ITEMS].map(item => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${active ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'}`}
            >
              <Icon name={item.icon} size={20} strokeWidth={active ? 2.1 : 1.7} />
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>
      <p className="mt-auto px-5 py-5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-subtle">Compel · Raise · Release</p>
    </aside>
  )
}
