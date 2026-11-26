// Central publishing calendar.
//
// One publication record owns the draft/schedule/expiry lifecycle. Published
// content still lives in its existing home: announcements and feed posts in
// `posts`, sermons in `sermons`, banners in `site_content`, events in `events`
// and ministry updates in `ministry_updates`. `target_id` is stable, so a
// retried publish can only create the same row once.
import { query, uuid } from '../lib/db.js'
import { requireAdmin, requireMember } from '../lib/auth.js'
import { jsonResponse, errorResponse, readJson } from '../lib/http.js'
import { mediaUrlOrNull } from '../lib/media.js'

const API_TIMEZONE = 'Africa/Nairobi'
const TYPES = new Set(['announcement', 'sermon', 'banner', 'event', 'ministry_update', 'feed_post'])
const BANNER_KEYS = ['hero_kicker', 'hero_title', 'hero_subtitle', 'verse_text', 'verse_ref', 'announcement_banner']
const BANNER_LIMITS = { hero_kicker: 120, hero_title: 120, hero_subtitle: 300, verse_text: 300, verse_ref: 120, announcement_banner: 400 }

function clean(v, max) {
  return String(v ?? '').trim().slice(0, max)
}

function validIso(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null
}

function parsePayload(raw) {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

function titleFrom(type, body, payload) {
  const explicit = clean(body.title, 140)
  if (explicit) return explicit
  if (type === 'announcement' || type === 'feed_post') return clean(payload.caption, 70) || 'Untitled post'
  if (type === 'banner') return clean(payload.content?.hero_title, 80) || 'Homepage banner'
  if (type === 'event') return clean(payload.title, 100) || 'Untitled event'
  if (type === 'ministry_update') return clean(payload.title, 100) || 'Ministry update'
  if (type === 'sermon') return clean(payload.title, 100) || 'Untitled sermon'
  return 'Untitled publication'
}

function normalizePayload(type, body) {
  const value = body.payload && typeof body.payload === 'object' ? body.payload : {}
  if (type === 'announcement' || type === 'feed_post') {
    const caption = clean(value.caption ?? body.caption ?? body.body, 2000)
    if (caption.length < 2) return { error: 'Write the post before saving it.' }
    return { payload: { caption } }
  }
  if (type === 'banner') {
    const source = value.content && typeof value.content === 'object' ? value.content : value
    const content = {}
    for (const key of BANNER_KEYS) {
      if (source[key] === undefined || source[key] === null || String(source[key]).trim() === '') continue
      const text = clean(source[key], BANNER_LIMITS[key])
      if (!text) continue
      content[key] = text
    }
    if (!Object.keys(content).length) return { error: 'Add at least one banner field.' }
    return { payload: { content } }
  }
  if (type === 'event') {
    const title = clean(value.title ?? body.title, 120)
    const bodyText = clean(value.body ?? body.body, 2000)
    const location = clean(value.location ?? body.location, 160)
    const startsAt = value.starts_at ?? body.starts_at
    const endsAt = value.ends_at ?? body.ends_at
    if (title.length < 2) return { error: 'Event title is required.' }
    if (!validIso(startsAt)) return { error: 'Choose when the event starts.' }
    if (endsAt && !validIso(endsAt)) return { error: 'Choose a valid event end time.' }
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) return { error: 'The event cannot end before it starts.' }
    return { payload: { title, body: bodyText, location: location || null, starts_at: isoOrNull(startsAt), ends_at: isoOrNull(endsAt) } }
  }
  if (type === 'ministry_update') {
    const departmentSlug = clean(value.department_slug ?? body.department_slug, 80)
    const title = clean(value.title ?? body.title, 120)
    const bodyText = clean(value.body ?? body.body, 2000)
    if (!departmentSlug) return { error: 'Choose the ministry this update belongs to.' }
    if (title.length < 2) return { error: 'Ministry update title is required.' }
    if (bodyText.length < 2) return { error: 'Write the ministry update.' }
    return { payload: { department_slug: departmentSlug, title, body: bodyText } }
  }
  if (type === 'sermon') {
    const title = clean(value.title ?? body.title, 200)
    const mediaKey = clean(value.media_key ?? body.media_key, 300)
    const kind = String(value.kind ?? body.kind) === 'video' ? 'video' : 'audio'
    if (title.length < 2) return { error: 'Sermon title is required.' }
    if (!mediaKey) return { error: 'Upload the sermon file first.' }
    return {
      payload: {
        title,
        speaker: clean(value.speaker ?? body.speaker, 200) || null,
        scripture: clean(value.scripture ?? body.scripture, 200) || null,
        description: clean(value.description ?? body.description, 1000) || null,
        kind,
        media_key: mediaKey,
        cover_key: clean(value.cover_key ?? body.cover_key, 300) || null,
        duration_secs: Number(value.duration_secs ?? body.duration_secs) || null,
        bytes: Number(value.bytes ?? body.bytes) || null,
      },
    }
  }
  return { error: 'unknown content type' }
}

async function recordHistory(env, publicationId, action, actor, meta = null) {
  await query(
    env,
    'INSERT INTO content_publication_history (id, publication_id, action, actor, at, meta) VALUES (?,?,?,?,?,?)',
    [uuid(), publicationId, action, actor || null, new Date().toISOString(), meta ? JSON.stringify(meta) : null],
  ).catch(() => {})
}

async function audit(env, actor, action, id, meta = {}) {
  await query(
    env,
    `INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta, created_at)
     VALUES (?,?,?,'publication',?,?,?)`,
    [actor?.id || null, actor?.role || 'admin', action, id, JSON.stringify(meta), new Date().toISOString()],
  ).catch(() => {})
}

async function creatorId(env, username) {
  const r = await query(env, 'SELECT id, name FROM users WHERE username=?', [username])
  return r.rows[0] || null
}

async function applyBanner(env, pub, payload) {
  const keys = Object.keys(payload.content || {})
  if (!keys.length) throw new Error('banner has no content')
  // A retry can reach this after the first apply landed but before the status
  // update. Keep the original snapshot instead of snapshotting our own banner.
  let previous = payload.previous || {}
  if (!Object.keys(previous).length) {
    const marks = keys.map(() => '?').join(',')
    const before = await query(env, `SELECT key, value FROM site_content WHERE key IN (${marks})`, keys)
    previous = {}
    for (const row of before.rows) previous[row.key] = row.value
  }
  for (const key of keys) {
    await query(
      env,
      `INSERT INTO site_content (key, value, updated_by) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=excluded.updated_by`,
      [key, payload.content[key], pub.created_by],
    )
  }
  // Keep the values this banner replaced so expiry can restore the previous
  // banner instead of leaving the homepage half-edited.
  const next = { ...payload, previous }
  await query(env, 'UPDATE content_publications SET payload=?, updated_at=? WHERE id=?', [JSON.stringify(next), new Date().toISOString(), pub.id])
}

async function insertPublishedContent(env, pub, payload) {
  if (pub.content_type === 'announcement' || pub.content_type === 'feed_post') {
    const creator = await creatorId(env, pub.created_by)
    if (!creator) throw new Error('publisher account no longer exists')
    await query(
      env,
      `INSERT OR IGNORE INTO posts (id, user_id, caption, verified_snapshot, group_name, constituency, faith, approved_at, created_at, expires_at)
       VALUES (?,?,?,1,NULL,NULL,NULL,?,?,?)`,
      [pub.target_id, creator.id, payload.caption, pub.published_at, pub.published_at, pub.expires_at],
    )
    return pub.target_id
  }
  if (pub.content_type === 'sermon') {
    const creator = await creatorId(env, pub.created_by)
    if (!creator) throw new Error('publisher account no longer exists')
    await query(
      env,
      `INSERT OR IGNORE INTO sermons (id, user_id, title, speaker, scripture, description, kind, media_key, cover_key, duration_secs, bytes, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pub.target_id, creator.id, payload.title, payload.speaker, payload.scripture, payload.description,
        payload.kind === 'video' ? 'video' : 'audio', payload.media_key, payload.cover_key,
        payload.duration_secs, payload.bytes, pub.published_at, pub.expires_at,
      ],
    )
    return pub.target_id
  }
  if (pub.content_type === 'banner') {
    await applyBanner(env, pub, payload)
    return pub.id
  }
  if (pub.content_type === 'event') {
    await query(
      env,
      `INSERT OR IGNORE INTO events (id, title, body, location, starts_at, ends_at, publication_id, created_by, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [pub.target_id, payload.title, payload.body, payload.location, payload.starts_at, payload.ends_at, pub.id, pub.created_by, pub.published_at, pub.expires_at],
    )
    return pub.target_id
  }
  if (pub.content_type === 'ministry_update') {
    await query(
      env,
      `INSERT OR IGNORE INTO ministry_updates (id, department_slug, title, body, publication_id, created_by, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [pub.target_id, payload.department_slug, payload.title, payload.body, pub.id, pub.created_by, pub.published_at, pub.expires_at],
    )
    return pub.target_id
  }
  throw new Error('unsupported content type')
}

export async function publishPublication(env, id, actor = null, { force = false } = {}) {
  const { rows } = await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])
  const pub = rows[0]
  if (!pub) throw new Error('publication not found')
  if (pub.status === 'published') return { publication: pub, already: true }
  if (pub.status === 'canceled') throw new Error('canceled content cannot be published')
  if (pub.status === 'expired') throw new Error('expired content cannot be published')
  const scheduled = pub.scheduled_at && Date.parse(pub.scheduled_at) > Date.now()
  if (!force && scheduled) throw new Error('this publication is still scheduled for later')
  const publishedAt = new Date().toISOString()
  const next = { ...pub, published_at: publishedAt, target_id: pub.target_id || uuid() }
  const payload = parsePayload(pub.payload)
  try {
    await insertPublishedContent(env, next, payload)
    const update = await query(
      env,
      `UPDATE content_publications
          SET status='published', published_at=?, target_id=?, last_error=NULL, attempts=attempts+1, updated_at=?
        WHERE id=? AND status IN ('draft','scheduled')`,
      [publishedAt, next.target_id, publishedAt, id],
    )
    if (!update.meta?.changes) {
      const current = await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])
      if (current.rows[0]?.status === 'published') return { publication: current.rows[0], already: true }
    }
    await recordHistory(env, id, 'published', actor?.username || pub.created_by, { target_id: next.target_id })
    await audit(env, actor, 'publication_published', id, { type: pub.content_type })
    const fresh = await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])
    return { publication: fresh.rows[0] || next, already: false }
  } catch (e) {
    await query(
      env,
      'UPDATE content_publications SET last_error=?, attempts=attempts+1, updated_at=? WHERE id=?',
      [String(e?.message || e).slice(0, 500), publishedAt, id],
    ).catch(() => {})
    throw e
  }
}

async function expireBanner(env, pub) {
  const payload = parsePayload(pub.payload)
  const previous = payload.previous || {}
  const keys = Object.keys(previous)
  if (!keys.length) return
  // Only restore if no newer banner publication is still live. This prevents an
  // older banner's expiry undoing a banner that was published after it.
  const newer = await query(
    env,
    `SELECT id FROM content_publications
      WHERE content_type='banner' AND status='published' AND published_at > ?
      ORDER BY published_at DESC LIMIT 1`,
    [pub.published_at],
  )
  if (newer.rows[0]) return
  for (const [key, value] of Object.entries(previous)) {
    await query(
      env,
      `INSERT INTO site_content (key, value, updated_by) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=excluded.updated_by`,
      [key, value, pub.created_by],
    ).catch(() => {})
  }
}

export async function runPublishingSweep(env) {
  const now = new Date().toISOString()
  let expired = 0
  let published = 0
  const dueExpiry = await query(
    env,
    `SELECT * FROM content_publications
      WHERE status='published' AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at ASC LIMIT 100`,
    [now],
  ).catch(() => ({ rows: [] }))
  for (const pub of dueExpiry.rows) {
    const done = await query(
      env,
      `UPDATE content_publications SET status='expired', expired_at=?, updated_at=?
        WHERE id=? AND status='published'`,
      [now, now, pub.id],
    ).catch(() => ({ meta: {} }))
    if (!done.meta?.changes) continue
    // The canonical row keeps its history but stops being visible. Each read
    // path already filters `expires_at`, so this also covers a scheduled row
    // whose expiry was changed after publication.
    if (pub.content_type === 'announcement' || pub.content_type === 'feed_post') {
      await query(env, 'UPDATE posts SET expires_at=? WHERE id=?', [pub.expires_at, pub.target_id]).catch(() => {})
    } else if (pub.content_type === 'sermon') {
      await query(env, 'UPDATE sermons SET expires_at=? WHERE id=?', [pub.expires_at, pub.target_id]).catch(() => {})
    } else if (pub.content_type === 'event') {
      await query(env, 'UPDATE events SET expires_at=? WHERE id=?', [pub.expires_at, pub.target_id]).catch(() => {})
    } else if (pub.content_type === 'ministry_update') {
      await query(env, 'UPDATE ministry_updates SET expires_at=? WHERE id=?', [pub.expires_at, pub.target_id]).catch(() => {})
    } else if (pub.content_type === 'banner') await expireBanner(env, pub).catch(() => {})
    await recordHistory(env, pub.id, 'expired', 'system', null)
    expired += 1
  }
  const due = await query(
    env,
    `SELECT id FROM content_publications
      WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
      ORDER BY scheduled_at ASC LIMIT 50`,
    [now],
  ).catch(() => ({ rows: [] }))
  for (const row of due.rows) {
    try {
      await publishPublication(env, row.id, null, { force: true })
      published += 1
    } catch (e) {
      console.error('[publishing] retry', row.id, e?.message)
    }
  }
  return { published, expired }
}

export async function createSermonPublication(env, fresh, payload, { publishAt, expiresAt, sourceKey } = {}) {
  const at = validIso(publishAt) ? new Date(publishAt).toISOString() : null
  if (!at) return null
  const existing = sourceKey
    ? await query(env, 'SELECT * FROM content_publications WHERE source_key=?', [sourceKey])
    : { rows: [] }
  if (existing.rows[0]) return existing.rows[0]
  const id = uuid()
  const now = new Date().toISOString()
  const exp = validIso(expiresAt) ? new Date(expiresAt).toISOString() : null
  const title = titleFrom('sermon', {}, payload)
  await query(
    env,
    `INSERT INTO content_publications
      (id, content_type, title, status, payload, scheduled_at, expires_at, target_id, source_key, created_by, created_by_name, created_at, updated_at)
     VALUES (?,?,?,'scheduled',?,?,?,?,?,?,?,?,?)`,
    [id, 'sermon', title, JSON.stringify(payload), at, exp, uuid(), sourceKey || null, fresh.username, fresh.name || fresh.username, now, now],
  )
  await recordHistory(env, id, 'scheduled', fresh.username, { scheduled_at: at })
  await audit(env, fresh, 'publication_scheduled', id, { type: 'sermon', scheduled_at: at })
  return (await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])).rows[0]
}

function publicPublication(row, previewUrl = null) {
  return {
    id: row.id,
    content_type: row.content_type,
    title: row.title,
    status: row.status,
    payload: parsePayload(row.payload),
    scheduled_at: row.scheduled_at,
    expires_at: row.expires_at,
    published_at: row.published_at,
    expired_at: row.expired_at,
    canceled_at: row.canceled_at,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_error: row.last_error,
    attempts: Number(row.attempts) || 0,
    target_id: row.target_id,
    preview_url: previewUrl,
  }
}

export async function handlePublishing(request, env, ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  const user = ctx.user

  // Public-ish member event list for the app. Expired events disappear even if
  // the calendar history still remembers them.
  if (path === '/api/events' && method === 'GET') {
    await requireMember(env, user)
    const now = new Date().toISOString()
    const { rows } = await query(
      env,
      `SELECT id, title, body, location, starts_at, ends_at, created_at
         FROM events
        WHERE starts_at >= ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY starts_at ASC LIMIT 50`,
      [now, now],
    )
    return jsonResponse({ events: rows, timezone: API_TIMEZONE })
  }

  const departmentUpdates = path.match(/^\/api\/departments\/([^/]+)\/updates$/)
  if (departmentUpdates && method === 'GET') {
    await requireMember(env, user)
    const now = new Date().toISOString()
    const { rows } = await query(
      env,
      `SELECT id, department_slug, title, body, created_at, expires_at
         FROM ministry_updates
        WHERE department_slug=? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC LIMIT 20`,
      [decodeURIComponent(departmentUpdates[1]), now],
    )
    return jsonResponse({ updates: rows })
  }

  const detail = path.match(/^\/api\/admin\/publishing\/([0-9a-f-]+)$/i)
  const action = path.match(/^\/api\/admin\/publishing\/([0-9a-f-]+)\/(publish|cancel|history)$/i)

  if (path === '/api/admin/publishing' && method === 'GET') {
    await requireAdmin(env, user)
    await runPublishingSweep(env).catch(() => {})
    const status = String(url.searchParams.get('status') || '').trim()
    const where = ['draft', 'scheduled', 'published', 'expired', 'canceled'].includes(status) ? 'WHERE status=?' : ''
    const { rows } = await query(
      env,
      `SELECT * FROM content_publications ${where}
        ORDER BY COALESCE(
          CASE status
            WHEN 'published' THEN published_at
            WHEN 'expired' THEN expired_at
            WHEN 'canceled' THEN canceled_at
            ELSE scheduled_at
          END,
          created_at
        ) DESC LIMIT 300`,
      where ? [status] : [],
    )
    const out = []
    for (const row of rows) {
      let previewUrl = null
      if (row.content_type === 'sermon') {
        const p = parsePayload(row.payload)
        previewUrl = p.media_key ? await mediaUrlOrNull(env, p.media_key, 1800) : null
      }
      out.push(publicPublication(row, previewUrl))
    }
    return jsonResponse({
      publications: out,
      timezone: API_TIMEZONE,
      now: new Date().toISOString(),
      states: ['draft', 'scheduled', 'published', 'expired', 'canceled'],
      types: ['announcement', 'sermon', 'banner', 'event', 'ministry_update', 'feed_post'],
    })
  }

  if (path === '/api/admin/publishing' && method === 'POST') {
    const fresh = await requireAdmin(env, user)
    const body = await readJson(request)
    const type = String(body.content_type || '')
    if (!TYPES.has(type)) return errorResponse('Choose what kind of content this is.', 400)
    const normalized = normalizePayload(type, body)
    if (normalized.error) return errorResponse(normalized.error, 400)
    const now = new Date().toISOString()
    const publishNow = body.publish_now === true
    const scheduledAt = body.scheduled_at ? isoOrNull(body.scheduled_at) : null
    const expiresAt = body.expires_at ? isoOrNull(body.expires_at) : null
    if (body.scheduled_at && !validIso(body.scheduled_at)) return errorResponse('Choose a valid publish time.', 400)
    if (body.expires_at && !validIso(body.expires_at)) return errorResponse('Choose a valid expiry time.', 400)
    if (scheduledAt && !publishNow && Date.parse(scheduledAt) <= Date.now()) return errorResponse('Scheduled time must be in the future.', 400)
    const publishAt = publishNow ? now : scheduledAt
    if (expiresAt && Date.parse(expiresAt) <= Date.parse(publishAt || now)) return errorResponse('Expiry must be after the publish time.', 400)
    const title = titleFrom(type, body, normalized.payload)
    const id = uuid()
    const status = publishNow ? 'draft' : scheduledAt ? 'scheduled' : 'draft'
    await query(
      env,
      `INSERT INTO content_publications
        (id, content_type, title, status, payload, scheduled_at, expires_at, target_id, created_by, created_by_name, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, type, title, status, JSON.stringify(normalized.payload), scheduledAt, expiresAt,
        uuid(), fresh.username, fresh.name || fresh.username, now, now,
      ],
    )
    await recordHistory(env, id, scheduledAt ? 'scheduled' : 'draft_created', fresh.username, { scheduled_at: scheduledAt })
    if (publishNow) {
      await publishPublication(env, id, fresh, { force: true })
    }
    const row = (await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])).rows[0]
    return jsonResponse({ publication: publicPublication(row), timezone: API_TIMEZONE }, 201)
  }

  if (detail && method === 'PATCH') {
    const fresh = await requireAdmin(env, user)
    const body = await readJson(request)
    const { rows } = await query(env, 'SELECT * FROM content_publications WHERE id=?', [detail[1]])
    const pub = rows[0]
    if (!pub) return errorResponse('publication not found', 404)
    if (!['draft', 'scheduled'].includes(pub.status)) return errorResponse('Only drafts and scheduled content can be edited.', 409)
    const normalized = normalizePayload(pub.content_type, body)
    if (normalized.error) return errorResponse(normalized.error, 400)
    const now = new Date().toISOString()
    const scheduledAt = body.scheduled_at !== undefined ? isoOrNull(body.scheduled_at) : pub.scheduled_at
    const expiresAt = body.expires_at !== undefined ? isoOrNull(body.expires_at) : pub.expires_at
    if (body.scheduled_at && !validIso(body.scheduled_at)) return errorResponse('Choose a valid publish time.', 400)
    if (body.expires_at && !validIso(body.expires_at)) return errorResponse('Choose a valid expiry time.', 400)
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) return errorResponse('Scheduled time must be in the future.', 400)
    if (expiresAt && Date.parse(expiresAt) <= Date.parse(scheduledAt || now)) return errorResponse('Expiry must be after publication.', 400)
    const title = titleFrom(pub.content_type, body, normalized.payload) || pub.title
    const status = scheduledAt ? 'scheduled' : 'draft'
    const r = await query(
      env,
      `UPDATE content_publications
          SET title=?, payload=?, scheduled_at=?, expires_at=?, status=?, updated_at=?
        WHERE id=? AND status IN ('draft','scheduled')`,
      [title, JSON.stringify(normalized.payload), scheduledAt, expiresAt, status, now, pub.id],
    )
    if (!r.meta?.changes) return errorResponse('publication changed elsewhere — reload and try again', 409)
    await recordHistory(env, pub.id, scheduledAt ? 'edited_scheduled' : 'edited_draft', fresh.username, { scheduled_at: scheduledAt })
    const freshRow = (await query(env, 'SELECT * FROM content_publications WHERE id=?', [pub.id])).rows[0]
    return jsonResponse({ publication: publicPublication(freshRow), timezone: API_TIMEZONE })
  }

  if (action) {
    const fresh = await requireAdmin(env, user)
    const id = action[1]
    const verb = action[2]
    if (verb === 'history') {
      const pub = await query(env, 'SELECT id FROM content_publications WHERE id=?', [id])
      if (!pub.rows[0]) return errorResponse('publication not found', 404)
      const history = await query(env, 'SELECT * FROM content_publication_history WHERE publication_id=? ORDER BY at ASC', [id])
      return jsonResponse({ history: history.rows, timezone: API_TIMEZONE })
    }
    if (verb === 'publish') {
      const result = await publishPublication(env, id, fresh, { force: true })
      return jsonResponse({ publication: publicPublication(result.publication), already: result.already, timezone: API_TIMEZONE })
    }
    if (verb === 'cancel') {
      const now = new Date().toISOString()
      const { rows } = await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])
      const pub = rows[0]
      if (!pub) return errorResponse('publication not found', 404)
      if (!['draft', 'scheduled'].includes(pub.status)) return errorResponse('Only unscheduled or draft content can be canceled.', 409)
      await query(
        env,
        `UPDATE content_publications SET status='canceled', canceled_at=?, updated_at=? WHERE id=? AND status IN ('draft','scheduled')`,
        [now, now, id],
      )
      await recordHistory(env, id, 'canceled', fresh.username, null)
      await audit(env, fresh, 'publication_canceled', id, { type: pub.content_type })
      const freshRow = (await query(env, 'SELECT * FROM content_publications WHERE id=?', [id])).rows[0]
      return jsonResponse({ publication: publicPublication(freshRow), timezone: API_TIMEZONE })
    }
  }

  return null
}
