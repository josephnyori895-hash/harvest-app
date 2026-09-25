// Public site content (admin-editable home-screen text).
// GET /api/content — public, no auth (home feed renders before login).
// PUT /api/content — admin only. Body: { key: value, ... } (max 20 keys per call).
import { query } from '../lib/db.js'
import { requireAdmin } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'

// Keys the admin may edit — anything else is rejected so this can't become a
// dumping ground. Values are plain display text unless noted as JSON.
const EDITABLE = {
  hero_kicker: 120,
  hero_title: 120,
  hero_subtitle: 300,
  verse_text: 300,
  verse_ref: 120,
  // ── Pray with Pastor card ──
  // The username of the account the 'Pray with Pastor' card opens as a DM.
  // Empty/unset = the card tells members the pastor has not joined yet.
  pastor_username: 60,
  pastor_usernames: 600,
  // ── Give section ──
  giving_title: 120,
  giving_subtitle: 300,
  paybill_number: 20,
  paybill_name: 120,
  // JSON array: [{ id, label, sub, icon }] (max 12 funds)
  giving_funds: 4000,
  // JSON array of quick-amount integers, e.g. [100,200,500]
  giving_quick: 200,
}

function readAll(env) {
  return query(env, 'SELECT key, value FROM site_content')
}

export async function handleContent(request, env, ctx) {
  const path = new URL(request.url).pathname

  if (path === '/api/content' && request.method === 'GET') {
    const { rows } = await readAll(env)
    const out = {}
    for (const r of rows) out[r.key] = r.value
    return jsonResponse({ content: out })
  }

  if (path === '/api/content' && request.method === 'PUT') {
    const fresh = await requireAdmin(env, ctx.user)
    const body = await readJson(request)
    const entries = Object.entries(body || {}).filter(([k]) => k in EDITABLE)
    if (!entries.length) return errorResponse('no editable keys provided', 400)
    if (entries.length > 20) return errorResponse('too many keys (max 20)', 400)
    // JSON-typed keys are validated here so a bad save can never break the app.
    if ('giving_funds' in body) {
      try {
        const funds = JSON.parse(String(body.giving_funds || '[]'))
        if (!Array.isArray(funds) || funds.length > 12) return errorResponse('giving_funds: max 12 funds', 400)
        for (const f of funds) {
          if (!f || typeof f.id !== 'string' || typeof f.label !== 'string' || !f.label.trim()) return errorResponse('giving_funds: each fund needs id and label', 400)
        }
      } catch { return errorResponse('giving_funds must be valid JSON', 400) }
    }
    if ('giving_quick' in body) {
      try {
        const q = JSON.parse(String(body.giving_quick || '[]'))
        if (!Array.isArray(q) || q.length > 12 || q.some(n => !Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 1000000)) return errorResponse('giving_quick: up to 12 whole amounts between 1 and 1000000', 400)
      } catch { return errorResponse('giving_quick must be a JSON array of numbers', 400) }
    }
    for (const [k, v] of entries) {
      const value = String(v ?? '').trim().slice(0, EDITABLE[k])
      await query(
        env,
        `INSERT INTO site_content (key, value, updated_by) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=excluded.updated_by`,
        [k, value, fresh.username],
      )
    }
    const { rows } = await readAll(env)
    const out = {}
    for (const r of rows) out[r.key] = r.value
    return jsonResponse({ ok: true, content: out })
  }

  return null
}
