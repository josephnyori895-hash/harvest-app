import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui'
import { showToast } from './Toast'
import ErrorMessage from './ErrorMessage'
import { formatNairobi, nairobiDay, nairobiDayLabel, nairobiInput, nairobiIso } from '../lib/nairobiTime'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const token = () => localStorage.getItem('harvest_token') || ''
const auth = () => ({ Authorization: `Bearer ${token()}` })

const TYPE_LABEL: Record<string, string> = {
  announcement: 'Announcement',
  sermon: 'Sermon',
  banner: 'Homepage banner',
  event: 'Event',
  ministry_update: 'Ministry update',
  feed_post: 'Feed post',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  expired: 'Expired',
  canceled: 'Canceled',
}
const STATUS_TONE: Record<string, string> = {
  draft: 'bg-surface-sunken text-ink-muted border-line',
  scheduled: 'bg-accent-soft text-accent-strong border-accent/20',
  published: 'bg-success-soft text-success border-success/20',
  expired: 'bg-surface-sunken text-ink-subtle border-line',
  canceled: 'bg-danger-soft text-danger border-danger/20',
}

type Publication = {
  id: string
  content_type: string
  title: string
  status: string
  payload: any
  scheduled_at?: string | null
  expires_at?: string | null
  published_at?: string | null
  expired_at?: string | null
  canceled_at?: string | null
  created_by: string
  created_by_name?: string | null
  created_at: string
  updated_at: string
  last_error?: string | null
  attempts?: number
  preview_url?: string | null
}

type Form = {
  id: string
  type: string
  title: string
  scheduledAt: string
  expiresAt: string
  caption: string
  heroKicker: string
  heroTitle: string
  heroSubtitle: string
  verseText: string
  verseRef: string
  eventBody: string
  eventLocation: string
  eventStarts: string
  eventEnds: string
  departmentSlug: string
  ministryBody: string
  speaker: string
  scripture: string
  description: string
  sermonMediaKey: string
  sermonKind: string
  sermonCoverKey: string
  sermonDuration: number | null
  sermonBytes: number | null
}

const EMPTY: Form = {
  id: '', type: 'announcement', title: '', scheduledAt: '', expiresAt: '', caption: '',
  heroKicker: '', heroTitle: '', heroSubtitle: '', verseText: '', verseRef: '',
  eventBody: '', eventLocation: '', eventStarts: '', eventEnds: '',
  departmentSlug: '', ministryBody: '', speaker: '', scripture: '', description: '',
  sermonMediaKey: '', sermonKind: 'audio', sermonCoverKey: '', sermonDuration: null, sermonBytes: null,
}

function formFor(p: Publication): Form {
  const x = p.payload || {}
  return {
    ...EMPTY,
    id: p.id,
    type: p.content_type,
    title: p.title || '',
    scheduledAt: nairobiInput(p.scheduled_at),
    expiresAt: nairobiInput(p.expires_at),
    caption: x.caption || '',
    heroKicker: x.content?.hero_kicker || '',
    heroTitle: x.content?.hero_title || '',
    heroSubtitle: x.content?.hero_subtitle || '',
    verseText: x.content?.verse_text || '',
    verseRef: x.content?.verse_ref || '',
    eventBody: x.body || '',
    eventLocation: x.location || '',
    eventStarts: nairobiInput(x.starts_at),
    eventEnds: nairobiInput(x.ends_at),
    departmentSlug: x.department_slug || '',
    ministryBody: x.body || '',
    speaker: x.speaker || '',
    scripture: x.scripture || '',
    description: x.description || '',
    sermonMediaKey: x.media_key || '',
    sermonKind: x.kind || 'audio',
    sermonCoverKey: x.cover_key || '',
    sermonDuration: x.duration_secs || null,
    sermonBytes: x.bytes || null,
  }
}

function payloadFor(f: Form) {
  if (f.type === 'announcement' || f.type === 'feed_post') return { caption: f.caption }
  if (f.type === 'banner') {
    const content: Record<string, string> = {}
    if (f.heroKicker.trim()) content.hero_kicker = f.heroKicker.trim()
    if (f.heroTitle.trim()) content.hero_title = f.heroTitle.trim()
    if (f.heroSubtitle.trim()) content.hero_subtitle = f.heroSubtitle.trim()
    if (f.verseText.trim()) content.verse_text = f.verseText.trim()
    if (f.verseRef.trim()) content.verse_ref = f.verseRef.trim()
    return { content }
  }
  if (f.type === 'event') {
    return {
      title: f.title,
      body: f.eventBody,
      location: f.eventLocation,
      starts_at: nairobiIso(f.eventStarts),
      ends_at: nairobiIso(f.eventEnds),
    }
  }
  if (f.type === 'ministry_update') return { department_slug: f.departmentSlug, title: f.title, body: f.ministryBody }
  if (f.type === 'sermon') return {
    title: f.title, speaker: f.speaker, scripture: f.scripture, description: f.description,
    media_key: f.sermonMediaKey, kind: f.sermonKind, cover_key: f.sermonCoverKey || null,
    duration_secs: f.sermonDuration, bytes: f.sermonBytes,
  }
  return {}
}

export default function PublishingCalendar() {
  const [pubs, setPubs] = useState<Publication[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'upcoming' | 'published' | 'expired' | 'all'>('upcoming')
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Publication | null>(null)
  const [previewForm, setPreviewForm] = useState(false)
  const [history, setHistory] = useState<Record<string, any[]>>({})
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pRes, dRes] = await Promise.all([
        fetch(`${API}/api/admin/publishing`, { headers: auth() }),
        fetch(`${API}/api/departments`, { headers: auth() }),
      ])
      const pData = await pRes.json().catch(() => ({}))
      if (!pRes.ok) throw new Error(pData.error || 'Could not load the publishing calendar')
      setPubs(Array.isArray(pData.publications) ? pData.publications : [])
      if (dRes.ok) {
        const dData = await dRes.json().catch(() => ({}))
        setDepartments(Array.isArray(dData.departments) ? dData.departments : [])
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load the publishing calendar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('harvest:sermons-updated' as any, refresh)
    return () => window.removeEventListener('harvest:sermons-updated' as any, refresh)
  }, [load])

  const visible = useMemo(() => {
    const rows = pubs.filter(p => {
      if (filter === 'all') return true
      if (filter === 'upcoming') return p.status === 'draft' || p.status === 'scheduled'
      if (filter === 'published') return p.status === 'published'
      return p.status === 'expired' || p.status === 'canceled'
    })
    return rows.sort((a, b) => {
      const at = Date.parse(a.scheduled_at || a.published_at || a.created_at)
      const bt = Date.parse(b.scheduled_at || b.published_at || b.created_at)
      return filter === 'upcoming' ? at - bt : bt - at
    })
  }, [pubs, filter])

  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: Publication[] }[] = []
    for (const p of visible) {
      const stamp = p.scheduled_at || p.published_at || p.created_at
      const key = nairobiDay(stamp)
      let group = out.find(x => x.key === key)
      if (!group) { group = { key, label: nairobiDayLabel(stamp), rows: [] }; out.push(group) }
      group.rows.push(p)
    }
    return out
  }, [visible])

  const openNew = () => {
    setPreview(null)
    setPreviewForm(false)
    setForm({ ...EMPTY, scheduledAt: nairobiInput(new Date(Date.now() + 3600_000).toISOString()) })
  }

  const openEdit = (p: Publication) => {
    setPreview(null)
    setPreviewForm(false)
    setForm(formFor(p))
  }

  const previewDraft = () => {
    if (!form) return
    setPreview({
      id: 'draft', content_type: form.type, title: form.title || 'Untitled', status: 'draft',
      payload: payloadFor(form), scheduled_at: nairobiIso(form.scheduledAt), expires_at: nairobiIso(form.expiresAt),
      created_by: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      preview_url: null,
    })
    setPreviewForm(true)
  }

  const save = async (publishNow = false) => {
    if (!form || saving) return
    if (form.type === 'banner' && !form.heroKicker.trim() && !form.heroTitle.trim() && !form.heroSubtitle.trim() && !form.verseText.trim()) {
      showToast('Add at least one banner field.', 'error')
      return
    }
    if (form.type === 'event' && (!form.title.trim() || !nairobiIso(form.eventStarts))) {
      showToast('An event needs a title and start time.', 'error')
      return
    }
    if (form.type === 'ministry_update' && (!form.departmentSlug || !form.title.trim() || !form.ministryBody.trim())) {
      showToast('Choose a ministry and write the update.', 'error')
      return
    }
    if (form.type === 'sermon' && !form.id) {
      showToast('Upload the sermon file in Sermons and choose “Schedule for later” there.', 'info')
      return
    }
    setSaving(true)
    try {
      const body: any = {
        content_type: form.type,
        title: form.title,
        scheduled_at: nairobiIso(form.scheduledAt),
        expires_at: nairobiIso(form.expiresAt),
        payload: payloadFor(form),
      }
      if (!form.id) body.publish_now = publishNow
      let id = form.id
      if (!form.id) {
        const r = await fetch(`${API}/api/admin/publishing`, {
          method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not save the publication')
        id = d.publication?.id
      } else {
        const r = await fetch(`${API}/api/admin/publishing/${encodeURIComponent(form.id)}`, {
          method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not update the publication')
      }
      if (publishNow && id) {
        const r = await fetch(`${API}/api/admin/publishing/${encodeURIComponent(id)}/publish`, {
          method: 'POST', headers: auth(),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not publish now')
      }
      showToast(publishNow ? 'Published' : body.scheduled_at ? 'Scheduled' : 'Draft saved', 'success')
      setForm(null)
      setPreview(null)
      setPreviewForm(false)
      await load()
    } catch (e: any) {
      showToast(e?.message || 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const publishNow = async (p: Publication) => {
    setSaving(true)
    try {
      const r = await fetch(`${API}/api/admin/publishing/${encodeURIComponent(p.id)}/publish`, { method: 'POST', headers: auth() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not publish')
      showToast('Published', 'success')
      setPreview(null)
      setHistoryOpen(null)
      await load()
    } catch (e: any) { showToast(e?.message || 'Could not publish', 'error') } finally { setSaving(false) }
  }

  const cancel = async (p: Publication) => {
    if (cancelId !== p.id) { setCancelId(p.id); return }
    setSaving(true)
    try {
      const r = await fetch(`${API}/api/admin/publishing/${encodeURIComponent(p.id)}/cancel`, { method: 'POST', headers: auth() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not cancel')
      showToast('Scheduled publication canceled', 'success')
      setCancelId(null)
      await load()
    } catch (e: any) { showToast(e?.message || 'Could not cancel', 'error') } finally { setSaving(false) }
  }

  const toggleHistory = async (p: Publication) => {
    if (historyOpen === p.id) { setHistoryOpen(null); return }
    setHistoryOpen(p.id)
    if (history[p.id]) return
    try {
      const r = await fetch(`${API}/api/admin/publishing/${encodeURIComponent(p.id)}/history`, { headers: auth() })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setHistory(h => ({ ...h, [p.id]: Array.isArray(d.history) ? d.history : [] }))
    } catch { /* history is supplemental */ }
  }

  const set = (patch: Partial<Form>) => setForm(f => f ? { ...f, ...patch } : f)

  return (
    <div className="space-y-3" data-testid="admin-publishing">
      <div className="rounded-card border border-line bg-surface-raised p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-ink">Publishing calendar</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Draft, schedule, preview and expire church content. Times are Africa/Nairobi.</p>
          </div>
          <button type="button" onClick={openNew} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-2xs font-extrabold text-white">
            <Icon name="plus" size={14} /> New
          </button>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([['upcoming', 'Upcoming'], ['published', 'Published'], ['expired', 'Expired'], ['all', 'All']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={`min-h-10 shrink-0 rounded-full px-3 text-2xs font-extrabold ${filter === key ? 'bg-ink text-white' : 'border border-line bg-surface text-ink-muted'}`}>{label}</button>
          ))}
        </div>
      </div>

      {error && <ErrorMessage message={error} />}

      {form && (
        <div className="space-y-3 rounded-card border border-accent/30 bg-surface-raised p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold">{form.id ? 'Edit publication' : 'New publication'}</h3>
            <button type="button" onClick={() => { setForm(null); setPreview(null); setPreviewForm(false) }} className="min-h-10 rounded-full px-2 text-2xs font-bold text-ink-muted">Close</button>
          </div>
          <div>
            <label className="label-caps mb-1 block" htmlFor="pub-type">Content type</label>
            <select id="pub-type" value={form.type} disabled={!!form.id} onChange={e => set({ type: e.target.value })} className="input-base">
              <option value="announcement">Announcement</option>
              <option value="feed_post">Feed post</option>
              <option value="banner">Homepage banner</option>
              <option value="event">Event</option>
              <option value="ministry_update">Ministry update</option>
              {form.id && form.type === 'sermon' && <option value="sermon">Sermon</option>}
            </select>
            {form.type === 'sermon' && <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">Sermon files are uploaded from Sermons. Use “Schedule for later” there; it appears here for editing, preview and cancellation.</p>}
          </div>

          {(form.type === 'announcement' || form.type === 'feed_post') && (
            <>
              <div>
                <label className="label-caps mb-1 block" htmlFor="pub-caption">Post</label>
                <textarea id="pub-caption" rows={5} value={form.caption} onChange={e => set({ caption: e.target.value.slice(0, 2000) })} placeholder="What should the church see?" className="input-base resize-y" />
                <p className="mt-1 text-right text-[10px] text-ink-muted">{form.caption.length}/2000</p>
              </div>
              <input value={form.title} onChange={e => set({ title: e.target.value.slice(0, 140) })} placeholder="Calendar title (optional)" className="input-base" />
            </>
          )}

          {form.type === 'banner' && (
            <div className="space-y-2">
              <input value={form.heroKicker} onChange={e => set({ heroKicker: e.target.value.slice(0, 120) })} placeholder="Small heading, e.g. Karibu, family" className="input-base" />
              <input value={form.heroTitle} onChange={e => set({ heroTitle: e.target.value.slice(0, 120) })} placeholder="Main banner title" className="input-base" />
              <textarea value={form.heroSubtitle} onChange={e => set({ heroSubtitle: e.target.value.slice(0, 300) })} rows={2} placeholder="Banner subtitle" className="input-base resize-y" />
              <input value={form.verseText} onChange={e => set({ verseText: e.target.value.slice(0, 300) })} placeholder="Verse / encouragement" className="input-base" />
              <input value={form.verseRef} onChange={e => set({ verseRef: e.target.value.slice(0, 120) })} placeholder="Verse reference" className="input-base" />
              <p className="text-[10px] text-ink-muted">Publishing applies these fields to the existing Home banner. Expiry restores the previous banner.</p>
            </div>
          )}

          {form.type === 'event' && (
            <div className="space-y-2">
              <input value={form.title} onChange={e => set({ title: e.target.value.slice(0, 120) })} placeholder="Event title *" className="input-base" />
              <textarea value={form.eventBody} onChange={e => set({ eventBody: e.target.value.slice(0, 2000) })} rows={3} placeholder="Details" className="input-base resize-y" />
              <input value={form.eventLocation} onChange={e => set({ eventLocation: e.target.value.slice(0, 160) })} placeholder="Location" className="input-base" />
              <label className="label-caps block">Starts (Nairobi)</label>
              <input type="datetime-local" value={form.eventStarts} onChange={e => set({ eventStarts: e.target.value })} className="input-base" />
              <label className="label-caps block">Ends (optional)</label>
              <input type="datetime-local" value={form.eventEnds} onChange={e => set({ eventEnds: e.target.value })} className="input-base" />
            </div>
          )}

          {form.type === 'ministry_update' && (
            <div className="space-y-2">
              <select value={form.departmentSlug} onChange={e => set({ departmentSlug: e.target.value })} className="input-base">
                <option value="">Choose a ministry</option>
                {departments.map(d => <option key={d.slug} value={d.slug}>{d.name}</option>)}
              </select>
              <input value={form.title} onChange={e => set({ title: e.target.value.slice(0, 120) })} placeholder="Update title *" className="input-base" />
              <textarea value={form.ministryBody} onChange={e => set({ ministryBody: e.target.value.slice(0, 2000) })} rows={4} placeholder="What is this ministry doing?" className="input-base resize-y" />
            </div>
          )}

          {form.type === 'sermon' && (
            <div className="space-y-2">
              <input value={form.title} onChange={e => set({ title: e.target.value.slice(0, 200) })} placeholder="Sermon title" className="input-base" />
              <input value={form.speaker} onChange={e => set({ speaker: e.target.value.slice(0, 200) })} placeholder="Speaker" className="input-base" />
              <input value={form.scripture} onChange={e => set({ scripture: e.target.value.slice(0, 200) })} placeholder="Scripture" className="input-base" />
              <textarea value={form.description} onChange={e => set({ description: e.target.value.slice(0, 1000) })} rows={3} placeholder="Description" className="input-base resize-y" />
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="label-caps mb-1 block" htmlFor="pub-schedule">Publish at (Nairobi)</label>
              <input id="pub-schedule" type="datetime-local" value={form.scheduledAt} onChange={e => set({ scheduledAt: e.target.value })} className="input-base" />
              <p className="mt-1 text-[10px] text-ink-subtle">Leave empty to keep it as a draft.</p>
            </div>
            <div>
              <label className="label-caps mb-1 block" htmlFor="pub-expiry">Expire at (optional)</label>
              <input id="pub-expiry" type="datetime-local" value={form.expiresAt} onChange={e => set({ expiresAt: e.target.value })} className="input-base" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={previewDraft} className="min-h-11 rounded-xl border border-line bg-surface px-4 text-xs font-extrabold text-ink">Preview</button>
            <button type="button" disabled={saving} onClick={() => void save(false)} className="min-h-11 flex-1 rounded-xl bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Saving…' : form.scheduledAt ? 'Save schedule' : 'Save draft'}</button>
            <button type="button" disabled={saving} onClick={() => void save(true)} className="min-h-11 rounded-xl border border-accent/30 bg-accent-soft px-4 text-xs font-extrabold text-accent-strong disabled:opacity-50">Publish now</button>
          </div>
        </div>
      )}

      {preview && (
        <PreviewCard
          pub={preview}
          draft={previewForm}
          onClose={() => { setPreview(null); setPreviewForm(false) }}
          onEdit={() => previewDraft()}
        />
      )}

      {loading ? (
        <div className="rounded-card border border-line bg-surface-raised p-8 text-center text-sm text-ink-muted">Loading the calendar…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface-raised p-8 text-center">
          <p className="text-sm font-extrabold text-ink">Nothing here yet</p>
          <p className="mt-1 text-xs text-ink-muted">Schedule an announcement, post, banner, event or ministry update. Sermons join from the Sermons screen.</p>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.key} className="space-y-2">
            <h3 className="px-1 text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-subtle">{group.label}</h3>
            {group.rows.map(p => {
              const editable = p.status === 'draft' || p.status === 'scheduled'
              const when = p.scheduled_at || p.published_at
              return (
                <article key={p.id} className="rounded-card border border-line bg-surface-raised p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-ink">{p.title}</p>
                      <p className="mt-0.5 text-2xs text-ink-muted">
                        {TYPE_LABEL[p.content_type] || p.content_type} · {p.created_by_name || p.created_by}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${STATUS_TONE[p.status] || STATUS_TONE.draft}`}>{STATUS_LABEL[p.status] || p.status}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                    <div><dt className="text-ink-subtle">{p.status === 'published' ? 'Published' : p.status === 'expired' ? 'Expired' : 'Scheduled'}</dt><dd className="font-bold text-ink-muted">{formatNairobi(when)}</dd></div>
                    <div><dt className="text-ink-subtle">Expiry</dt><dd className="font-bold text-ink-muted">{formatNairobi(p.expires_at)}</dd></div>
                  </dl>
                  {p.last_error && <p className="mt-2 rounded-xl bg-danger-soft p-2 text-[10px] font-semibold text-danger">Retry: {p.last_error}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setPreview(p)} className="min-h-10 rounded-full border border-line bg-surface px-3 text-2xs font-extrabold text-ink-muted">Preview</button>
                    {editable && <button type="button" onClick={() => openEdit(p)} className="min-h-10 rounded-full border border-line bg-surface px-3 text-2xs font-extrabold text-ink-muted">Edit</button>}
                    {editable && <button type="button" disabled={saving} onClick={() => void publishNow(p)} className="min-h-10 rounded-full bg-accent-soft px-3 text-2xs font-extrabold text-accent-strong disabled:opacity-50">Publish now</button>}
                    {editable && <button type="button" disabled={saving} onClick={() => void cancel(p)} className="min-h-10 rounded-full border border-danger/20 bg-danger-soft px-3 text-2xs font-extrabold text-danger disabled:opacity-50">{cancelId === p.id ? 'Confirm cancel' : 'Cancel'}</button>}
                    <button type="button" onClick={() => void toggleHistory(p)} className="min-h-10 rounded-full px-2 text-2xs font-bold text-ink-subtle">History</button>
                  </div>
                  {historyOpen === p.id && (
                    <div className="mt-2 space-y-1 rounded-xl border border-line bg-surface p-2.5">
                      {(history[p.id] || []).length === 0 ? <p className="text-[10px] text-ink-muted">Loading history…</p> : history[p.id].map(h => (
                        <p key={h.id} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="font-bold capitalize text-ink-muted">{String(h.action).replace(/_/g, ' ')}</span>
                          <span className="text-ink-subtle">{formatNairobi(h.at)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        ))
      )}
    </div>
  )
}

function PreviewCard({ pub, draft, onClose, onEdit }: { pub: Publication; draft?: boolean; onClose: () => void; onEdit?: () => void }) {
  const p = pub.payload || {}
  return (
    <div className="rounded-card border border-gold/40 bg-gold-soft/40 p-4" data-testid="publication-preview">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-subtle">Preview · {draft ? 'unsaved' : STATUS_LABEL[pub.status]}</p>
        <div className="flex gap-2">
          {draft && onEdit && <button type="button" onClick={onEdit} className="text-2xs font-extrabold text-accent-strong">Edit</button>}
          <button type="button" onClick={onClose} className="text-2xs font-extrabold text-ink-muted">Close</button>
        </div>
      </div>
      <div className="mt-2 rounded-2xl border border-line bg-surface-raised p-3">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-accent-strong">{TYPE_LABEL[pub.content_type] || pub.content_type}</p>
        {(pub.content_type === 'announcement' || pub.content_type === 'feed_post') && (
          <>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{p.caption}</p>
            <p className="mt-2 text-2xs text-ink-subtle">Will appear in the Home feed as a church post.</p>
          </>
        )}
        {pub.content_type === 'banner' && (
          <>
            <p className="text-2xs font-bold uppercase tracking-wide text-gold-strong">{p.content?.hero_kicker || 'Karibu, family'}</p>
            <p className="mt-1 text-xl font-extrabold leading-tight text-ink">{p.content?.hero_title || 'Homepage banner'}</p>
            {p.content?.hero_subtitle && <p className="mt-1 text-xs text-ink-muted">{p.content.hero_subtitle}</p>}
            {p.content?.verse_text && <p className="mt-2 border-l-2 border-gold pl-2 text-xs italic text-ink-muted">{p.content.verse_text}<br /><span className="not-italic font-bold">{p.content.verse_ref}</span></p>}
          </>
        )}
        {pub.content_type === 'event' && (
          <>
            <p className="text-base font-extrabold text-ink">{p.title}</p>
            <p className="mt-1 text-xs font-bold text-accent-strong">{formatNairobi(p.starts_at)}{p.ends_at ? ` – ${formatNairobi(p.ends_at)}` : ''}</p>
            {p.location && <p className="text-xs text-ink-muted">{p.location}</p>}
            {p.body && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{p.body}</p>}
          </>
        )}
        {pub.content_type === 'ministry_update' && (
          <>
            <p className="text-[10px] font-bold uppercase text-accent-strong">{p.department_slug?.replace(/-/g, ' ')}</p>
            <p className="mt-1 text-base font-extrabold text-ink">{p.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{p.body}</p>
          </>
        )}
        {pub.content_type === 'sermon' && (
          <>
            <p className="text-base font-extrabold text-ink">{p.title}</p>
            <p className="text-xs text-ink-muted">{p.speaker || 'Harvest Family Church'}{p.scripture ? ` · ${p.scripture}` : ''}</p>
            {pub.preview_url && (p.kind === 'video'
              ? <video src={pub.preview_url} controls className="mt-2 max-h-64 w-full rounded-xl bg-black" />
              : <audio src={pub.preview_url} controls className="mt-2 w-full" />)}
            {p.description && <p className="mt-2 text-xs text-ink-muted">{p.description}</p>}
          </>
        )}
        <p className="mt-3 border-t border-line pt-2 text-[10px] text-ink-subtle">
          {pub.scheduled_at ? `Scheduled ${formatNairobi(pub.scheduled_at)}` : 'Not scheduled'} · {pub.expires_at ? `Expires ${formatNairobi(pub.expires_at)}` : 'No expiry'}
        </p>
      </div>
    </div>
  )
}
