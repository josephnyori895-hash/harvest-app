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
  // JSON object keyed by fund id; purpose-specific payment instructions (no secrets).
  giving_payment_methods: 12000,
  // JSON array of quick-amount integers, e.g. [100,200,500]
  giving_quick: 200,
  // JSON array: [{ id, title, body, cta_url, image_url?, enabled?, audience? }] (max 20 ads)
  sponsor_adverts: 20000,
  // JSON object: { placement: 'feed'|'none', interval: 3-20, daily_cap: 1-10 }
  advert_settings: 400,
}

function isAbsoluteUrl(value, required) {
  if (value === undefined || value === null) return !required
  return typeof value === 'string' && /^https?:\/\/\S{1,500}$/.test(value)
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
    return jsonResponse({ content: out }, 200, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
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
    if ('sponsor_adverts' in body) {
      try {
        const adverts = JSON.parse(String(body.sponsor_adverts || '[]'))
        if (!Array.isArray(adverts) || adverts.length > 20) return errorResponse('sponsor_adverts: expected an array with at most 20 adverts', 400)
        const seen = new Set()
        for (const ad of adverts) {
          if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return errorResponse('sponsor_adverts: each advert must be an object', 400)
          if (!/^[a-z0-9_-]{1,40}$/.test(String(ad.id || ''))) return errorResponse('sponsor_adverts: advert id must be [a-z0-9_-]{1,40}', 400)
          if (seen.has(String(ad.id))) return errorResponse('sponsor_adverts: duplicate advert id', 400)
          seen.add(String(ad.id))
          if (typeof ad.title !== 'string' || !ad.title.trim() || ad.title.length > 80) return errorResponse('sponsor_adverts: title required (max 80 chars)', 400)
          if (typeof ad.body !== 'string' || ad.body.length > 400) return errorResponse('sponsor_adverts: body max 400 chars', 400)
          for (const urlField of ['cta_url', 'image_url']) {
            if (!isAbsoluteUrl(ad[urlField], urlField === 'cta_url')) return errorResponse(`sponsor_adverts: ${urlField} must be an http(s) URL`, 400)
          }
          if (ad.enabled !== undefined && typeof ad.enabled !== 'boolean') return errorResponse('sponsor_adverts: enabled must be boolean', 400)
          if (!['all', 'members'].includes(String(ad.audience || 'all'))) return errorResponse("sponsor_adverts: audience must be 'all' or 'members'", 400)
        }
      } catch { return errorResponse('sponsor_adverts must be valid JSON', 400) }
    }
    if ('advert_settings' in body) {
      try {
        const settings = JSON.parse(String(body.advert_settings || '{}'))
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return errorResponse('advert_settings: expected an object', 400)
        if (!['feed', 'none'].includes(String(settings.placement || 'feed'))) return errorResponse("advert_settings: placement must be 'feed' or 'none'", 400)
        const interval = Number(settings.interval ?? 6)
        if (!Number.isInteger(interval) || interval < 3 || interval > 20) return errorResponse('advert_settings: interval must be an integer (3-20)', 400)
        const cap = Number(settings.daily_cap ?? 2)
        if (!Number.isInteger(cap) || cap < 1 || cap > 10) return errorResponse('advert_settings: daily_cap must be an integer (1-10)', 400)
      } catch { return errorResponse('advert_settings must be valid JSON', 400) }
    }
    if ('giving_payment_methods' in body) {
      try {
        const configs = JSON.parse(String(body.giving_payment_methods || '{}'))
        const methods = new Set(['stk', 'paybill', 'till', 'bank', 'manual'])
        if (!configs || typeof configs !== 'object' || Array.isArray(configs) || Object.keys(configs).length > 12) return errorResponse('giving_payment_methods: expected an object with at most 12 purposes', 400)
        for (const [id, cfg] of Object.entries(configs)) {
          if (!/^[a-z0-9_-]{1,40}$/.test(id) || !cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return errorResponse('giving_payment_methods: invalid purpose configuration', 400)
          if (!methods.has(String(cfg.method || 'stk'))) return errorResponse('giving_payment_methods: unsupported payment method', 400)
          if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') return errorResponse('giving_payment_methods: enabled must be boolean', 400)
          for (const field of ['instructions', 'payment_number', 'account_reference', 'bank_name', 'bank_account_name', 'bank_account_number']) {
            if (cfg[field] !== undefined && (typeof cfg[field] !== 'string' || cfg[field].length > 1000)) return errorResponse(`giving_payment_methods: invalid ${field}`, 400)
          }
          if (['paybill', 'till'].includes(cfg.method) && !String(cfg.payment_number || '').trim()) return errorResponse('giving_payment_methods: Paybill/Till number is required', 400)
          if (cfg.method === 'bank' && (!String(cfg.bank_name || '').trim() || !String(cfg.bank_account_name || '').trim() || !String(cfg.bank_account_number || '').trim())) return errorResponse('giving_payment_methods: bank name, account name and account number are required', 400)
        }
      } catch { return errorResponse('giving_payment_methods must be valid JSON', 400) }
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
