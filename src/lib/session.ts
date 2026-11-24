// Session guard — the app stores a JWT that expires (24h members, 7d admin).
// Before this guard, an expired token made every authed screen fail silently:
// Departments/Groups/Activity showed "Could not load…", comments/likes did
// nothing. Now any 401 from the API (except the auth endpoints themselves)
// raises ONE event; App.jsx listens and returns the user to the login screen
// with a clear "session expired" message.

let installed = false
let lastFired = 0

// No request may wait forever. Uploads are excluded: they are binary bodies
// with their own progress/stall handling (backgroundUploads, Chat, AdminMedia,
// uploadToMinio), and aborting a legitimate large transfer at 30 s would be a
// regression. Requests that already carry a signal keep their own deadline.
const REQUEST_TIMEOUT_MS = 30_000
const TIMEOUT_MESSAGE = 'The church server took too long to respond — check your connection and try again.'

export const SESSION_EXPIRED_EVENT = 'harvest:session-expired'

export function installSessionGuard() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args
    const url = typeof input === 'string' ? input : (input as Request)?.url || String(input)
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = init?.body
    const isUpload = body instanceof FormData || body instanceof Blob
      || (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
    const isHttp = /^https?:/i.test(url) || url.startsWith('/')
    const alreadyBounded = Boolean(init?.signal || (input instanceof Request && input.signal))
    const bound = isHttp && !isUpload && !alreadyBounded && method !== 'HEAD'
    const controller = bound ? new AbortController() : null
    const timer = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0
    let res: Response
    try {
      res = bound
        ? await originalFetch(input as RequestInfo | URL, { ...(init || {}), signal: controller!.signal })
        : await originalFetch(...args)
    } catch (e: any) {
      if (e?.name === 'AbortError' && bound) throw new Error(TIMEOUT_MESSAGE)
      throw e
    } finally {
      if (timer) window.clearTimeout(timer)
    }
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
