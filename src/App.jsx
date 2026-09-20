import { useState, useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { AuthProvider, useAuth } from './state/auth'
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
import GroupDetails from './components/GroupDetails'
import UserListModal from './components/UserListModal'
import Admin from './components/Admin'
import { showToast } from './components/Toast'
import UploadPill from './components/UploadPill'
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
  const load = () => {
    fetch(`${API}/api/users/map`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('directory unavailable'))))
      .then(d => {
        if (!Array.isArray(d.users)) return
        const me = localStorage.getItem('harvest_username') || ''
        setUsers(d.users.map(u => ({ ...u, group: u.group_name, me: u.username === me })))
      })
      .catch(() => {})
  }
  useEffect(() => {
    if (!enabled) return
    load()
    window.addEventListener('harvest:verified', load)
    window.addEventListener('harvest:profile-updated', load)
    return () => { window.removeEventListener('harvest:verified', load); window.removeEventListener('harvest:profile-updated', load) }
  }, [enabled])
  return [users, setUsers]
}

function IgIcon({ name, active }) {
  const s = active ? 2.2 : 1.6
  if (name === 'home') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M3 10L12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4z" /></svg>
  if (name === 'search') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={s}><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
  if (name === 'reels') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M10 8l6 4-6 4z" fill={active ? 'black' : 'none'} stroke="none" /></svg>
  if (name === 'post') return <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${active ? 'bg-white text-black border-white' : 'border-white'}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? 'black' : 'white'} strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></div>
  if (name === 'activity') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M12 21s-6-4-6-10a6 6 0 0 1 12 0c0 6-6 10-6 10z" /></svg>
  if (name === 'music') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  if (name === 'give') return <span style={{fontSize: active? '20px':'18px', lineHeight:'24px', filter: active?'none':'opacity(0.9)'}} role="img" aria-label="give">🤲</span>
  if (name === 'map') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" /><path d="M8 2v16M16 6v16" /></svg>
  if (name === 'chat') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-4.2A7.5 7.5 0 1 1 20 11.5z" /><path d="M8 11h8M8 14h5" strokeLinecap="round" /></svg>
  if (name === 'departments') return <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'white' : 'none'} stroke="white" strokeWidth={s}><path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" /><path d="M3 12l9 4.5 9-4.5" /><path d="M3 16.5L12 21l9-4.5" /></svg>
  if (name === 'profile') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={s}><path d="M20 21v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  return null
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

  const [users] = useDirectory(onboarded)

  const [groupDetail, setGroupDetail] = useState(null)
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
        if (groupDetail) return setGroupDetail(null)
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
  }, [onboarded, tab, groupDetail, userList, viewUser, backTarget, chatReturnTab])

  if (!onboarded) return <Onboarding onAuthSuccess={handleAuthSuccess} />

  return (
    <div className="min-h-screen bg-black flex justify-center">
      {/* Fluid width: fills the phone screen (no more 390px demo column) */}
      <div className="w-full bg-black min-h-screen flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex-1 overflow-auto pb-[calc(64px+env(safe-area-inset-bottom))]">
          {tab === 'home' && <Home setTab={handleTab} users={users} refreshKey={homeRefresh} onOpenUser={openProfile} sharedContent={sharedContent} onSharedContentHandled={clearSharedContent} />}
          {tab === 'search' && <Search users={users} onView={u => { setBackTarget('search'); setViewUser(u); setTab('viewuser') }} onOpenUser={openProfile} />}
          {tab === 'reels' && <Reels onOpenUser={openProfile} sharedReelId={sharedContent?.kind === 'reel' ? sharedContent.id : undefined} onSharedReelHandled={clearSharedContent} />}
          {tab === 'post' && <PostCreate onDone={() => setTab('home')} />}
          {tab === 'activity' && <Activity />}
          {tab === 'profile' && <Profile users={users} onOpenAdmin={()=>setTab('admin')} onSignOut={signOut} onEditProfile={() => setTab('editprofile')} />}
          {tab === 'editprofile' && <EditProfile key={editProfileKey} onDone={() => { setEditProfileKey(k => k + 1); setTab('profile') }} />}
          {tab === 'chat' && (
            <Chat
              onBack={closeTeamChat}
              users={users}
              teamChat={teamChat}
              onCloseTeam={closeTeamChat}
              onOpenGroups={() => { setChatReturnTab('chat'); setTeamChat(null); setTab('groups') }}
              onOpenDepartments={() => { setChatReturnTab('chat'); setTeamChat(null); setTab('departments') }}
            />
          )}
          {tab === 'viewuser' && <ViewUser user={viewUser} onBack={() => setTab(backTarget)} onEditProfile={viewUser?.me || viewUser?.username === localStorage.getItem('harvest_username') ? () => setTab('editprofile') : undefined} />}
          {tab === 'music' && <Music />}
          {tab === 'sermons' && <Sermons isAdmin={isAdmin} verified={verified} />}
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
        {groupDetail && <GroupDetails groupId={groupDetail} users={users} onBack={()=>setGroupDetail(null)} />}
        {userList && <UserListModal type={userList.type} userId={userList.userId} users={users} onBack={()=>setUserList(null)} />}
        <UploadPill />
        <Nav tab={tab} setTab={handleTab} />
      </div>
    </div>
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
  const [form, setForm] = useState({ username: '', name: '', phone: '', password: '', group_name: 'Harvest Central' })
  const [loginId, setLoginId] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [showRegPass, setShowRegPass] = useState(false)
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Ask the device for GPS (best effort — permission may be denied).
  const getPosition = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    )
  })

  const submitRegister = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const pos = await getPosition()
      const payload = { ...form, ...(pos || {}) }
      const response = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Registration failed')
      onAuthSuccess?.(data)
      if (data.assigned_by === 'location' && data.group_name) {
        showToast(`Karibu! You've been placed in your nearest group: ${data.group_name}`, 'success', 4000)
      }
    } catch (e) { setError(e?.message || 'Registration failed') } finally { setBusy(false) }
  }

  const submitLogin = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginId, password: loginPass }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Sign in failed')
      onAuthSuccess?.(data)
    } catch (e) { setError(e?.message || 'Sign in failed') } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="min-h-[100dvh] bg-white flex justify-center">
      {/* Safe-area padding keeps the app name + toggle clear of Android status-bar icons */}
      <div className="w-full max-w-[460px] bg-white min-h-[100dvh] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
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
                  {['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'].map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 text-base">▾</span>
              </div>
              <p className="text-[11px] font-medium text-zinc-600 mt-2.5">You'll be grouped with members near you.</p>
            </div>
            {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-700">{error}</div>}
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
            {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-medium text-rose-700">{error}</div>}
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
    if (!iso) return ''
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
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
  useEffect(() => subscribeUploads(() => { setUploads(getUploads()); setHistory(getUploadHistory()) }), [])

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

  const groups = {}
  users.forEach(u => { const g = u.group_name || u.group || 'Harvest Nyeri'; if (!groups[g]) groups[g] = []; groups[g].push(u) })

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
        <h3 className="text-sm font-bold px-4 text-white mb-2">Harvest Groups by Location</h3>
        <div className="space-y-2 px-4">
          {Object.entries(groups).map(([g, members]) => (
            <div key={g} className="w-full flex justify-between items-center p-3 rounded-xl bg-zinc-900 border border-zinc-800">
              <div><p className="text-sm font-semibold text-white">{g}</p><p className="text-xs text-zinc-400">{members.length} members</p></div>
              <span className="text-xs bg-white text-black px-3 py-1 rounded-full">{members.length} 👥</span>
            </div>
          ))}
          {Object.keys(groups).length === 0 && <p className="text-xs text-zinc-500 px-4">Loading groups…</p>}
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
                  <p className="text-[10px] text-zinc-400 truncate">{h.status === 'done' ? 'Published' : `Failed — ${h.detail || 'tap Share to try again'}`}</p>
                </div>
                <span className="text-[10px] text-zinc-500 shrink-0">{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            <button onClick={() => clearUploadHistory()} className="text-[10px] text-zinc-500 underline px-1">Clear history</button>
          </div>
        )}
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
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-around items-center min-h-[56px] border-t border-zinc-800 bg-black/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map(([id]) => (
        <button key={id} type="button" onClick={() => setTab(id)} className="p-3 active:opacity-60">
          <IgIcon name={id} active={tab === id} />
        </button>
      ))}
    </div>
  )
}
