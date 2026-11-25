// Worker entrypoint — plain fetch router.
// Order: CORS/preflight → authenticate → route handlers → error envelope.
import { corsFor, jsonResponse, errorResponse, ApiError } from './lib/http.js'
import { authenticate, adminOperationRateLimit } from './lib/auth.js'
import { handleAuth } from './routes/auth.js'
import { handleUsers } from './routes/users.js'
import { handleFeed } from './routes/feed.js'
import { handleMedia } from './routes/media.js'
import { handleChat } from './routes/chat.js'
import { handlePending, runScheduledCleanup } from './routes/pending.js'
import { handleGiving } from './routes/giving.js'
import { handleProjects } from './routes/projects.js'
import { handleDepartments } from './routes/departments.js'
import { handleGroups } from './routes/groups.js'
import { handleContent } from './routes/content.js'
import { handleSermons } from './routes/sermons.js'
import { handleSocial } from './routes/social.js'
import { handleAdminAudit } from './routes/adminAudit.js'
import { handleAdminHealth } from './routes/adminHealth.js'
import { handleShare } from './routes/share.js'
import { handleNotifications } from './routes/notifications.js'
import { handlePublishing, runPublishingSweep } from './routes/publishing.js'
import { Realtime } from './realtime.js'

export { Realtime }

const VERSIONED_APK = /^harvest-family-[0-9]+-[0-9a-f]{7}\.apk$/

// The release version travels with the assets, not with the deploy command.
// Both release paths (the CI workflow and update-apk.sh) write app-version.json
// next to the staged web app, so this describes exactly what was shipped.
// It used to come from the deploy-time RELEASE_APK_FILENAME var only, which a
// plain `wrangler deploy` drops — and then /api/app-version answered
// update_available:false and the permanent APK URL answered 503, silently
// ending updates for every installed app.
async function readAppVersionManifest(env, url) {
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/app-version.json', url.origin).toString()))
    if (!res.ok) return null
    const data = await res.json()
    const code = Number(data?.version_code)
    if (!Number.isFinite(code) || code <= 0) return null
    // The updater verifies the APK before installing it. Older manifests do
    // not carry a digest; omit it rather than sending a malformed value so
    // those installs keep working without verification.
    const sha256 = String(data?.sha256 || '').trim().toLowerCase()
    return {
      version_code: code,
      version_name: String(data?.version_name || ''),
      apk_url: String(data?.apk_url || '/harvest-family.apk'),
      sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : '',
    }
  } catch {
    return null
  }
}

// Which staged APK the permanent URL should serve for this deployment.
async function resolveReleaseApk(env, url) {
  const configured = String(env.RELEASE_APK_FILENAME || '')
  if (VERSIONED_APK.test(configured)) return { filename: configured }
  const manifest = await readAppVersionManifest(env, url)
  const fromManifest = String(manifest?.apk_url || '').replace(/^\//, '')
  if (VERSIONED_APK.test(fromManifest)) return { filename: fromManifest }
  if (!fromManifest || fromManifest === 'harvest-family.apk') return { filename: 'harvest-family.apk' }
  return null
}

// Cloudflare's static-asset binding ignores Range: it always answers with the
// full object and a 200. The Android downloader depends on 206 responses to
// resume an interrupted APK, so slice the asset here and return the range
// ourselves. APKs are a few megabytes, which is well inside a Worker's memory
// budget. This also advertises Accept-Ranges, which the asset surface omits.
async function serveApkAsset(request, env, target, extraHeaders = {}) {
  const assetResponse = await env.ASSETS.fetch(new Request(target.toString(), { method: 'GET' }))
  if (!assetResponse.ok) return assetResponse

  const headers = new Headers(assetResponse.headers)
  headers.set('Accept-Ranges', 'bytes')
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value)

  const range = request.headers.get('Range')
  if (!range) {
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    })
  }

  const bytes = await assetResponse.arrayBuffer()
  const total = bytes.byteLength
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
  const invalid = () => new Response(null, {
    status: 416,
    headers: {
      ...Object.fromEntries(headers),
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${total}`,
      'Content-Length': '0',
    },
  })

  if (!match || (!match[1] && !match[2])) return invalid()

  let start
  let end
  if (!match[1]) {
    // A suffix range asks for the final N bytes; this is not what the updater
    // sends, but supporting it keeps the endpoint correct for other clients.
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || total === 0) return invalid()
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : total - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
      return invalid()
    }
    end = Math.min(end, total - 1)
  }

  // The body comes from the decoded asset. If an upstream encoding was
  // present, its metadata no longer describes these bytes.
  headers.delete('Content-Encoding')
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  headers.set('Content-Length', String(end - start + 1))
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Keep the public download URL stable while every release APK uses a
    // unique, immutable filename. The release workflow injects the current
    // filename with `wrangler deploy --var RELEASE_APK_FILENAME:...`.
    if (url.pathname === '/harvest-family.apk' && request.method === 'GET') {
      const released = await resolveReleaseApk(env, url)
      if (!released) {
        return new Response('APK release target unavailable', {
          status: 503,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        })
      }
      const filename = released.filename

      const target = new URL('/' + filename, url.origin)
      // Serve the current immutable release directly instead of redirecting.
      // This keeps the permanent URL cache-independent while preserving the
      // versioned APK as the immutable asset underneath it.
      target.searchParams.set('release', filename)
      return serveApkAsset(request, env, target, {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
      })
    }

    // Serve immutable release APKs through the assets binding. The release
    // workflow makes this Worker run first for APK paths so these requests
    // cannot fall through to the authenticated API router. Range slicing is
    // handled here for the same reason as the permanent URL above.
    if (/^\/harvest-family-[0-9]+-[0-9a-f]{7}\.apk$/.test(url.pathname) && request.method === 'GET') {
      return serveApkAsset(request, env, url, {
        'Content-Disposition': 'attachment; filename="' + url.pathname.slice(1) + '"',
      })
    }

    // Public latest-version probe for the in-app update prompt. The release
    // workflow injects RELEASE_APK_FILENAME=harvest-family-<run>-<sha>.apk,
    // so the run number doubles as a monotonic versionCode (matches the
    // Android versionCode = 1000 + run number). No auth: version info and
    // the public download URL are not sensitive.
    if (url.pathname === '/api/app-version' && request.method === 'GET') {
      const manifest = await readAppVersionManifest(env, url)
      if (manifest) {
        return withCors(jsonResponse({
          update_available: true,
          version_code: manifest.version_code,
          version_name: manifest.version_name,
          apk_url: manifest.apk_url,
          ...(manifest.sha256 ? { sha256: manifest.sha256 } : {}),
        }), env, request)
      }
      // Fallback for deployments made before app-version.json shipped.
      const match = VERSIONED_APK.exec(String(env.RELEASE_APK_FILENAME || ''))
      if (!match) return withCors(jsonResponse({ update_available: false }), env, request)
      // VERSIONED_APK has no capture group (it is shared with .test()), so pull
      // the run number out of the matched filename itself.
      const run = Number(/-([0-9]+)-[0-9a-f]{7}\.apk$/.exec(match[0])?.[1])
      if (!Number.isFinite(run)) return withCors(jsonResponse({ update_available: false }), env, request)
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

    // Sensitive administrative writes get a per-admin/per-network ceiling even
    // with a valid token. Media multipart and notification-token routes are
    // excluded: chunked uploads legitimately exceed this rate.
    const ADMIN_WRITE_PATHS = [
      /^\/api\/admin\//,
      /^\/api\/giving\/(admin|transactions)/,
      /^\/api\/pending\//,
      /^\/api\/content(\/|$)/,
      /^\/api\/sermons(\/|$)/,
      /^\/api\/departments(\/|$)/,
      /^\/api\/projects\/admin(\/|$)/,
      /^\/api\/groups(\/|$)/,
    ]

    try {
      const hadBearer = (request.headers.get('authorization') || '').startsWith('Bearer ')
      const user = await authenticate(env, request)
      // A supplied token that no longer verifies is an expired or replaced
      // session, never a guest. Returning 401 lets the client session guard
      // clear local state (an old admin browser must not keep rendering admin).
      if (hadBearer && !user) return withCors(errorResponse('session expired — sign in again', 401), env, request)
      // waitUntil passes background work (FCM fan-out) to the runtime without
      // blocking the response.
      const ctx2 = { user, waitUntil: (p) => { try { ctx.waitUntil(p) } catch { /* already returned */ } } }

      if (
        user?.role === 'admin'
        && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && ADMIN_WRITE_PATHS.some(re => re.test(url.pathname))
      ) {
        await adminOperationRateLimit(env, request, user)
      }

      const handlers = [handleAuth, handleUsers, handleFeed, handleMedia, handleChat, handlePending, handleGiving, handleProjects, handleDepartments, handleGroups, handleContent, handleSermons, handlePublishing, handleSocial, handleAdminAudit, handleAdminHealth, handleNotifications]
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

  async scheduled(event, env, _ctx) {
    // */10 * * * * — story expiry, orphan cleanup, attempts GC, and any
    // publication schedules missed while the worker was not running.
    const result = await runScheduledCleanup(env)
    const publishing = await runPublishingSweep(env).catch(e => ({ error: e?.message || String(e) }))
    console.log('[cron]', JSON.stringify({ ...result, publishing }))
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
