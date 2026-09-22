// Public share landing page — GET /?shared=<post|reel|story>&id=<uuid>
// WhatsApp links previously pointed at a dead Netlify site. The Worker has the
// data, so it renders the real content as a branded card with OG meta tags
// (WhatsApp crawls these for the rich preview) plus a Get-the-app CTA.
// No auth: only approved/public rows are shown, and only minimal fields.
import { mediaUrlOrNull } from '../lib/media.js'

const BRAND = 'Harvest Family Church · Nyeri'
const APK_URL = '/harvest-family.apk'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

export async function handleShare(request, env, ctx, params) {
  const url = new URL(request.url)
  if (request.method !== 'GET') return null
  if (url.pathname !== '/' && url.pathname !== '/index.html') return null

  // Not a share link → serve the web app itself. The Worker hosts the SPA so
  // the website can never be a dead separate deploy again — same origin, same
  // deployment as the API, APK downloads and WhatsApp share landing pages.
  const kind = url.searchParams.get('shared')
  const id = url.searchParams.get('id')
  if (!kind && !id) {
    if (!env.ASSETS) return null
    const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString(), { headers: request.headers }))
    return new Response(page.body, { status: page.status, headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }) })
  }
  if (!kind || !id) {
    return html(shareShell('Invalid link', 'This share link is not valid.'))
  }
  if (!/^(post|reel|story)$/.test(kind) || !/^[0-9a-f-]{16,64}$/i.test(id)) {
    return html(shareShell('Invalid link', 'This share link is not valid.'))
  }

  let row = null
  try {
    if (kind === 'post') {
      row = (await env.DB.prepare(
        `SELECT p.caption, p.created_at, u.name AS author, u.username, p.thumb_key, p.original_key
         FROM posts p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.approved_at IS NOT NULL LIMIT 1`
      ).bind(id).first()) || null
    } else if (kind === 'reel') {
      row = (await env.DB.prepare(
        `SELECT r.caption, r.created_at, r.poster_key, r.thumb_key, u.name AS author, u.username
         FROM reels r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.id = ? AND r.approved_at IS NOT NULL LIMIT 1`
      ).bind(id).first()) || null
    } else if (kind === 'story') {
      row = (await env.DB.prepare(
        `SELECT s.caption, s.created_at, s.thumb_key, s.original_key, s.media_type, u.name AS author, u.username
         FROM stories s LEFT JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ? LIMIT 1`
      ).bind(id, new Date().toISOString()).first()) || null
    }
  } catch {
    row = null
  }

  if (!row) {
    const msg = kind === 'story'
      ? 'This story has expired — stories live for 24 hours.'
      : 'This content is no longer available.'
    return html(shareShell('Link expired', msg))
  }

  const author = row.author || row.username || 'Harvest Family'
  const caption = row.caption || ''
  const kindLabel = kind === 'post' ? 'shared a post' : kind === 'reel' ? 'shared a video' : 'shared a 24h story'
  const imgKey = row.poster_key || row.thumb_key || null
  const imageUrl = imgKey ? await mediaUrlOrNull(env, imgKey, 3600) : null

  return html(shareShell(
    `${author} ${kindLabel} on the Harvest app`,
    caption || 'Tap to open it in the Harvest Family app.',
    { author, kindLabel, caption, imageUrl, when: row.created_at }
  ))
}

function shareShell(title, message, card) {
  const og = card ? `
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc((card.caption || message).slice(0, 200))}" />
  ${card.imageUrl ? `<meta property="og:image" content="${esc(card.imageUrl)}" />` : ''}
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="${card.imageUrl ? 'summary_large_image' : 'summary'}" />` : ''
  const body = card ? `
    <div class="card">
      ${card.imageUrl ? `<img class="hero" src="${esc(card.imageUrl)}" alt="" />` : `<div class="hero hero-fallback">🌿</div>`}
      <div class="body">
        <p class="kicker">${esc(card.author)} ${esc(card.kindLabel)}</p>
        ${card.caption ? `<p class="caption">${esc(card.caption)}</p>` : ''}
        <p class="when">${esc(String(card.when || '').slice(0, 10))}</p>
      </div>
    </div>` : `
    <div class="card"><div class="hero hero-fallback">🌿</div><div class="body"><p class="caption">${esc(message)}</p></div></div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>${og}
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #FFFBF0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 420px; background: #fff; border-radius: 24px; overflow: hidden; box-shadow: 0 12px 40px rgba(76, 29, 149, .12); border: 1px solid #E8DEC9; }
  .hero { width: 100%; max-height: 320px; object-fit: cover; display: block; }
  .hero-fallback { display: flex; align-items: center; justify-content: center; font-size: 56px; background: linear-gradient(135deg, #EDE9FE, #FEF3C7); height: 140px; }
  .body { padding: 20px; }
  .kicker { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #7C3AED; margin-bottom: 8px; }
  .caption { font-size: 16px; line-height: 1.5; color: #1c1917; white-space: pre-wrap; word-break: break-word; }
  .when { margin-top: 10px; font-size: 12px; color: #8B8175; }
  .brand { margin-top: 24px; text-align: center; }
  .brand h1 { font-size: 15px; color: #4c1d95; letter-spacing: .12em; }
  .brand p { font-size: 12px; color: #8B8175; margin-top: 4px; }
  .cta { display: inline-block; margin-top: 16px; background: linear-gradient(135deg, #7C3AED, #DB2777); color: #fff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 999px; box-shadow: 0 8px 20px rgba(124, 58, 237, .35); }
  .footer { margin-top: 28px; font-size: 11px; color: #B8AE9E; }
</style>
</head>
<body>
  ${body}
  <div class="brand">
    <h1>HARVEST FAMILY · NYERI</h1>
    <p>Compel · Raise · Release</p>
    <a class="cta" href="${APK_URL}">📲 Get the app</a>
  </div>
  <p class="footer">${esc(BRAND)}</p>
</body>
</html>`
}

function html(body) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
