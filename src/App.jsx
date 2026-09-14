import { useState, useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { AuthProvider, useAuth, getFollowsMap, toggleFollowMutual, isMutual } from './state/auth'
import Home from './components/Home'
import Reels from './components/Reels'
import Search from './components/Search'
import Chat from './components/Chat'
import ViewUser from './components/ViewUser'
import HarvestMap, { groupCoords } from './components/HarvestMap'
import Music from './components/Music'
import Give from './components/Give'
import PostCreate from './components/PostCreate'
import AccountSwitcher from './components/AccountSwitcher'
import { StoryCreate } from './components/Stories'
import Groups from './components/Groups'
import { RequireRole } from './components/Protected'
import GroupDetails from './components/GroupDetails'
import UserListModal from './components/UserListModal'
import Admin from './components/Admin'

// FIX L icon 404 — ensure default marker loads via CDN
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const mockUsers = [
  { username: 'allan', name: 'Allan', role: 'admin', verified: true, followers: 1200, location: 'Nyeri Town', group: 'Harvest Central', lat: -0.4197, lng: 36.9475, me: true, assignedGroupIds: ['Harvest Central'] },
  { username: 'youth_harvest', name: 'Youth Harvest', role: 'leader', verified: true, followers: 2014, location: 'Skuta', group: 'Harvest Skuta', lat: -0.41, lng: 36.94, assignedGroupIds: ['Harvest Skuta'] },
  { username: 'worship_team', name: 'Worship Team', role: 'leader', verified: true, followers: 430, location: 'Kamakwa', group: 'Harvest Kamakwa', lat: -0.415, lng: 36.955, assignedGroupIds: ['Harvest Kamakwa'] },
  { username: 'pst.simon', name: 'Pst Simon', role: 'member', verified: false, followers: 890, location: 'Ruringu', group: 'Harvest Ruringu', lat: -0.432, lng: 36.95, assignedGroupIds: ['Harvest Ruringu'] },
]

const mockMusics = [
  { id: 1, title: 'Compelled Anthem', artist: 'Harvest Worship', type: 'worship', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 2, title: 'Raise Me Up', artist: 'Grace & Team', type: 'praise', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 3, title: 'Released', artist: 'Youth Harvest', type: 'choir', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
]

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
  if (name === 'profile') return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={s}><path d="M20 21v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  return null
}

function InnerApp() {
  const { setUsername, setRole, setVerified, role } = useAuth()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  // Onboarding is now the auth gate: register or sign in. A valid token means onboarded.
  const [onboarded, setOnboarded] = useState(() => {
    if (!localStorage.getItem('harvest_token')) return false
    const u = localStorage.getItem('harvest_username') || ''
    const parts = u.split('_')
    if (parts[0]) setFirst(parts[0][0].toUpperCase() + parts[0].slice(1))
    if (parts[1]) setLast(parts[1][0].toUpperCase() + parts[1].slice(1))
    return true
  })
  const [tab, setTab] = useState('home')
  const [homeRefresh, setHomeRefresh] = useState(0)
  const handleTab = (t) => {
    if (t === 'home' && tab === 'home') setHomeRefresh(x=>x+1)
    setTab(t)
  }
  const [viewUser, setViewUser] = useState(null)

  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('harvest_users')
    if(saved){ try{ const parsed=JSON.parse(saved); if(parsed.length>=4) return parsed; }catch{} }
    return [...mockUsers]
  })

  const [musics, setMusics] = useState(() => {
    const s = localStorage.getItem('harvest_musics')
    return s ? JSON.parse(s) : [...mockMusics]
  })
  const addMusic = (m) => {
    // Idempotent: skip if the same title+artist is already saved (Music.tsx also guards this)
    const dup = musics.some(x => String(x.title||'').toLowerCase() === String(m.title||'').toLowerCase() && String(x.artist||'').toLowerCase() === String(m.artist||'').toLowerCase())
    if (dup) return
    const updated = [{ id: Date.now(), ...m }, ...musics]
    setMusics(updated)
    localStorage.setItem('harvest_musics', JSON.stringify(updated))
  }

  const [pending, setPending] = useState(() => {
    const s = localStorage.getItem('harvest_pending')
    return s ? JSON.parse(s) : []
  })
  const [approvedPosts, setApprovedPosts] = useState(() => {
    const s = localStorage.getItem('harvest_approved_posts')
    return s ? JSON.parse(s) : []
  })
  const [approvedStories, setApprovedStories] = useState(() => {
    const s = localStorage.getItem('harvest_approved_stories')
    return s ? JSON.parse(s) : []
  })
  const [approvedReels, setApprovedReels] = useState(() => {
    const s = localStorage.getItem('harvest_approved_reels')
    return s ? JSON.parse(s) : []
  })
  const [groupDetail, setGroupDetail] = useState(null)
  const [userList, setUserList] = useState(null)
  // Camera/microphone access is requested only from an explicit call or capture
  // action (CallScreen, file pickers) — never during application startup.
  // migration harvest_nyeri → allan (keep app name)
  useEffect(() => {
    try {
      const OLD='harvest_nyeri', NEW='allan'
      let migrated=false
      const raw=localStorage.getItem('harvest_users')
      if(raw){
        let arr=JSON.parse(raw)
        let changed=false
        arr=arr.map((u)=>{ if(u.username===OLD){ changed=true; return {...u, username:NEW, name: u.name==='Harvest Family Church'?'Allan':u.name, verified:true}} return u})
        if(changed){ localStorage.setItem('harvest_users', JSON.stringify(arr)); setUsers(arr); migrated=true }
      }
      if(localStorage.getItem('harvest_username')===OLD){ localStorage.setItem('harvest_username', NEW); migrated=true }
      ;['harvest_pending','harvest_approved_posts','harvest_approved_stories','harvest_approved_reels'].forEach(k=>{
        try{ const v=localStorage.getItem(k); if(v){ let a=JSON.parse(v); let c=false; a=a.map((x)=>{ if(x.user===OLD||x.name===OLD){ c=true; return {...x, user: x.user===OLD?NEW:x.user, name: x.name===OLD?NEW:x.name}} return x}); if(c){ localStorage.setItem(k, JSON.stringify(a)); migrated=true } } }catch{}
      })
      if(migrated) window.dispatchEvent(new Event('harvest:verified'))
    } catch {}
  }, [])

  // Cache clearing listener — forces state refresh when Home.tsx clears storage
  useEffect(() => {
    const handler = () => { window.dispatchEvent(new Event('harvest:verified')); setHomeRefresh(x=>x+1) }
    window.addEventListener('harvest:cache-clear', handler)
    return () => window.removeEventListener('harvest:cache-clear', handler)
  }, [])

  const submitPost = (type, data) => {
    try {
      const raw=localStorage.getItem('harvest_users')
      const me = raw ? JSON.parse(raw)[0]?.username : localStorage.getItem('harvest_username')
      const u = raw ? JSON.parse(raw).find((x)=>x.username===me) : null
      if(!u?.verified){ alert('Only verified accounts can post — ask Allan (admin) to verify you'); return }
    } catch {}
    const item = { id: Date.now(), type, ...data, status: 'pending', at: new Date().toISOString() }
    const upd = [item, ...pending]
    setPending(upd)
    localStorage.setItem('harvest_pending', JSON.stringify(upd))
  }

  const approve = (id) => {
    const item = pending.find(x => x.id === id)
    if (!item) return
    const rest = pending.filter(x => x.id !== id)
    setPending(rest)
    localStorage.setItem('harvest_pending', JSON.stringify(rest))
    if (item.type === 'post') {
      const upd = [{ user: item.user, verified: false, loc: 'Nyeri', time: 'now', likes: 0, img: item.img || 'https://picsum.photos/400/400?random=' + id, caption: item.caption, comments: 0 }, ...approvedPosts]
      setApprovedPosts(upd)
      localStorage.setItem('harvest_approved_posts', JSON.stringify(upd))
    } else if (item.type === 'story') {
      const upd = [{ name: item.user, id: `${item.user}_${id}`, caption: item.caption, img: item.img }, ...approvedStories]
      setApprovedStories(upd)
      localStorage.setItem('harvest_approved_stories', JSON.stringify(upd))
    } else if (item.type === 'reel') {
      const upd = [{ user: item.user, cap: item.caption, views: '0', img: item.img || 'https://picsum.photos/400/700?random=' + id, video: item.video }, ...approvedReels]
      setApprovedReels(upd)
      localStorage.setItem('harvest_approved_reels', JSON.stringify(upd))
    }
    window.dispatchEvent(new Event('harvest:approved'))
  }
  const deleteStory = (id) => {
    const upd = approvedStories.filter((s)=> s.id !== id)
    setApprovedStories(upd)
    localStorage.setItem('harvest_approved_stories', JSON.stringify(upd))
    window.dispatchEvent(new Event('harvest:approved'))
  }
  const reject = (id) => {
    const rest = pending.filter(x => x.id !== id)
    setPending(rest)
    localStorage.setItem('harvest_pending', JSON.stringify(rest))
  }

  const [chosenGroup, setChosenGroup] = useState('Harvest Central')
  const [showSwitcher,setShowSwitcher]=useState(false)
  const switchAccount=(username)=>{
    try{
      const prev = localStorage.getItem('harvest_username')||''
      const curTok = localStorage.getItem('harvest_token')||''
      if(prev && curTok) localStorage.setItem(`harvest_token_${prev}`, curTok)
      let arr=JSON.parse(localStorage.getItem('harvest_users')||'[]')
      if(!arr.length) arr=[...mockUsers]
      const idx=arr.findIndex((u)=>u.username===username)
      if(idx<0) return
      const picked=arr[idx]
      const rest=arr.filter((_,i)=>i!==idx)
      const reordered=[{...picked,me:true},...rest.map((u)=>({...u,me:false}))]
      localStorage.setItem('harvest_users',JSON.stringify(reordered))
      localStorage.setItem('harvest_username',username)
      // swap token per-account — no leakage. Keep the current token when the
      // target account has none (e.g. offline/demo accounts) so an admin does
      // not silently lose their authenticated session on switch.
      const nextTok = localStorage.getItem(`harvest_token_${username}`)||''
      if(nextTok) localStorage.setItem('harvest_token', nextTok)
      else if(username!==prev && !curTok) localStorage.removeItem('harvest_token')
      setUsers(reordered)
      setUsername(username)
      if(username==='allan'){ setRole('admin'); localStorage.setItem('harvest_role','admin'); localStorage.setItem('harvest_pin','7777') } else { setRole('member'); localStorage.setItem('harvest_role','member') }
      // force socket reconnect with new token
      try{ if(window.__harvest_reconnect){ window.__harvest_reconnect()} }catch{}
      window.dispatchEvent(new Event('harvest:verified'))
      window.dispatchEvent(new Event('harvest:switched'))
    }catch{}
  }

  const handleAuthSuccess = (data) => {
    localStorage.setItem('harvest_token', data.token)
    localStorage.setItem(`harvest_token_${data.username}`, data.token)
    localStorage.setItem('harvest_username', data.username)
    localStorage.setItem('harvest_onboarded', '1')
    localStorage.setItem('harvest_role', data.role)
    setUsername(data.username)
    setRole(data.role)
    setVerified(Boolean(data.verified))
    const parts = String(data.username || '').split('_')
    setFirst(parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : '')
    setLast(parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : '')
    setOnboarded(true)
    try { if (window.__harvest_reconnect) window.__harvest_reconnect() } catch {}
    window.dispatchEvent(new Event('harvest:verified'))
  }

  if (!onboarded) return <Onboarding onAuthSuccess={handleAuthSuccess} />

  return (
    <div className="min-h-screen bg-black flex justify-center">
      <div className="w-full max-w-[390px] bg-black min-h-screen flex flex-col">
        <div className="flex-1 overflow-auto">
          {tab === 'home' && <Home setTab={handleTab} users={users} onDeleteStory={deleteStory} refreshKey={homeRefresh} onSwitchAccount={()=>setShowSwitcher(true)} />}
          {tab === 'search' && <Search users={users} onView={u => { setViewUser(u); setTab('viewuser') }} />}
          {tab === 'reels' && <Reels />}
          {tab === 'post' && <PostCreate onDone={() => setTab('home')} onSubmit={submitPost} />}
          {tab === 'activity' && <Activity />}
           {tab === 'profile' && <Profile first={first} last={last} pending={pending} onApprove={approve} onReject={reject} users={users} onSwitch={()=>setShowSwitcher(true)} onStatClick={(type,uid)=>setUserList({type,userId:uid})} onGroupClick={(gid)=>setGroupDetail(gid)} setUsers={setUsers} onOpenAdmin={()=>setTab('admin')} />}
           {tab === 'chat' && <Chat onBack={() => setTab('home')} users={users} />}
           {tab === 'viewuser' && <ViewUser user={viewUser} onBack={() => setTab('search')} />}
           {tab === 'music' && <Music musics={musics} onAdd={addMusic} />}
           {tab === 'give' && <Give />}
           {tab === 'map' && <HarvestMap users={users} setUsers={setUsers} />}
           {tab === 'groups' && <Groups users={users} onSelectGroup={(g) => setGroupDetail(g)} />}
           {tab === 'admin' && (
             <RequireRole role="admin">
               <Admin onBack={() => setTab('profile')} users={users} setUsers={setUsers} />
             </RequireRole>
           )}
         </div>
         {showSwitcher && <AccountSwitcher users={users} onSwitch={switchAccount} onClose={()=>setShowSwitcher(false)} />}
         {groupDetail && <GroupDetails groupId={groupDetail} users={users} onBack={()=>setGroupDetail(null)} onSwitch={()=>setGroupDetail(null)} />}
         {userList && <UserListModal type={userList.type} userId={userList.userId} users={users} onBack={()=>setUserList(null)} />}
         <Nav tab={tab} setTab={handleTab} onProfileLongPress={()=>setShowSwitcher(true)} />
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

  const submitRegister = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || 'Registration failed')
      onAuthSuccess?.(data)
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
    <div className="min-h-screen bg-white flex justify-center">
      <div className="w-full max-w-[390px] bg-white min-h-screen flex flex-col">
        <div className="h-[44px] flex items-center justify-between px-4">
          <div className="flex items-center gap-2"><div className="w-7 h-7 rounded-lg bg-[#7C3AED] text-white flex items-center justify-center text-[11px] font-bold">HF</div><span className="text-[13px] font-semibold text-zinc-900">Harvest Family Church</span><span className="text-[11px] text-zinc-500 -ml-1 hidden sm:inline"> Nyeri</span></div>
          <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')} className="text-[13px] font-semibold px-3 py-1 rounded-full border border-zinc-200 text-zinc-700">
            {mode === 'register' ? 'Sign in' : 'New here?'}
          </button>
        </div>

        <div className="rounded-[20px] mx-4 mt-4 p-5 bg-gradient-to-br from-[#EDE9FE] via-[#F5F0FF] to-[#FFFBEB] border border-[#EDE9FE]">
          <span className="inline-flex text-[11px] font-bold tracking-wide bg-[#F59E0B] text-white px-3 py-1 rounded-full">Karibu</span>
          <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-[#5B21B6] mt-3">Welcome to<br />Harvest Family<br />Church Nyeri</h1>
          <p className="text-[12px] font-semibold tracking-widest text-[#7C3AED] mt-2">COMPEL · RAISE · RELEASE</p>
        </div>

        {mode === 'register' ? (
          <div className="px-6 mt-4 flex-1 space-y-3 overflow-auto">
            <h2 className="text-[15px] font-bold text-zinc-900">Create your account</h2>
            <p className="text-[13px] text-zinc-500">Use your phone number and a password you'll remember.</p>
            <input value={form.username} onChange={set('username')} placeholder="Username (e.g. joy_wambui)" autoCapitalize="none" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            <input value={form.name} onChange={set('name')} placeholder="Full name" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            <input value={form.phone} onChange={set('phone')} placeholder="Phone number (07xx / 01xx)" inputMode="tel" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            <input value={form.password} onChange={set('password')} placeholder="Password (min 8 characters)" type="password" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            <div>
              <p className="text-xs font-bold text-zinc-700 mb-1">Choose Harvest Group *</p>
              <select value={form.group_name} onChange={set('group_name')} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-sm outline-none focus:border-[#7C3AED]">
                {['Harvest Central', 'Harvest Skuta', 'Harvest Kamakwa', 'Harvest Ruringu', 'Harvest Majengo'].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <p className="text-[11px] text-zinc-500 mt-1">You'll be grouped with members near you</p>
            </div>
            {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
          </div>
        ) : (
          <div className="px-6 mt-4 flex-1 space-y-3 overflow-auto">
            <h2 className="text-[15px] font-bold text-zinc-900">Sign in</h2>
            <p className="text-[13px] text-zinc-500">Username or phone number + your password.</p>
            <input value={loginId} onChange={e => setLoginId(e.target.value)} placeholder="Username or phone" autoCapitalize="none" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            <input value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && void submitLogin()} placeholder="Password or PIN" type="password" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3.5 text-[15px] outline-none focus:bg-white focus:border-[#7C3AED]" />
            {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
          </div>
        )}

        <div className="p-4">
          <button
            onClick={() => void (mode === 'register' ? submitRegister() : submitLogin())}
            disabled={busy}
            className={`w-full py-4 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2 ${busy ? 'bg-zinc-200 text-zinc-400' : 'bg-[#7C3AED] text-white hover:bg-[#6D28D9]'}`}
          >
            {busy ? 'Please wait…' : mode === 'register' ? 'Create my account →' : 'Sign in →'}
          </button>
          {mode === 'register' && <p className="text-[11px] text-zinc-500 text-center mt-2">Admin approval is not needed to join — welcome to the family.</p>}
        </div>
      </div>
    </div>
  )
}

function Activity() {
  return <div className="bg-black text-white min-h-[70vh] p-4"><h1 className="font-bold">Activity</h1><div className="mt-4 space-y-4">{[{ u: 'pst.simon', t: 'liked your photo.' }, { u: 'allan', t: 'followed you.' }].map(x => <div key={x.u} className="flex gap-3 items-center"><div className="w-10 h-10 rounded-full bg-zinc-800" /><p className="text-[13px] flex-1"><b>{x.u}</b> {x.t}</p><div className="w-10 h-10 bg-zinc-800 rounded" /></div>)}</div></div>
}

function Profile({ first, last, pending, onApprove, onReject, users, onSwitch, onStatClick, onGroupClick, setUsers, onOpenAdmin }) {
  const username = ((first || 'harvest').toLowerCase().replace(/\s+/g, '') + '_' + (last || 'family').toLowerCase().replace(/\s+/g, ''))
  const me = users.find(u => u.username === username) || users[0]
  const { isAdmin, role } = useAuth()

  // Build groups from user data
  const groups = {}
  users.forEach(u => { const g = u.group || 'Harvest Nyeri'; if(!groups[g]) groups[g]=[]; groups[g].push(u.username) })

  // Pending approvals only visible to admin
  const myPending = pending.filter(p => p.user === username || (isAdmin && true))

  return (
    <div className="bg-black text-white">
      <div className="px-4 pt-2 flex justify-between items-center">
        <button onClick={()=>onSwitch&&onSwitch()} className="font-bold flex items-center gap-1">{(first || 'harvest') + (last ? '_' + last : '_family')} ⌄</button>
        <div className="flex gap-2 items-center">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${role==='admin' ? 'bg-[#7C3AED] text-white' : role==='leader' ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-300'}`}>
            {role === 'admin' ? '★ Admin' : role === 'leader' ? '★ Leader' : 'Member'}
          </span>
          {isAdmin && <span className="text-[10px] bg-amber-500 text-black px-2 py-0.5 rounded-full">{pending.length} pending</span>}
        </div>
      </div>

      {/* Stats — clickable */}
      <div className="px-4 mt-4 flex gap-4 items-center">
        <div className="w-[86px] h-[86px] rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[3px]"><div className="w-full h-full rounded-full bg-black flex items-center justify-center font-bold border-[3px] border-black">{(first[0] || 'H') + (last[0] || 'F')}</div></div>
        <div className="flex gap-6 flex-1 justify-around text-center">
          <button onClick={() => onStatClick?.('posts', username)} className="hover:opacity-70"><p className="font-bold">12</p><p className="text-xs text-zinc-400">posts</p></button>
          <button onClick={() => onStatClick?.('followers', username)} className="hover:opacity-70"><p className="font-bold">1.2k</p><p className="text-xs text-zinc-400">followers</p></button>
          <button onClick={() => onStatClick?.('following', username)} className="hover:opacity-70"><p className="font-bold">48</p><p className="text-xs text-zinc-400">following</p></button>
        </div>
      </div>

      <div className="px-4 mt-3"><p className="text-[13px] font-semibold">{first} {last}</p><p className="text-[13px]">Harvest Family Church Nyeri ✦</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-xs bg-zinc-800 px-2 py-1 rounded-full">📍 {me?.location || 'Nyeri'}</span>
          <span className="text-xs bg-gradient-to-r from-yellow-500 to-purple-600 text-black px-2 py-1 rounded-full font-semibold">👥 {me?.group || 'Harvest Nyeri'}</span>
           {!isAdmin && import.meta.env.DEV && <span className="text-[11px] text-zinc-500 self-center">Member • PIN 7777 for admin (dev only)</span>}
        </div></div>
      <button onClick={()=>onSwitch&&onSwitch()} className="mx-4 mt-3 w-[calc(100%-2rem)] py-2 rounded-full bg-zinc-800 text-white text-xs font-semibold">🔄 Switch account — 4 active (IG style)</button>
      <p className="text-[11px] text-zinc-500 text-center mt-1">Allan ✓ • Youth Harvest ✓ • Worship Team ✓ • Pst Simon</p>

      {/* Admin-only: server-backed moderation queue */}
      {isAdmin && (
        <div className="mt-4 border-t border-zinc-800 pt-3 px-4">
          <button onClick={() => onOpenAdmin?.()} className="w-full py-2.5 rounded-full bg-[#7C3AED] text-white text-xs font-bold">🛡 Open moderation queue</button>
          <p className="text-[11px] text-zinc-500 text-center mt-2">Review posts, stories and reels submitted by members</p>
        </div>
      )}

      {/* Admin-only: Pending Approvals */}
      {isAdmin && myPending.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="text-sm font-bold px-4 text-amber-400 mb-2">⏳ Pending ({myPending.length})</h3>
          <div className="space-y-2 px-4">
            {myPending.map(item => (
              <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex justify-between items-center">
                <div><p className="text-xs font-semibold">{item.user}</p><p className="text-[11px] text-zinc-400">{item.type} • {item.caption?.slice(0,30)}</p></div>
                <div className="flex gap-2">
                  <button onClick={() => onApprove(item.id)} className="px-3 py-1 rounded-full bg-green-600 text-white text-[10px] font-bold">✓</button>
                  <button onClick={() => onReject(item.id)} className="px-3 py-1 rounded-full bg-zinc-700 text-white text-[10px] font-bold">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin-only: Verified Accounts */}
      {isAdmin && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="text-sm font-bold px-4 text-blue-400 mb-2">✓ Verified Accounts</h3>
          <div className="space-y-2 px-4">
            {users.filter(u=>u.verified).map(u => (
              <div key={u.username} className="flex items-center justify-between p-2 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="flex gap-2 items-center"><div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs">{u.username[0].toUpperCase()}</div><div><p className="text-xs font-semibold">{u.username} <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /></p></div></div>
                <button onClick={() => {
                  const updated = users.map(x => x.username === u.username ? {...x, verified: !x.verified} : x)
                  setUsers(updated)
                  localStorage.setItem('harvest_users', JSON.stringify(updated))
                  window.dispatchEvent(new Event('harvest:verified'))
                }} className="px-3 py-1 rounded-full text-[10px] font-bold bg-white text-black">{u.verified ? 'Unverify' : 'Verify'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Groups — clickable cards */}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <h3 className="text-sm font-bold px-4 text-white mb-2">Harvest Groups by Location</h3>
        <div className="space-y-2 px-4">
          {Object.entries(groups).map(([g, members]) => (
            <button key={g} onClick={() => onGroupClick?.(g)} className="w-full flex justify-between items-center p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-left hover:bg-zinc-800">
              <div><p className="text-sm font-semibold text-white">{g}</p><p className="text-xs text-zinc-400">{members.length} members</p></div>
              <span className="text-xs bg-white text-black px-3 py-1 rounded-full">{members.length} 👥</span>
            </button>
          ))}
        </div>
      </div>

      <Groups users={users} onSelectGroup={(g) => onGroupClick?.(g)} />
      <div className="grid grid-cols-3 gap-[1px] bg-zinc-800 mt-4">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="aspect-square bg-zinc-900"><img src={`https://picsum.photos/300/300?random=${i + 50}`} alt="" className="w-full h-full object-cover" /></div>)}</div>
    </div>
  )
}

function Nav({ tab, setTab, onProfileLongPress }) {
  const items = [
    ['home', 'home'],
    ['search', 'search'],
    ['reels', 'reels'],
    ['map', 'map'],
    ['give', 'give'],
    ['music', 'music'],
    ['profile', 'profile'],
  ]
  return (
    <div className="flex justify-around items-center h-[49px] border-t border-zinc-800 bg-black sticky bottom-0">
      {items.map(([id]) => (
        <button key={id} onClick={() => setTab(id)} onTouchStart={()=>{ if(id==='profile'){ window.__pressTimer=setTimeout(()=>onProfileLongPress&&onProfileLongPress(),600)} }} onTouchEnd={()=>clearTimeout(window.__pressTimer)} onMouseDown={()=>{ if(id==='profile'){ window.__pressTimer=setTimeout(()=>onProfileLongPress&&onProfileLongPress(),600)} }} onMouseUp={()=>clearTimeout(window.__pressTimer)} className="p-2">
          <IgIcon name={id} active={tab === id} />
        </button>
      ))}
    </div>
  )
}
