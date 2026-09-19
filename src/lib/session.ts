// Session guard — the app stores a JWT that expires (24h members, 7d admin).
// Before this guard, an expired token made every authed screen fail silently:
// Departments/Groups/Activity showed "Could not load…", comments/likes did
// nothing. Now any 401 from the API (except the auth endpoints themselves)
// raises ONE event; App.jsx listens and returns the user to the login screen
// with a clear "session expired" message.

let installed = false
let lastFired = 0

export const SESSION_EXPIRED_EVENT = 'harvest:session-expired'

export function installSessionGuard() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args)
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || ''
      const isApi = url.includes('/api/')
      const isAuthCall = url.includes('/api/auth/login') || url.includes('/api/auth/register')
      if (res.status === 401 && isApi && !isAuthCall && Date.now() - lastFired > 4000) {
        lastFired = Date.now()
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
      }
    } catch { /* never break a request over the guard */ }
    return res
  }
}

export function fireSessionExpired() {
  if (Date.now() - lastFired > 4000) {
    lastFired = Date.now()
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }
}
