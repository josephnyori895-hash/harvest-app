import { useState, useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { AuthProvider, useAuth } from './state/auth'
import { useCongregations } from './lib/useCongregations'
import Home from './components/Home'
import Reels from './components/Reels'
import Search from './components/Search'
import Chat from './components/Chat'
import ViewUser from './components/ViewUser'
import EditProfile from './components/EditProfile'
import HarvestMap from './components/HarvestMap'
import Music from './components/Music'
import Sermons from './components/Sermons'
import Give from './components/Give'
import PostCreate from './components/PostCreate'
import Groups from './components/Groups'
import Departments from './components/Departments'
import { RequireRole } from './components/Protected'
import UserListModal from './components/UserListModal'
import Admin from './components/Admin'
import { showToast } from './components/Toast'
import UploadPill from './components/UploadPill'
import ErrorMessage from './components/ErrorMessage'
import { installSessionGuard, SESSION_EXPIRED_EVENT } from './lib/session'

// Global fetch guard: any 401 from the API (expired 24h/7d JWT) raises ONE
// session-expired event so the app can return to login with a clear message,
// instead of Departments/Groups/Activity/comments failing silently.
installSessionGuard()

// FIX L icon 404 — ensure default marker loads via CDN
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

import { initNotifications } from './lib/notifications'
import { getUploadHistory, getUploads, subscribeUploads, clearUploadHistory } from './lib/backgroundUploads'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders() {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Real member directory from the server (replaces the old mock user list).
// Auto-refreshes when verification/admin actions fire 'harvest:verified'.
function useDirectory(enabled) {
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
    const refreshOnVisible = () => { if (document.visibilityState === 'visible') load() }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 30000)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshOnVisible)
      window.removeEventListener('harvest:verified', load)
      window.removeEventListener('harvest:profile-updated', load)
    }
  }, [enabled])
  return [users, setUsers, loading, error, load]
}
function IgIcon({ name, active }) {
  // Warm palette: brand purple when active, soft warm gray when not.
  const c = active ? '#7C3AED' : '#A49A8E'
  const s = active ? 2.2 : 1.6
  if (name === 'home') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M3 10L12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4z" /></svg>
  if (name === 'search') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={s}><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
  if (name === 'reels') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M10 8l6 4-6 4z" fill={active ? '#FFFBF0' : 'none'} stroke="none" /></svg>
  if (name === 'post') return <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${active ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'border-[#A49A8E]'}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? '#FFFBF0' : '#A49A8E'} strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></div>
  if (name === 'activity') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M12 21s-6-4-6-10a6 6 0 0 1 12 0c0 6-6 10-6 10z" /></svg>
  if (name === 'music') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  if (name === 'give') return <span style={{fontSize: active? '20px':'18px', lineHeight:'24px', filter: active?'none':'grayscale(0.4) opacity(0.75)'}} role="img" aria-label="give">🤲</span>
  if (name === 'map') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" /><path d="M8 2v16M16 6v16" /></svg>
  if (name === 'chat') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-4.2A7.5 7.5 0 1 1 20 11.5z" /><path d="M8 11h8M8 14h5" strokeLinecap="round" /></svg>
  if (name === 'departments') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={s}><path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" /><path d="M3 12l9 4.5 9-4.5" /><path d="M3 16.5L12 21l9-4.5" /></svg>
  if (name === 'profile') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={s}><path d="M20 21v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  return null
}

// In-app update prompt for the Android build: on open, compare the
// installed versionCode against the latest release (Worker /api/app-version).
// Shows a dismissible card above the app when an update is available;
// 'Later' hides it for 24h for that version. Web builds never see it.
function UpdateGate({ children }) {
  const [update, setUpdate] = useState(null)
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    let live = true
    import('./lib/appUpdate').then(({ checkForUpdate, isDismissed }) =>
      checkForUpdate().then(info => {
        if (!live) return
        if (info.available && !isDismissed(info.versionCode)) {
          setUpdate(info)
          setHidden(false)
        }
      })
    ).catch(() => {})
    return () => { live = false }
  }, [])
  return (
    <>
      {update && !hidden && (
        <div role="alert" className="fixed top-[calc(var(--safe-area-inset-top, env(safe-area-inset-top))+8px)] left-3 right-3 z-[60] p-3.5 rounded-2xl bg-[#1C1917] text-white shadow-2xl border border-[#7C3AED]/40 flex items-center gap-3">
          <span className="text-2xl shrink-0" aria-hidden="true">🚀</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">Update available{update.versionName ? ` · v${update.versionName}` : ''}</p>
            <p className="text-[11px] text-stone-300 mt-0.5">This build of the church app is out of date. Tap update to get the latest version.</p>
          </div>
          <button
            onClick={() => { import('./lib/appUpdate').then(({ openApkDownload }) => openApkDownload(update.apkUrl)) }}
            className="shrink-0 px-4 py-2.5 rounded-full bg-[#7C3AED] text-white text-xs font-extrabold active:bg-[#6D28D9]"
          >Update</button>
          <button
            onClick={() => { import('./lib/appUpdate').then(({ dismissUpdate }) => { dismissUpdate(update.versionCode); setHidden(true) }) }}
            className="shrink-0 w-9 h-9 rounded-full bg-white/10 text-stone-300 text-sm" aria-label="Remind me later"
          >✕</button>
        </div>
      )}
      {children}
    </>
  )
}

function InnerApp() {
  const { setUsername, setRole, setVerified, role, verified, isAdmin } = useAuth()
  const [onboarded, setOnboarded] = useState(() => !!localStorage.getItem('harvest_token'))
  const [tab, setTab] = useState('home')
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
  const [homeRefresh, setHomeRefresh] = useState(0)
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

  const handleTab = (t) => {
    if (t === 'home' && tab === 'home') setHomeRefresh(x=>x+1)
    if (t === 'chat' && tab !== 'chat') {
      setChatReturnTab(tab)
      setTeamChat(null)
    }
    setTab(t)
  }
  const [viewUser, setViewUser] = useState(null)
  const [backTarget, setBackTarget] = useState('search')
  // Open someone's profile from wherever we are (feed, reels, stories) and
  // remember the origin tab so Back returns there — not always Search.
  const openProfile = (u) => { setBackTarget(tab); setViewUser(u); setTab('viewuser') }
  const [editProfileKey, setEditProfileKey] = useState(0)
  const [teamChat, setTeamChat] = useState(null)
  const [dmTarget, setDmTarget] = useState(null)
  const [chatReturnTab, setChatReturnTab] = useState('home')
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
  // 'Pray with Pastor': open a 1:1 DM with the pastor's account from Home.
  const openDm = (username, name) => {
    setChatReturnTab(tab)
    setTeamChat(null)
    setDmTarget({ username, name })
    setTab('chat')
  }

  const [users, , directoryLoading, directoryError, refreshDirectory] = useDirectory(onboarded)

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
  }

  const signOut = () => {
    localStorage.removeItem('harvest_token')
    localStorage.removeItem('harvest_username')
    localStorage.removeItem('harvest_role')
    localStorage.removeItem('harvest_verified')
    localStorage.removeItem('harvest_msgs')
    localStorage.removeItem('harvest_pinned_chats')
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
    fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('session invalid')))
      .then(d => {
        const u = d?.user
        if (!u) return
        setUsername(u.username || '')
        setRole(u.role === 'admin' ? 'admin' : 'member')
        setVerified(Boolean(u.verified))
      })
      .catch(() => {})
  }, [])

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
        if (viewUser) { setViewUser(null); return setTab(backTarget) }
        if (tab === 'editprofile') return setTab('profile')
        if ((tab === 'groups' || tab === 'departments') && chatReturnTab === 'chat') return setTab('chat')
        if (tab !== 'home') return setTab('home')
        // departments has no back stack of its own — treat like other tabs
        CapApp.exitApp()
      }).then(s => { sub = s })
    }).catch(() => { /* web build: no hardware back */ })
    return () => { disposed = true; try { sub?.remove?.() } catch {} }
  }, [onboarded, tab, userList, viewUser, backTarget, chatReturnTab])

  if (!onboarded) return <Onboarding onAuthSuccess={handleAuthSuccess} />

  return (
    <UpdateGate>
    <div className="app-shell bg-[#FFFBF0] flex justify-center">
      {/* Fluid width: fills the phone screen (no more 390px demo column) */}
      <div className="app-shell w-full h-[100dvh] max-h-[100dvh] bg-[#FFFBF0] flex flex-col" style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}>
        <div className={`app-content app-scroll flex-1 ${tab === 'chat' ? 'overflow-hidden' : 'app-scroll-bottom-safe'}`}>
          {tab === 'home' && <Home setTab={handleTab} users={users} directoryLoading={directoryLoading} directoryError={directoryError} onRefreshDirectory={refreshDirectory} refreshKey={homeRefresh} onOpenUser={openProfile} sharedContent={sharedContent} onSharedContentHandled={clearSharedContent} onOpenDm={openDm} />}
          {tab === 'search' && <Search users={users} onView={u => { setBackTarget('search'); setViewUser(u); setTab('viewuser') }} onOpenUser={openProfile} onOpenGroups={() => { setBackTarget('search'); setTab('groups') }} onOpenDepartments={() => { setBackTarget('search'); setTab('departments') }} onOpenSermons={openSermonFromSearch} onOpenReel={openReelFromSearch} />}
          {tab === 'reels' && <Reels onOpenUser={openProfile} sharedReelId={sharedContent?.kind === 'reel' ? sharedContent.id : searchReelId} onSharedReelHandled={() => { if (sharedContent) clearSharedContent(); else setSearchReelId(null) }} />}
          {tab === 'post' && <PostCreate onDone={() => setTab('home')} />}
          {tab === 'activity' && <Activity />}
          {tab === 'profile' && <Profile users={users} onOpenAdmin={()=>setTab('admin')} onSignOut={signOut} onEditProfile={() => setTab('editprofile')} />}
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
            />
          )}
          {tab === 'viewuser' && <ViewUser user={viewUser} onBack={() => setTab(backTarget)} onEditProfile={viewUser?.me || viewUser?.username === localStorage.getItem('harvest_username') ? () => setTab('editprofile') : undefined} />}
          {tab === 'music' && <Music />}
          {tab === 'sermons' && <Sermons isAdmin={isAdmin} verified={verified} focusId={searchSermonId} onFocused={() => setSearchSermonId(null)} />}
          {tab === 'give' && <Give />}
          {tab === 'map' && <HarvestMap users={users} />}
          {tab === 'groups' && <Groups onOpenChat={(slug, name) => openTeamChat('group', slug, name)} />}
          {tab === 'departments' && <Departments onOpenDeptChat={(slug, name) => openTeamChat('department', slug, name)} />}
          {tab === 'admin' && (
            <RequireRole role="admin">
              <Admin
                onBack={() => setTab('profile')}
                users={users}
                setUsers={()=>{}}
                onOpenGroups={() => setTab('groups')}
                onOpenDepartments={() => setTab('departments')}
                onOpenSermons={() => setTab('sermons')}
              />
            </RequireRole>
          )}
        </div>
        {userList && <UserListModal type={userList.type} userId={userList.userId} users={users} onBack={()=>setUserList(null)} />}
        <UploadPill />
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
    </AuthProvider>
  )
}

function Onboarding({ onAuthSuccess }) {
  const [mode, setMode] = useState('register') // 'register' | 'login'
  const { congregations: REG_GROUP_OPTIONS, live: groupsLive } = useCongregations()
  const [form, setForm] = useState({ username: '', name: '', phone: '', password: '', group_name: 'Harvest Central' })
  const [loginId, setLoginId] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [showRegPass, setShowRegPass] = useState(false)
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Which kind of auth error is showing: 'network' | 'credentials' | 'server'
  // — drives the banner styling and the recovery hint per kind.
  const [errorKind, setErrorKind] = useState('')

  // Ask the device for GPS (best effort — permission may be denied).
  const getPosition = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    )
  })

  // GPS is an optional helper: only collected when the member taps
  // "Use my location". A hand-picked group is always honoured by the server.
  const [useMyLocation, setUseMyLocation] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('') // '' | 'locating' | 'ok' | 'denied'

  const captureLocation = () => {
    setGpsStatus('locating')
    getPosition().then(pos => {
      if (pos) { setGpsStatus('ok'); setUseMyLocation(true) }
      else { setGpsStatus('denied'); setUseMyLocation(false) }
    })
  }

  // Map a fetch failure to a member-useful message: network problems are the
  // common case on mobile data, and "wrong password" must never be conflated
  // with "the internet is down" (members otherwise retry forever).
  const authError = (e, fallback) => {
    if (e instanceof TypeError || /fetch|network|Failed to fetch/i.test(String(e?.message))) {
      return { kind: 'network', message: "No connection — check your internet, then try again. Your details haven't been shared with anyone." }
    }
    const msg = String(e?.message || '')
    if (/401|403/.test(msg) || /password|pin|credentials|incorrect|invalid/i.test(msg)) {
      return { kind: 'credentials', message: fallback }
    }
    return { kind: 'server', message: msg || fallback }
  }

  const submitRegister = async () => {
    if (busy) return
    setBusy(true); setError(''); setErrorKind('')
    try {
      // Only include GPS when the member opted in AND the pick is the
      // auto/nearest option — never let a guess override a real choice.
      let pos = null
      if (useMyLocation && !form.group_name) pos = await getPosition()
      const payload = { ...form, ...(pos || {}) }
      const response = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Registration failed')
      onAuthSuccess?.(data)
      if (data.assigned_by === 'location' && data.group_name) {
        showToast(`Karibu! You've been placed in your nearest group: ${data.group_name}`, 'success', 4000)
      }
    } catch (e) {
      const kind = authError(e, 'We couldn’t create your account. Check the details and try again.')
      setErrorKind(kind.kind)
      setError(kind.message)
    } finally { setBusy(false) }
  }

  const submitLogin = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginId, password: loginPass }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Sign in failed')
      onAuthSuccess?.(data)
    } catch (e) {
      const kind = authError(e, 'We couldn’t sign you in. Check your username or phone number and password, then try again.')
      setErrorKind(kind.kind)
      setError(kind.message)
    } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="min-h-[100dvh] bg-white flex justify-center">
      {/* Safe-area padding keeps the app name + toggle clear of Android status-bar icons */}
      <div className="w-full max-w-[460px] bg-white min-h-[100dvh] flex flex-col" style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))', paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))' }}>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/logo.png" alt="" className="w-9 h-9 shrink-0 rounded-xl object-contain bg-[#FFCD00] shadow-sm" />
            <div className="min-w-0 leading-tight">
              <p className="text-[15px] font-extrabold text-zinc-900 truncate">Harvest Family Church</p>
              <p className="text-[11px] font-bold tracking-wide text-[#7C3AED]">NYERI</p>
            </div>
          </div>
          <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')} className="shrink-0 text-[13px] font-bold px-4 py-2.5 rounded-full border border-zinc-300 bg-zinc-50 text-[#5B21B6] active:bg-zinc-100">
            {mode === 'register' ? 'Sign in' : 'New here?'}
          </button>
        </div>

        <div className="rounded-[22px] mx-5 mt-3 p-5 bg-gradient-to-br from-[#EDE9FE] via-[#F5F0FF] to-[#FFFBEB] border border-[#EDE9FE] shadow-sm">
          <span className="inline-flex text-[11px] font-extrabold tracking-wide bg-[#F59E0B] text-white px-3 py-1.5 rounded-full">Karibu</span>
          <h1 className="mt-3.5 text-[30px] font-extrabold leading-[1.12] tracking-tight text-[#4C1D95]">Welcome to<br />Harvest Family<br />Church Nyeri</h1>
          <div className="mt-3 h-px bg-[#DDD6FE]" />
          <p className="mt-2.5 text-[12px] font-extrabold tracking-[0.22em] text-[#7C3AED]">COMPEL · RAISE · RELEASE</p>
        </div>

        {mode === 'register' ? (
          <div className="px-5 mt-5 flex-1 space-y-4 overflow-auto">
            <div>
              <h2 className="text-[17px] font-extrabold text-zinc-900">Create your account</h2>
              <p className="text-[13px] text-zinc-600 mt-1">Use your phone number and a password you'll remember.</p>
            </div>
            <div>
              <label htmlFor="reg-username" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Username</label>
              <input id="reg-username" value={form.username} onChange={set('username')} placeholder="e.g. joy_wambui" autoCapitalize="none" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
            </div>
            <div>
              <label htmlFor="reg-name" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Full name</label>
              <input id="reg-name" value={form.name} onChange={set('name')} placeholder="e.g. Joy Wambui" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
            </div>
            <div>
              <label htmlFor="reg-phone" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Phone number</label>
              <input id="reg-phone" value={form.phone} onChange={set('phone')} placeholder="07xx or 01xx" inputMode="tel" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
            </div>
            <div>
              <label htmlFor="reg-password" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Password</label>
              <div className="relative">
                <input id="reg-password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" type={showRegPass ? 'text' : 'password'} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 pr-14 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
                <button type="button" onClick={() => setShowRegPass(v => !v)} aria-label={showRegPass ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-lg text-zinc-500 active:opacity-60">{showRegPass ? '🙈' : '👁'}</button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1.5">{showRegPass ? 'Password is visible — make sure no one is looking.' : 'Tap 👁 to check what you typed.'}</p>
            </div>
            <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200">
              <label htmlFor="reg-group" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-2">Choose Harvest Group *</label>
              <div className="relative">
                <select id="reg-group" value={form.group_name} onChange={set('group_name')} className="w-full appearance-none bg-white border border-zinc-300 rounded-xl pl-4 pr-10 py-3.5 text-[15px] font-semibold text-zinc-900 outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100">
                  {REG_GROUP_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 text-base">▾</span>
              </div>
              <p className="text-[11px] font-medium text-zinc-600 mt-2.5">This exact group is saved on your profile — GPS is never used to change it.</p>
              {!groupsLive && (
                <p className="text-[11px] text-amber-700 mt-1.5 flex items-center gap-1">
                  <span aria-hidden="true">⚠</span> Couldn't reach the latest group list — showing the default congregations.
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={captureLocation} disabled={gpsStatus === 'locating'} className="px-3 py-2 rounded-full bg-white border border-zinc-300 text-[11px] font-bold text-zinc-700 disabled:opacity-50">
                  {gpsStatus === 'locating' ? '📍 Locating…' : gpsStatus === 'ok' ? '📍 Location saved' : '📍 Use my location (optional)'}
                </button>
                {gpsStatus === 'denied' && <span className="text-[10px] text-zinc-500">Location off — pick your group above instead</span>}
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5">We use your location once, only to suggest the group nearest to you. It's never required.</p>
            </div>
            {error && <ErrorMessage kind={errorKind} message={error} />}
          </div>
        ) : (
          <div className="px-5 mt-5 flex-1 space-y-4 overflow-auto">
            <div>
              <h2 className="text-[17px] font-extrabold text-zinc-900">Welcome back</h2>
              <p className="text-[13px] text-zinc-600 mt-1">Sign in with your username or phone number.</p>
            </div>
            <div>
              <label htmlFor="login-id" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Username or phone</label>
              <input id="login-id" value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="e.g. joy_wambui or 07xx" autoCapitalize="none" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
            </div>
            <div>
              <label htmlFor="login-pass" className="block text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 mb-1.5">Password or PIN</label>
              <div className="relative">
                <input id="login-pass" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && void submitLogin()} placeholder="Your password" type={showLoginPass ? 'text' : 'password'} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 pr-14 text-[15px] font-medium text-zinc-900 outline-none placeholder:text-zinc-600 focus:bg-white focus:border-[#7C3AED] focus:ring-2 focus:ring-purple-100" />
                <button type="button" onClick={() => setShowLoginPass(v => !v)} aria-label={showLoginPass ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-lg text-zinc-500 active:opacity-60">{showLoginPass ? '🙈' : '👁'}</button>
              </div>
            </div>
            {error && (
              <ErrorMessage
                kind={errorKind}
                title={errorKind === 'credentials' ? 'We couldn’t sign you in' : undefined}
                message={error}
              />
            )}
          </div>
        )}

        <div className="px-5 pt-4 pb-5">
          <button
            onClick={() => void (mode === 'register' ? submitRegister() : submitLogin())}
            disabled={busy}
            className={`w-full py-4 rounded-full font-extrabold text-[16px] flex items-center justify-center gap-2 shadow-sm ${busy ? 'bg-zinc-200 text-zinc-400' : 'bg-[#7C3AED] text-white active:bg-[#6D28D9]'}`}
          >
            {busy ? 'Please wait…' : mode === 'register' ? 'Create my account →' : 'Sign in →'}
          </button>
          <p className="text-center text-[11px] font-semibold text-zinc-500 mt-3">
            {mode === 'register' ? 'Already a member? Tap “Sign in” at the top right.' : 'New to Harvest? Tap “New here?” at the top right.'}
          </p>
        </div>
      </div>
    </div>
  )
}

// Real activity from the server: new members + follows involving you.
function Activity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(0)
  useEffect(() => {
    const tick = () => setClock(Date.now())
    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let cancelled = false
    fetch(`${API}/api/activity`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load activity'))))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  const Avatar = ({ name }) => (
    <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px] shrink-0">
      <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-xs font-bold text-white">
        {String(name || '?').split(/[\s_.]/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()}
      </div>
    </div>
  )
  const Row = ({ children, keyi }) => (
    <div key={keyi} className="flex gap-3 items-center bg-zinc-900 border border-zinc-800 rounded-2xl p-3">{children}</div>
  )
  const timeAgo = iso => {
    if (!iso || !clock) return ''
    const m = Math.floor((clock - new Date(iso).getTime()) / 60000)
    if (m < 1) return 'now'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60); if (h < 24) return `${h}h`
    const d = Math.floor(h / 24); if (d < 7) return `${d}d`
    return new Date(iso).toLocaleDateString()
  }

  return (
    <div className="bg-black text-white min-h-[70vh]">
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Harvest Family</p>
        <h1 className="text-2xl font-extrabold">Activity</h1>
      </div>
      <div className="p-4 space-y-6">
        {error && <div role="alert" className="p-3 rounded-xl bg-rose-950 border border-rose-900 text-sm text-rose-300">{error}</div>}
        {!data && !error && <p className="text-zinc-500 text-sm">Loading…</p>}
        {data && (
          <>
            <section>
              <h2 className="text-sm font-bold text-amber-400 mb-2">New members</h2>
              <div className="space-y-2">
                {(data.new_members || []).length === 0 && <p className="text-xs text-zinc-500">No new members yet.</p>}
                {(data.new_members || []).map((u, i) => (
                  <Row keyi={`nm_${u.username}_${i}`}>
                    <Avatar name={u.name || u.username} />
                    <p className="text-[13px] flex-1"><b>{u.name || u.username}</b> joined {u.group_name || 'the family'}</p>
                    <span className="text-[11px] text-zinc-500">{timeAgo(u.created_at)}</span>
                  </Row>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-sm font-bold text-blue-400 mb-2">Following you</h2>
              <div className="space-y-2">
                {(data.follows_in || []).length === 0 && <p className="text-xs text-zinc-500">No followers yet — connect with others on the Map.</p>}
                {(data.follows_in || []).map((u, i) => (
                  <Row keyi={`fi_${u.username}_${i}`}>
                    <Avatar name={u.name || u.username} />
                    <p className="text-[13px] flex-1"><b>{u.name || u.username}</b> started following you</p>
                    <span className="text-[11px] text-zinc-500">{timeAgo(u.created_at)}</span>
                  </Row>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-sm font-bold text-zinc-400 mb-2">You follow</h2>
              <div className="space-y-2">
                {(data.follows_out || []).length === 0 && <p className="text-xs text-zinc-500">Tap a member on the Map to follow them.</p>}
                {(data.follows_out || []).map((u, i) => (
                  <Row keyi={`fo_${u.username}_${i}`}>
                    <Avatar name={u.name || u.username} />
                    <p className="text-[13px] flex-1">You follow <b>{u.name || u.username}</b></p>
                    <span className="text-[11px] text-zinc-500">{timeAgo(u.created_at)}</span>
                  </Row>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// Real profile: everything comes from /api/me + the member directory.
function Profile({ users, onOpenAdmin, onSignOut, onEditProfile }) {
  const { isAdmin, role, username } = useAuth()
  const [me, setMe] = useState(null)
  const [busy, setBusy] = useState(false)
  // Upload activity: live transfers + last 20 finished (successes and failures).
  const [uploads, setUploads] = useState(getUploads())
  const [history, setHistory] = useState(getUploadHistory())
  const [savedReels, setSavedReels] = useState([])
  const [savedReelsLoading, setSavedReelsLoading] = useState(false)
  const [savedReelsError, setSavedReelsError] = useState('')
  const [savedReelSearch, setSavedReelSearch] = useState('')
  const [savedReelDateFilter, setSavedReelDateFilter] = useState('all')
  useEffect(() => subscribeUploads(() => { setUploads(getUploads()); setHistory(getUploadHistory()) }), [])
  useEffect(() => {
    let cancelled = false
    setSavedReelsLoading(true)
    setSavedReelsError('')
    fetch(`${API}/api/reels/saved?limit=50`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d?.error || 'Could not load saved videos'))))
      .then(d => { if (!cancelled) setSavedReels(d.reels || []) })
      .catch(e => { if (!cancelled) setSavedReelsError(e?.message || 'Could not load saved videos') })
      .finally(() => { if (!cancelled) setSavedReelsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const loadMe = () => {
    fetch(`${API}/api/me`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then(d => setMe(d.user))
      .catch(() => {})
  }
  useEffect(loadMe, [])
  // Re-fetch after profile edits (name/photo/group changed in EditProfile).
  useEffect(() => {
    window.addEventListener('harvest:profile-updated', loadMe)
    return () => window.removeEventListener('harvest:profile-updated', loadMe)
  }, [])

  const [memberGroups, setMemberGroups] = useState([])
  const loadMemberGroups = () => {
    fetch(`${API}/api/groups/mine`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('groups unavailable')))
      .then(d => setMemberGroups(Array.isArray(d.groups) ? d.groups : []))
      .catch(() => {})
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
    <div className="bg-black text-white pb-8">
      <div className="px-4 pt-5 pb-3 border-b border-zinc-800 flex justify-between items-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Harvest Family</p>
          <h1 className="text-2xl font-extrabold">{displayName}</h1>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${role === 'admin' ? 'bg-[#7C3AED] text-white' : 'bg-zinc-700 text-zinc-300'}`}>
          {role === 'admin' ? '★ Admin' : me?.verified ? '✓ Verified' : 'Member'}
        </span>
      </div>

      <div className="px-4 mt-4 flex gap-4 items-center">
        <div className="w-[86px] h-[86px] rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[3px]">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt="" className="w-full h-full rounded-full object-cover border-[3px] border-black" />
          ) : (
            <div className="w-full h-full rounded-full bg-black flex items-center justify-center font-bold border-[3px] border-black text-xl">
              {displayName.split(/[\s_.]/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()}
            </div>
          )}
        </div>
        <div className="text-sm space-y-1">
          <p className="font-semibold">@{me?.username || username}</p>
          <p className="text-zinc-400 text-xs">{me?.verified ? '✓ Verified member' : 'Account pending verification by admin'}</p>
          <button onClick={() => onEditProfile?.()} className="mt-1 px-4 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs font-bold text-white active:opacity-70">✏️ Edit profile</button>
        </div>
      </div>

      <div className="px-4 mt-3">
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-xs bg-zinc-800 px-2 py-1 rounded-full">📍 {me?.location || 'Nyeri'}</span>
          <span className="text-xs bg-gradient-to-r from-yellow-500 to-purple-600 text-black px-2 py-1 rounded-full font-semibold">👥 {me?.group_name || 'Harvest Nyeri'}</span>
          {me?.phone && <span className="text-xs bg-zinc-800 px-2 py-1 rounded-full">📱 {me.phone}</span>}
        </div>
      </div>

      {isAdmin && (
        <div className="mt-4 border-t border-zinc-800 pt-3 px-4">
          <button onClick={() => onOpenAdmin?.()} className="w-full py-2.5 rounded-full bg-[#7C3AED] text-white text-xs font-bold">🛡 Open moderation queue</button>
          <p className="text-[11px] text-zinc-500 text-center mt-2">Review posts, stories and reels submitted by members</p>
        </div>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="text-sm font-bold px-4 text-blue-400 mb-2">✓ Verified Accounts</h3>
          <div className="space-y-2 px-4">
            {users.filter(u => u.verified).map(u => (
              <div key={u.username} className="flex items-center justify-between p-2 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="flex gap-2 items-center">
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs">{String(u.username)[0].toUpperCase()}</div>
                  <p className="text-xs font-semibold">{u.name || u.username}</p>
                </div>
                <button disabled={busy} onClick={() => void toggleVerified(u)} className="px-3 py-1 rounded-full text-[10px] font-bold bg-white text-black">{u.verified ? 'Unverify' : 'Verify'}</button>
              </div>
            ))}
            {users.filter(u => u.verified).length === 0 && <p className="text-xs text-zinc-500">No verified accounts yet.</p>}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="px-4 mb-2">
          <h3 className="text-sm font-bold text-white">My Groups</h3>
          <p className="text-[11px] text-zinc-500">Live membership from the Groups service</p>
        </div>
        <div className="space-y-2 px-4">
          {memberGroups.map(g => (
            <div key={g.slug} className="w-full flex justify-between items-center p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="min-w-0"><p className="text-sm font-semibold text-white truncate">{g.name}</p><p className="text-xs text-zinc-400">{g.my_role === 'admin' ? 'Group admin' : 'Member'}</p></div>
              <span className="text-xs bg-white text-black px-3 py-1 rounded-full">👥</span>
            </div>
          ))}
          {memberGroups.length === 0 && <p className="text-xs text-zinc-500 px-4">You are not in any groups.</p>}
        </div>
      </div>

      {/* Uploads: live transfers + recent history */}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <h3 className="text-sm font-bold px-4 text-white mb-2">My uploads</h3>
        {uploads.length > 0 && (
          <div className="space-y-2 px-4 mb-3">
            {uploads.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="w-9 h-9 shrink-0 rounded-full border-2 border-zinc-700 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: `conic-gradient(#a78bfa ${u.pct}%, #27272a 0)` }}>{u.pct >= 100 ? '✓' : `${u.pct}`}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{u.label}</p>
                  <p className="text-[10px] text-zinc-400">{u.status === 'waiting' ? `Waiting for network — retry ${u.attempt}/5` : `Uploading… ${u.pct}%`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length === 0 && uploads.length === 0 && (
          <p className="text-xs text-zinc-500 px-4">No uploads yet — share a story, post or video and it shows here.</p>
        )}
        {history.length > 0 && (
          <div className="space-y-2 px-4">
            {history.slice(0, 8).map(h => (
              <div key={h.id + h.at} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm ${h.status === 'done' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>{h.status === 'done' ? '✓' : '✕'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{h.label}</p>
                  {h.status === 'done'
                    ? <p className="text-[10px] text-zinc-400 truncate">Published</p>
                    : <div className="mt-1"><ErrorMessage message={h.detail || 'Upload failed — try sharing again.'} /></div>}
                </div>
                <span className="text-[10px] text-zinc-500 shrink-0">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            <button onClick={() => clearUploadHistory()} className="text-[10px] text-zinc-500 underline px-1">Clear history</button>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="px-4 flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-white">🔖 Saved Videos</h3>
          <span className="text-[10px] text-zinc-500">Saved on every device</span>
        </div>
        {savedReelsLoading && <p className="text-xs text-zinc-500 px-4 py-2">Loading saved videos…</p>}
        {savedReelsError && <p className="text-xs text-rose-400 px-4 py-2">{savedReelsError}</p>}
        {!savedReelsLoading && !savedReelsError && savedReels.length === 0 && (
          <div className="mx-4 p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
            <p className="text-xs font-semibold">Nothing saved yet.</p>
            <p className="text-[11px] text-zinc-500 mt-1">Tap 🔖 on a Reel to keep it here for later.</p>
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
                    className="w-full min-h-11 rounded-xl bg-zinc-900 border border-zinc-800 px-3 pl-9 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-zinc-600"
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm" aria-hidden>⌕</span>
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
                      className={`min-h-9 shrink-0 rounded-full px-3 text-[11px] font-semibold border ${savedReelDateFilter === value ? 'bg-white text-zinc-900 border-white' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}
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
                      className="relative aspect-[9/13] overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 text-left active:scale-[0.98] transition-transform">
                      {r.poster_url ? <img src={r.poster_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" /> : <div className="absolute inset-0 flex items-center justify-center text-3xl">🎥</div>}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/85 to-transparent">
                        <p className="text-[11px] font-bold truncate">{r.username}</p>
                        <p className="text-[10px] text-white/70 line-clamp-2">{r.caption || 'Saved video'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mx-4 p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
                  <p className="text-xs font-semibold">No saved videos match.</p>
                  <p className="text-[11px] text-zinc-500 mt-1">Try a different creator, caption, or saved-date filter.</p>
                </div>
              )}
            </>
          )
        })()}
      </div>

      <div className="px-4 mt-5">
        <button onClick={() => onSignOut?.()} className="w-full py-2.5 rounded-full border border-zinc-700 text-zinc-300 text-xs font-semibold">Sign out</button>
      </div>
    </div>
  )
}

function Nav({ tab, setTab }) {
  const items = [
    ['home', 'home'],
    ['search', 'search'],
    ['reels', 'reels'],
    ['post', 'post'],
    ['activity', 'activity'],
    ['chat', 'chat'],
    ['profile', 'profile'],
  ]
  return (
    // Fixed to the viewport so it can never be scrolled away or mis-tapped.
    // Warm church bar: deep warm-brown with a soft purple glow above the active tab.
    <div className="app-fixed-nav fixed bottom-0 left-0 right-0 z-40 flex justify-around items-center border-t border-[#E8DEC9] bg-[#FFFBF0]/97 backdrop-blur" style={{ paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))', boxShadow: '0 -6px 24px rgba(124, 58, 237, 0.08)' }}>
      {items.map(([id]) => (
        <button key={id} type="button" aria-label={`Open ${id}`} onClick={() => setTab(id)} className="active:opacity-60">
          <IgIcon name={id} active={tab === id} />
        </button>
      ))}
    </div>
  )
}
