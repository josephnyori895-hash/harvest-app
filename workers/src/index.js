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
import { handleShare } from './routes/share.js'
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
      // Serve the current immutable release directly instead of redirecting.
      // This keeps the permanent URL cache-independent while preserving the
      // versioned APK as the immutable asset underneath it.
      target.searchParams.set('release', filename)
      const assetResponse = await env.ASSETS.fetch(new Request(target.toString(), request))
      if (!assetResponse.ok) return assetResponse

      const headers = new Headers(assetResponse.headers)
      headers.set('Cache-Control', 'no-store, max-age=0')
      headers.set('Content-Disposition', 'attachment; filename="' + filename + '"')
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      })
    }

    // Serve immutable release APKs through the assets binding. The release
    // workflow makes this Worker run first for APK paths so these requests
    // cannot fall through to the authenticated API router.
    if (/^\/harvest-family-[0-9]+-[0-9a-f]{7}\.apk$/.test(url.pathname) && request.method === 'GET') {
      return env.ASSETS.fetch(request)
    }

    // Public latest-version probe for the in-app update prompt. The release
    // workflow injects RELEASE_APK_FILENAME=harvest-family-<run>-<sha>.apk,
    // so the run number doubles as a monotonic versionCode (matches the
    // Android versionCode = 1000 + run number). No auth: version info and
    // the public download URL are not sensitive.
    if (url.pathname === '/api/app-version' && request.method === 'GET') {
      const filename = env.RELEASE_APK_FILENAME
      const match = /^harvest-family-([0-9]+)-[0-9a-f]{7}\.apk$/.exec(String(filename || ''))
      if (!match) return withCors(jsonResponse({ update_available: false }), env, request)
      const run = Number(match[1])
      return withCors(jsonResponse({
        update_available: true,
        version_code: 1000 + run,
        version_name: `1.0.${run}`,
        apk_url: '/harvest-family.apk',
      }), env, request)
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

    // Public share landing page (WhatsApp deep links) — must run before the
    // auth/API router because it lives on '/' and needs no authentication.
    const shareRes = await handleShare(request, env, null, {})
    if (shareRes) return shareRes

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
