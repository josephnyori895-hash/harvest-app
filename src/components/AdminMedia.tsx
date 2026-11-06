import { useCallback, useEffect, useRef, useState } from 'react'

import ErrorMessage from './ErrorMessage'
import { Icon } from '../ui'
import { timeAgo } from '../lib/time'
import { resolveUploadMime } from '../lib/backgroundUploads'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type Item = {
  id: string
  username?: string
  caption?: string | null
  title?: string | null
  artist?: string | null
  preview_url?: string | null
  is_pinned?: number | boolean
  created_at: string
  kind: string
}

type Props = { onBack: () => void }

async function uploadMedia(file: File, type: 'post' | 'story' | 'reel' | 'track', meta: { caption?: string; title?: string; artist?: string }) {
  const token = localStorage.getItem('harvest_token') || ''
  const presignResponse = await fetch(`${API}/api/media/presign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // Resolve the type the way every other upload path does: a picked .m4a is
    // often reported as an empty type or video/mp4, and either one is refused
    // at presign before the transfer starts.
    body: JSON.stringify({ type, contentType: resolveUploadMime(file, file.name), bytes: file.size, ext: (file.name.split('.').pop() || 'bin').toLowerCase() }),
  })
  const presign = await presignResponse.json().catch(() => ({}))
  if (!presignResponse.ok) throw new Error(presign.error || 'Unable to prepare upload')
  const form = new FormData()
  Object.entries(presign.fields || {}).forEach(([key, value]) => form.append(key, String(value)))
  form.append('file', file)
  // Proxy fallback uploads hit our own API and need the bearer token
  // (direct-to-R2 presigned posts would reject extra auth headers).
  const isDirectR2 = /^https?:\/\//.test(presign.url)
  const up = await fetch(isDirectR2 ? presign.url : `${API}${presign.url}`, {
    method: 'POST',
    body: form,
    headers: isDirectR2 ? undefined : { Authorization: `Bearer ${token}` },
  })
  if (!up.ok) {
    // The server names the refusal (format not allowed, over the cap, no
    // permission). A generic message here hides the one thing that can be acted on.
    const text = await up.text().catch(() => '')
    let reason = ''
    try { reason = String(JSON.parse(text)?.error || '') } catch { /* XML or plain body */ }
    throw new Error(reason || `Upload failed (${up.status}) — check your connection and file size`)
  }
  const confirm = await fetch(`${API}/api/media/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: presign.key, type, caption: meta.caption, title: meta.title, artist: meta.artist }),
  })
  const result = await confirm.json().catch(() => ({}))
  if (!confirm.ok) throw new Error(result.error || 'Unable to publish')
  return result
}

export default function AdminMedia({ onBack }: Props) {
  const [tab, setTab] = useState<'upload' | 'posts' | 'reels' | 'tracks' | 'stories'>('upload')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const token = () => localStorage.getItem('harvest_token') || ''

  // Upload form state
  const [upType, setUpType] = useState<'post' | 'reel' | 'track'>('post')
  const [caption, setCaption] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [upBusy, setUpBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/api/admin/media`, { headers: { Authorization: `Bearer ${token()}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Unable to load media')
      setItems([
        ...(d.posts || []).map((x: any) => ({ ...x, kind: 'posts' })),
        ...(d.reels || []).map((x: any) => ({ ...x, kind: 'reels' })),
        ...(d.tracks || []).map((x: any) => ({ ...x, kind: 'tracks' })),
        ...(d.stories || []).map((x: any) => ({ ...x, kind: 'stories' })),
      ])
    } catch (e: any) {
      setError(e?.message || 'Unable to load media')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (tab !== 'upload') void load() }, [tab, load])

  const saveEdit = async (item: Item) => {
    setBusy(item.id); setError('')
    try {
      const url = item.kind === 'tracks'
        ? `${API}/api/admin/media/tracks/${item.id}`
        : `${API}/api/admin/media/${item.kind}/${item.id}`
      const body = item.kind === 'tracks' ? { title: editText } : { caption: editText }
      const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Update failed')
      setItems(list => list.map(x => x.id === item.id ? (item.kind === 'tracks' ? { ...x, title: editText } : { ...x, caption: editText }) : x))
      setEditing(null)
      flash('Saved')
    } catch (e: any) {
      setError(e?.message || 'Update failed')
    } finally { setBusy(null) }
  }

  const togglePin = async (item: Item) => {
    setBusy(item.id); setError('')
    try {
      const r = await fetch(`${API}/api/admin/media/${item.kind}/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ is_pinned: !item.is_pinned }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Pin failed')
      setItems(list => list.map(x => x.id === item.id ? { ...x, is_pinned: !item.is_pinned } : x))
      flash(item.is_pinned ? 'Unpinned' : 'Pinned to top')
    } catch (e: any) {
      setError(e?.message || 'Pin failed')
    } finally { setBusy(null) }
  }

  const remove = async (item: Item) => {
    if (busy) return
    if (!window.confirm(`Delete this ${item.kind.slice(0, -1)} permanently?`)) return
    setBusy(item.id); setError('')
    try {
      const r = await fetch(`${API}/api/admin/media/${item.kind}/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Delete failed')
      setItems(list => list.filter(x => x.id !== item.id))
      flash('Deleted')
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally { setBusy(null) }
  }

  const doUpload = async () => {
    if (upBusy) return
    if (!file) { setError('Choose a file first.'); return }
    if (upType === 'track' && !title.trim()) { setError('Give the track a title.'); return }
    setUpBusy(true); setError('')
    try {
      await uploadMedia(file, upType, {
        caption: caption.trim() || undefined,
        title: upType === 'track' ? title.trim() : undefined,
        artist: upType === 'track' ? artist.trim() || 'Harvest Worship' : undefined,
      })
      setFile(null); setCaption(''); setTitle(''); setArtist('')
      flash('Published to the church')
      setTab(upType === 'track' ? 'tracks' : upType === 'reel' ? 'reels' : 'posts')
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally { setUpBusy(false) }
  }

  const shown = tab === 'upload' ? [] : items.filter(x => x.kind === tab)

  return (
    <div className="bg-surface text-ink min-h-[70vh] p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-raised text-ink" aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <div>
          <h1 className="font-extrabold">Media studio</h1>
          <p className="text-xs text-ink-muted">Upload · edit · pin · delete anything</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(['upload', 'posts', 'reels', 'tracks', 'stories'] as const).map(value => (
          <button key={value} onClick={() => setTab(value)} className={`min-h-9 rounded-full px-4 text-2xs font-extrabold whitespace-nowrap transition ${tab === value ? 'bg-accent text-white shadow' : 'bg-surface-raised border border-line text-ink-muted'}`}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      {error && <ErrorMessage message={error} />}
      {notice && <div role="status" className="mb-3 rounded-2xl border border-success bg-success-soft p-3 text-sm font-semibold text-success">{notice}</div>}

      {tab === 'upload' && (
        <div className="space-y-3 max-w-xl">
          <div className="p-4 rounded-3xl bg-white border border-line shadow-sm">
            <p className="text-xs font-bold text-ink-muted mb-3">WHAT ARE YOU PUBLISHING?</p>
            <div className="grid grid-cols-3 gap-2">
              {([['post', 'Photo post', 'camera'], ['reel', 'Reel / sermon', 'reels'], ['track', 'Worship track', 'music']] as const).map(([value, label, icon]) => (
                <button key={value} onClick={() => { setUpType(value); setFile(null) }} className={`inline-flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-2xs font-extrabold ${upType === value ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface-raised text-ink-muted'}`}>
                  <Icon name={icon} size={18} />{label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-3xl bg-white border border-line shadow-sm">
            {file ? (
              <div className="relative bg-surface-sunken aspect-[4/3] rounded-2xl overflow-hidden flex items-center justify-center">
                {file.type.startsWith('video/') ? <video src={URL.createObjectURL(file)} controls className="w-full h-full object-cover" />
                  : file.type.startsWith('audio/') ? <div className="text-center"><Icon name="music" size={36} className="mx-auto text-accent" /><p className="mt-2 max-w-[220px] truncate text-sm font-bold">{file.name}</p></div>
                  : <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />}
                <button onClick={() => setFile(null)} className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-ink/70 text-white" aria-label="Remove selected media"><Icon name="close" size={16} /></button>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} className="w-full aspect-[4/3] flex flex-col items-center justify-center rounded-2xl bg-surface border border-dashed border-line">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-strong"><Icon name="plus" size={20} /></span>
                <span className="mt-2 text-sm font-bold">{upType === 'track' ? 'Choose audio' : upType === 'reel' ? 'Choose video' : 'Choose photo'}</span>
              </button>
            )}
            <input ref={fileInput} type="file" accept={upType === 'reel' ? 'video/*' : upType === 'track' ? 'audio/*' : 'image/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
          </div>

          <div className="p-4 rounded-3xl bg-white border border-line shadow-sm space-y-2">
            {upType === 'track' && (
              <>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title" className="w-full bg-surface border border-line rounded-2xl px-4 py-3 text-sm outline-none focus:border-accent" />
                <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (optional)" className="w-full bg-surface border border-line rounded-2xl px-4 py-3 text-sm outline-none focus:border-accent" />
              </>
            )}
            <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Caption / message…" className="w-full resize-none bg-surface border border-line rounded-2xl p-3 text-sm outline-none focus:border-accent" />
            <button disabled={upBusy} onClick={() => void doUpload()} className="w-full py-3 rounded-2xl bg-accent text-white text-sm font-bold disabled:opacity-50">{upBusy ? 'Publishing…' : 'Publish to the church'}</button>
          </div>
        </div>
      )}

      {tab !== 'upload' && (
        loading ? <p className="text-sm text-ink-muted text-center py-10">Loading…</p>
          : shown.length === 0 ? <p className="text-sm text-ink-muted text-center py-10">Nothing here yet.</p>
            : shown.map(item => (
              <div key={`${item.kind}-${item.id}`} className="bg-white border border-line rounded-3xl p-4 mb-3 shadow-sm">
                <div className="flex gap-3">
                  {item.preview_url && <img src={item.preview_url} alt="" className="w-16 h-16 rounded-2xl object-cover bg-surface-sunken" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-muted">@{item.username} · {timeAgo(item.created_at)}</p>
                    {editing === item.id ? (
                      <div className="mt-1 flex gap-2">
                        <input value={editText} onChange={e => setEditText(e.target.value)} className="flex-1 bg-surface border border-line rounded-xl px-3 py-1.5 text-sm outline-none focus:border-accent" />
                        <button disabled={busy === item.id} onClick={() => void saveEdit(item)} className="px-3 rounded-xl bg-accent text-white text-xs font-bold">Save</button>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold truncate">{item.kind === 'tracks' ? `${item.title || 'Untitled'}${item.artist ? ` — ${item.artist}` : ''}` : (item.caption || 'No caption')}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button disabled={busy === item.id} onClick={() => { setEditing(item.id); setEditText(item.kind === 'tracks' ? (item.title || '') : (item.caption || '')) }} className="px-3 py-1.5 rounded-full text-xs font-bold bg-surface-sunken border border-line">Edit</button>
                  {(item.kind === 'posts' || item.kind === 'reels') && (
                    <button disabled={busy === item.id} onClick={() => void togglePin(item)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-2xs font-extrabold ${item.is_pinned ? 'bg-accent text-white' : 'bg-surface-sunken border border-line'}`}><Icon name="bookmark" size={12} />{item.is_pinned ? 'Pinned' : 'Pin'}</button>
                  )}
                  <button disabled={busy === item.id} onClick={() => void remove(item)} className="ml-auto px-3 py-1.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Delete</button>
                </div>
              </div>
            ))
      )}
    </div>
  )
}
