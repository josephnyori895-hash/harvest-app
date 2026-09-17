// HTTP plumbing: CORS, security headers, JSON helpers, error envelope.
// Mirrors app.js onSend hooks + error handler. CORS_ORIGINS arrives via env (wrangler vars/secrets).

export function corsFor(env, request) {
  const allowed = String(env.CORS_ORIGINS || '')
    .split(',').map(v => v.trim()).filter(Boolean)
  const origin = request.headers.get('Origin') || ''
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), payment=()',
    'Cache-Control': 'no-store',
  }
  if (allowed.length === 0) headers['Access-Control-Allow-Origin'] = '*'
  else if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  else headers['Access-Control-Allow-Origin'] = allowed[0]
  return headers
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

export function errorResponse(message, status = 400, extraHeaders = {}) {
  return jsonResponse({ error: message }, status, extraHeaders)
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function httpError(status, message) {
  return new ApiError(status, message)
}

export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export function searchParams(url) {
  const o = {}
  for (const [k, v] of new URL(url).searchParams.entries()) o[k] = v
  return o
}
