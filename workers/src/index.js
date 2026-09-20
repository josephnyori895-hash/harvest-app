// Worker entrypoint — plain fetch router.
// Order: CORS/preflight → authenticate → route handlers → error envelope.
import { corsFor, jsonResponse, errorResponse, ApiError } from './lib/http.js'
import { authenticate } from './lib/auth.js'
import { handleAuth } from './routes/auth.js'
import { handleUsers } from './routes/users.js'
import { handleFeed } from './routes/feed.js'
import { handleMedia } from './routes/media.js'
import { handleChat } from './routes/chat.js'
import { handlePending, runScheduledCleanup } from './routes/pending.js'
import { handleGiving } from './routes/giving.js'
import { handleDepartments } from './routes/departments.js'
import { handleGroups } from './routes/groups.js'
import { handleContent } from './routes/content.js'
import { handleSermons } from './routes/sermons.js'
import { handleSocial } from './routes/social.js'
import { Realtime } from './realtime.js'

export { Realtime }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // WebSocket upgrade → Realtime DO (chat, presence, calls).
    // NOTE: the original request object must be forwarded unchanged for upgrades.
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (url.pathname !== '/ws') return errorResponse('unknown websocket path', 404)
      const id = env.REALTIME.idFromName('singleton')
      const stub = env.REALTIME.get(id)
      return stub.fetch(request)
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsFor(env, request) })
    }

    try {
      const user = await authenticate(env, request)
      const ctx2 = { user }

      const handlers = [handleAuth, handleUsers, handleFeed, handleMedia, handleChat, handlePending, handleGiving, handleDepartments, handleGroups, handleContent, handleSermons, handleSocial]
      for (const handler of handlers) {
        const res = await handler(request, env, ctx2, extractParams(url))
        if (res) return withCors(res, env, request)
      }

      return withCors(errorResponse('not found', 404), env, request)
    } catch (e) {
      if (e instanceof ApiError) return withCors(errorResponse(e.message, e.status), env, request)
      console.error('unhandled API error', e?.message, e?.stack)
      return withCors(errorResponse('internal server error', 500), env, request)
    }
  },

  async scheduled(event, env, ctx) {
    // */10 * * * * — story expiry, orphan cleanup, attempts GC.
    const result = await runScheduledCleanup(env)
    console.log('[cron]', JSON.stringify(result))
  },
}

function withCors(res, env, request) {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsFor(env, request))) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Path params helper: /api/users/:username/... and /api/admin/users/:username...
function extractParams(url) {
  const m = url.pathname.match(/^\/api\/(?:admin\/)?users\/([^/]+)(?:\/.*)?$/)
  return m ? { username: decodeURIComponent(m[1]) } : {}
}
