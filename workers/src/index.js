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
import { handleAdminAudit } from './routes/adminAudit.js'
import { Realtime } from './realtime.js'

export { Realtime }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Keep the public download URL stable while every release APK uses a
    // unique, immutable filename. The release workflow injects the current
    // filename with `wrangler deploy --var RELEASE_APK_FILENAME:...`.
    if (url.pathname === '/harvest-family.apk' && request.method === 'GET') {
      const filename = env.RELEASE_APK_FILENAME
      if (!filename || !/^harvest-family-[0-9]+-[0-9a-f]{7}\.apk$/.test(filename)) {
        return new Response('APK release target unavailable', {
          status: 503,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        })
      }

      const target = new URL('/' + filename, url.origin)
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          'Cache-Control': 'no-store, max-age=0',
        },
      })
    }

    // WebSocket upgrade → Realtime DO (chat, presence, calls).
    // NOTE: the original request object must be forwarded unchanged for upgrades.
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (url.pathname !== '/ws') return errorResponse('unknown websocket path', 404)
      const id = env.REALTIME.idFromName('singleton')
      const stub = env.REALTIME.get(id)
      return stub.fetch(request)
    }

    // Public liveness/readiness probe for production smoke tests. Keep the
    // response intentionally minimal: no credentials or internal infrastructure details.
    if (url.pathname === '/health' && request.method === 'GET') {
      let database = 'ok'
      try {
        await env.DB.prepare('SELECT 1 AS ok').first()
      } catch {
        database = 'error'
      }
      const storage = env.MEDIA ? 'r2' : 'missing'
      const status = database === 'ok' && storage === 'r2' ? 'ok' : 'degraded'
      return withCors(jsonResponse({ status, database, storage }), env, request)
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsFor(env, request) })
    }

    try {
      const user = await authenticate(env, request)
      const ctx2 = { user }

      const handlers = [handleAuth, handleUsers, handleFeed, handleMedia, handleChat, handlePending, handleGiving, handleDepartments, handleGroups, handleContent, handleSermons, handleSocial, handleAdminAudit]
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
