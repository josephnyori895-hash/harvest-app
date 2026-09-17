import { useCallback, useEffect, useRef, useState } from 'react'

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
    body: JSON.stringify({ type, contentType: file.type, bytes: file.size, ext: (file.name.split('.').pop() || 'bin').toLowerCase() }),
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
  if (!up.ok) throw new Error('Upload failed — check your connection and file size')
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
      flash('Published to the church ✅')
      setTab(upType === 'track' ? 'tracks' : upType === 'reel' ? 'reels' : 'posts')
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally { setUpBusy(false) }
  }

  const shown = tab === 'upload' ? [] : items.filter(x => x.kind === tab)

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-[#E8DEC9]" aria-label="Back">‹</button>
        <div>
          <h1 className="font-extrabold">Media studio</h1>
          <p className="text-xs text-[#766E63]">Upload · edit · pin · delete anything</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(['upload', 'posts', 'reels', 'tracks', 'stories'] as const).map(value => (
          <button key={value} onClick={() => setTab(value)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition ${tab === value ? 'bg-[#7C3AED] text-white shadow' : 'bg-white border border-[#E8DEC9] text-[#5C554C]'}`}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="mb-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">{notice}</div>}

      {tab === 'upload' && (
        <div className="space-y-3 max-w-xl">
          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
            <p className="text-xs font-bold text-[#766E63] mb-3">WHAT ARE YOU PUBLISHING?</p>
            <div className="grid grid-cols-3 gap-2">
              {([['post', '📷 Photo post'], ['reel', '🎬 Reel / sermon'], ['track', '🎵 Worship track']] as const).map(([value, label]) => (
                <button key={value} onClick={() => { setUpType(value); setFile(null) }} className={`p-3 rounded-2xl border text-sm font-bold ${upType === value ? 'border-[#7C3AED] bg-[#F3E8FF]' : 'border-[#E8DEC9] bg-[#FFFBF0]'}`}>{label}</button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
            {file ? (
              <div className="relative bg-[#F5EEDF] aspect-[4/3] rounded-2xl overflow-hidden flex items-center justify-center">
                {file.type.startsWith('video/') ? <video src={URL.createObjectURL(file)} controls className="w-full h-full object-cover" />
                  : file.type.startsWith('audio/') ? <div className="text-center"><span className="text-5xl">🎵</span><p className="text-sm font-bold mt-2 truncate max-w-[220px]">{file.name}</p></div>
                  : <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />}
                <button onClick={() => setFile(null)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90">×</button>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} className="w-full aspect-[4/3] flex flex-col items-center justify-center rounded-2xl bg-[#FFFBF0] border border-dashed border-[#E8DEC9]">
                <span className="text-3xl">＋</span>
                <span className="text-sm font-bold mt-2">{upType === 'track' ? 'Choose audio' : upType === 'reel' ? 'Choose video' : 'Choose photo'}</span>
              </button>
            )}
            <input ref={fileInput} type="file" accept={upType === 'reel' ? 'video/*' : upType === 'track' ? 'audio/*' : 'image/*'} onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
          </div>

          <div className="p-4 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm space-y-2">
            {upType === 'track' && (
              <>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Track title" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
                <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (optional)" className="w-full bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#7C3AED]" />
              </>
            )}
            <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Caption / message…" className="w-full resize-none bg-[#FFFBF0] border border-[#E8DEC9] rounded-2xl p-3 text-sm outline-none focus:border-[#7C3AED]" />
            <button disabled={upBusy} onClick={() => void doUpload()} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{upBusy ? 'Publishing…' : 'Publish to the church'}</button>
          </div>
        </div>
      )}

      {tab !== 'upload' && (
        loading ? <p className="text-sm text-[#766E63] text-center py-10">Loading…</p>
          : shown.length === 0 ? <p className="text-sm text-[#766E63] text-center py-10">Nothing here yet.</p>
            : shown.map(item => (
              <div key={`${item.kind}-${item.id}`} className="bg-white border border-[#E8DEC9] rounded-3xl p-4 mb-3 shadow-sm">
                <div className="flex gap-3">
                  {item.preview_url && <img src={item.preview_url} alt="" className="w-16 h-16 rounded-2xl object-cover bg-[#F5EEDF]" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-[#766E63]">@{item.username} · {new Date(item.created_at).toLocaleDateString()}</p>
                    {editing === item.id ? (
                      <div className="mt-1 flex gap-2">
                        <input value={editText} onChange={e => setEditText(e.target.value)} className="flex-1 bg-[#FFFBF0] border border-[#E8DEC9] rounded-xl px-3 py-1.5 text-sm outline-none focus:border-[#7C3AED]" />
                        <button disabled={busy === item.id} onClick={() => void saveEdit(item)} className="px-3 rounded-xl bg-[#7C3AED] text-white text-xs font-bold">Save</button>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold truncate">{item.kind === 'tracks' ? `${item.title || 'Untitled'}${item.artist ? ` — ${item.artist}` : ''}` : (item.caption || 'No caption')}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button disabled={busy === item.id} onClick={() => { setEditing(item.id); setEditText(item.kind === 'tracks' ? (item.title || '') : (item.caption || '')) }} className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#F5EEDF] border border-[#E8DEC9]">Edit</button>
                  {(item.kind === 'posts' || item.kind === 'reels') && (
                    <button disabled={busy === item.id} onClick={() => void togglePin(item)} className={`px-3 py-1.5 rounded-full text-xs font-bold ${item.is_pinned ? 'bg-[#7C3AED] text-white' : 'bg-[#F5EEDF] border border-[#E8DEC9]'}`}>{item.is_pinned ? '📌 Pinned' : 'Pin'}</button>
                  )}
                  <button disabled={busy === item.id} onClick={() => void remove(item)} className="ml-auto px-3 py-1.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Delete</button>
                </div>
              </div>
            ))
      )}
    </div>
  )
}
