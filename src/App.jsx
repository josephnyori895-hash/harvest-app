
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
  return [users, setUsers]
}

function IgIcon({ name, active }) {