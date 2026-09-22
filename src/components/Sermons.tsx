import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from './Toast'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('harvest_token') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function fmtBytes(n?: number | null) {
  if (!n) return ''
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function fmtDur(sec: number) {
  if (!sec || isNaN(sec)) return '0:00'
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2,'0')}`
}

// Sermons — admin-published audio (mp3) & video (mp4) teachings.
// Members stream in the app or download the original file.
export default function Sermons({ isAdmin, verified }: { isAdmin: boolean; verified: boolean }) {
  const [sermons, setSermons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [playerReady, setPlayerReady] = useState<Record<string, boolean>>({})
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKind, setUploadKind] = useState<'audio' | 'video'>('audio')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadSpeaker, setUploadSpeaker] = useState('')
  const [uploadScripture, setUploadScripture] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [canManageSermons, setCanManageSermons] = useState(isAdmin)
  const [managerUsers, setManagerUsers] = useState<any[]>([])
  const [managerBusy, setManagerBusy] = useState('')
  const [managerSearch, setManagerSearch] = useState('')
  const uploadInput = useRef<HTMLInputElement | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API}/api/sermons`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load sermons'))))
      .then(d => { setSermons(Array.isArray(d.sermons) ? d.sermons : []); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    fetch(`${API}/api/me`, { headers: authHeaders() }).then(r => r.ok ? r.json() : null).then(d => setCanManageSermons(isAdmin || (d?.grants || []).includes('manage_sermons'))).catch(() => setCanManageSermons(isAdmin))
  }, [isAdmin])

  const loadManagers = useCallback(async () => {
    if (!isAdmin) return
    try {
      const r = await fetch(`${API}/api/users/map`, { headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setManagerUsers(Array.isArray(d.users) ? d.users.filter((u: any) => u.role !== 'admin') : [])
    } catch {}
  }, [isAdmin])
  useEffect(() => { void loadManagers() }, [loadManagers])

  const toggleSermonManager = async (u: any) => {
    if (!u?.username || managerBusy) return
    const grants = String(u.grants || '').split(',').filter(Boolean)
    const on = grants.includes('manage_sermons')
    const next = on ? grants.filter((g: string) => g !== 'manage_sermons') : [...grants, 'manage_sermons']
    setManagerBusy(u.username)
    try {
      const r = await fetch(`${API}/api/admin/users/${encodeURIComponent(u.username)}`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ grants: next }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not update permission')
      setManagerUsers(xs => xs.map(x => x.username === u.username ? { ...x, grants: d.user?.grants || next.join(',') } : x))
      showToast(on ? `${u.name || u.username} can no longer manage sermons` : `${u.name || u.username} can manage sermons`, 'success')
    } catch (e: any) { showToast(e?.message || 'Could not update permission', 'error') } finally { setManagerBusy('') }
  }

  const play = async (s: any) => {
    if (playing === s.id) {
      audioRef.current?.pause(); videoRef.current?.pause()
      if (audioRef.current) audioRef.current.src = ''
      if (videoRef.current) videoRef.current.src = ''
      setPlaying(null)
      setPlayerReady(prev => ({ ...prev, [s.id]: false }))
      return
    }
    if (!s.media_url) {
      showToast('Sermon media is unavailable', 'error')
      return
    }
    audioRef.current?.pause(); videoRef.current?.pause()
    setPlaying(s.id)
    setPlayerReady(prev => ({ ...prev, [s.id]: true }))
    fetch(`${API}/api/sermons/${s.id}/play`, { method: 'POST', headers: authHeaders() }).catch(() => {})
  }

  const download = async (s: any) => {
    if (busy === s.id) return
    setBusy(s.id)
    try {
      const r = await fetch(`${API}/api/sermons/${s.id}/download`, { method: 'POST', headers: authHeaders() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not prepare download')
      const ext = s.kind === 'video' ? 'mp4' : 'mp3'
      const a = document.createElement('a')
      a.href = d.url
      a.download = d.filename || `${s.title.replace(/[^a-z0-9]/gi,'_').slice(0,40)}.${ext}`
      a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      showToast(`Download started — ${ext.toUpperCase()}`, 'success')
      setSermons(xs => xs.map(x => x.id === s.id ? { ...x, downloads: (Number(x.downloads) || 0) + 1 } : x))
    } catch (e: any) {
      showToast(e?.message || 'Could not download', 'error')
    } finally { setBusy('') }
  }

  const uploadSermon = async () => {
    if (!uploadFile || !uploadTitle.trim() || uploading) return
    setUploading(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const type = uploadKind === 'video' ? 'sermon_video' : 'sermon_audio'
      const pres = await fetch(API + '/api/media/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ type, contentType: uploadFile.type, bytes: uploadFile.size, ext: (uploadFile.name.split('.').pop() || (uploadKind === 'video' ? 'mp4' : 'mp3')).toLowerCase() }),
      })
      const pd = await pres.json().catch(() => ({}))
      if (!pres.ok) throw new Error(pd.error || 'Unable to prepare upload')
      const direct = /^https?:\/\//.test(pd.url)
      let up: Response
      if (direct) {
        up = await fetch(pd.url, { method: pd.method || 'PUT', body: uploadFile, headers: { 'Content-Type': uploadFile.type, ...(pd.fields?.['x-amz-meta-ownerid'] ? { 'x-amz-meta-ownerid': String(pd.fields['x-amz-meta-ownerid']) } : {}) } })
      } else {
        const fd = new FormData()
        Object.entries(pd.fields || {}).forEach(([k,v]) => fd.append(k, String(v)))
        fd.append('file', uploadFile)
        up = await fetch(API + pd.url, { method: pd.method || 'POST', body: fd, headers: authHeaders() })
      }
      if (!up.ok) throw new Error('Upload failed — check your connection and file size')
      const confirm = await fetch(API + '/api/media/confirm', {
        method:'POST', headers:{...authHeaders(), 'Content-Type':'application/json'},
        body:JSON.stringify({ key:pd.key, type, title:uploadTitle, speaker:uploadSpeaker, scripture:uploadScripture, description:uploadDescription }),
      })
      const cd = await confirm.json().catch(() => ({}))
      if (!confirm.ok) throw new Error(cd.error || 'Could not publish sermon')
      showToast('Sermon published ✓', 'success')
      setUploadOpen(false); setUploadFile(null); setUploadTitle(''); setUploadSpeaker(''); setUploadScripture(''); setUploadDescription('')
      load()
    } catch (e: any) {
      showToast(e?.message || 'Sermon upload failed', 'error')
    } finally { setUploading(false) }
  }
  const saveEdit = async () => {
    if (!editing || busy === 'edit') return
    setBusy('edit')
    try {
      const r = await fetch(`${API}/api/sermons`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          title: editing.title,
          speaker: editing.speaker,
          scripture: editing.scripture,
          description: editing.description,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save')
      showToast('Sermon updated ✓')
      setEditing(null); load()
    } catch (e: any) { showToast(e?.message || 'Could not save', 'error') } finally { setBusy('') }
  }

  const remove = async (s: any) => {
    if (!window.confirm(`Delete \"${s.title}\" permanently? Members will no longer see it.`)) return
    setBusy(s.id)
    try {
      const r = await fetch(`${API}/api/sermons/${s.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast('Sermon deleted')
      load()
    } catch { showToast('Could not delete', 'error') } finally { setBusy('') }
  }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] pb-8">
      <div className="relative overflow-hidden px-5 pt-7 pb-6 bg-gradient-to-br from-[#32145f] via-[#6B21A8] to-[#A855F7] text-white shadow-xl">
        <div className="absolute -right-8 -top-14 w-40 h-40 rounded-full bg-amber-300/25 blur-3xl" />
        <div className="absolute -left-10 -bottom-14 w-44 h-44 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-purple-100/75">Harvest Word</p>
          <h1 className="text-3xl font-black tracking-tight mt-1">Sermons</h1>
          <p className="text-sm text-purple-100 mt-2 max-w-sm">Carry the Word with you—listen, watch, and share hope.</p>
          <div className="flex gap-2 mt-5">
            <div className="rounded-2xl px-3 py-2 bg-white/15 border border-white/15 backdrop-blur"><p className="text-lg font-black leading-none">{sermons.length}</p><p className="text-[9px] uppercase tracking-wide text-purple-100 mt-1">Teachings</p></div>
            <div className="rounded-2xl px-3 py-2 bg-white/15 border border-white/15 backdrop-blur"><p className="text-lg font-black leading-none">🎧</p><p className="text-[9px] uppercase tracking-wide text-purple-100 mt-1">Listen anywhere</p></div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5">
      {canManageSermons && (
        <div className="mb-5 rounded-3xl p-1 bg-gradient-to-r from-[#7C3AED] to-fuchsia-500 shadow-lg shadow-purple-300/60">
          <button onClick={() => setUploadOpen(true)} className="w-full py-3 rounded-2xl bg-[#7C3AED] text-white text-sm font-extrabold shadow-sm">
            🎙 Upload a Sermon (MP3 or MP4)
          </button>
          <p className="text-[11px] text-[#6B6257] mt-1.5 text-center">{isAdmin ? 'Admin control: uploads publish immediately.' : 'You have Sermon Manager permission: uploads publish immediately.'}</p>
        </div>
      )}

      {error && <div role="alert" className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {loading ? <p className="text-sm text-[#6B6257]">Loading…</p> : sermons.length === 0 ? (
        <div className="text-center py-14 rounded-3xl bg-white border border-[#E8DEC9] shadow-sm">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-[#F3E8FF] flex items-center justify-center text-3xl mb-3">🎙</div>
          <p className="font-bold text-sm">No sermons yet</p>
          <p className="text-xs text-[#6B6257] mt-1">{isAdmin ? 'Upload the first one below.' : 'Check back soon — new teachings are on the way.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sermons.map(s => (
            <div key={s.id} className="relative overflow-hidden bg-white border border-[#E8DEC9] rounded-3xl p-4 shadow-sm transition hover:shadow-md">
              <div className={`absolute inset-x-0 top-0 h-1 ${s.kind === 'video' ? 'bg-gradient-to-r from-purple-600 to-fuchsia-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`} />
              <div className="flex items-start gap-3">
                <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-xl shadow-inner ${s.kind === 'video' ? 'bg-[#F3E8FF] text-[#7C3AED]' : 'bg-[#FFF0C7]'}`}>{s.kind === 'video' ? '🎬' : '🎧'}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-sm leading-snug">{s.title}</p>
                  <p className="text-[11px] text-[#6B6257] mt-0.5">
                    {s.speaker || 'Harvest Family Church'}{s.scripture ? ` · ${s.scripture}` : ''} · {fmtDur(Number(s.duration_secs) || 0)}{s.duration_secs ? '' : ` · ${new Date(s.created_at).toLocaleDateString()}`}
                  </p>
                  <p className="text-[10px] text-[#8B8175] mt-1">▶ {s.plays} plays · 📥 {s.downloads} downloads{s.bytes ? ` · ${fmtBytes(s.bytes)}` : ''}</p>
                </div>
              </div>
              {s.description && <p className="text-xs text-[#4B433A] mt-2 leading-5">{s.description}</p>}

              {/* inline player */}
              {playing === s.id && playerReady[s.id] && (
                <div className="mt-3">
                  {s.kind === 'video' ? (
                    <video ref={videoRef} key={s.id} src={s.media_url} controls autoPlay playsInline className="w-full rounded-2xl bg-black" />
                  ) : (
                    <audio ref={audioRef} key={s.id} src={s.media_url} controls autoPlay className="w-full" />
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-3">
                <button onClick={() => void play(s)} className={`flex-1 py-2.5 rounded-2xl text-xs font-extrabold ${playing === s.id ? 'bg-[#29251F] text-white' : 'bg-[#7C3AED] text-white'}`}>
                  {playing === s.id ? '⏸ Hide player' : s.kind === 'video' ? '▶ Watch' : '▶ Listen'}
                </button>
                <button onClick={() => void download(s)} disabled={busy === s.id} className="px-4 py-2.5 rounded-2xl bg-[#F4E8D0] border border-[#E8DEC9] text-xs font-extrabold text-[#5B21B6] disabled:opacity-50">
                  {busy === s.id ? '…' : `📥 Download ${s.kind === 'video' ? 'MP4' : 'MP3'}`}
                </button>
                {canManageSermons && (
                  <>
                    <button onClick={() => setEditing({ ...s })} className="px-3 py-2.5 rounded-2xl bg-white border border-[#E8DEC9] text-xs font-bold" aria-label="Edit sermon">✏️</button>
                    <button onClick={() => void remove(s)} disabled={busy === s.id} className="px-3 py-2.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-600 disabled:opacity-50" aria-label="Delete sermon">🗑</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => !uploading && setUploadOpen(false)} role="dialog" aria-label="Upload sermon">
          <div className="w-full sm:max-w-lg bg-white rounded-t-[28px] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-extrabold text-sm">🎙 Upload sermon</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setUploadKind('audio'); setUploadFile(null) }} className={`py-2.5 rounded-xl text-xs font-bold border ${uploadKind === 'audio' ? 'bg-[#F3E8FF] border-[#7C3AED] text-[#5B21B6]' : 'border-[#E8DEC9]'}`}>🎧 MP3 audio</button>
              <button onClick={() => { setUploadKind('video'); setUploadFile(null) }} className={`py-2.5 rounded-xl text-xs font-bold border ${uploadKind === 'video' ? 'bg-[#F3E8FF] border-[#7C3AED] text-[#5B21B6]' : 'border-[#E8DEC9]'}`}>🎬 MP4 video</button>
            </div>
            <input ref={uploadInput} type="file" accept={uploadKind === 'video' ? '.mp4,video/mp4' : '.mp3,audio/mpeg,audio/mp3'} onChange={e => setUploadFile(e.target.files?.[0] || null)} className="hidden" />
            <button onClick={() => uploadInput.current?.click()} className="w-full py-3 rounded-xl border border-dashed border-[#CFC3B2] bg-[#FFFBF0] text-sm font-bold">{uploadFile ? uploadFile.name : 'Choose file'}</button>
            <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Sermon title *" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm" />
            <input value={uploadSpeaker} onChange={e => setUploadSpeaker(e.target.value)} placeholder="Speaker / preacher" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm" />
            <input value={uploadScripture} onChange={e => setUploadScripture(e.target.value)} placeholder="Scripture reference" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm" />
            <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} rows={3} placeholder="Description" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm resize-y" />
            <button disabled={uploading || !uploadFile || !uploadTitle.trim()} onClick={() => void uploadSermon()} className="w-full py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{uploading ? 'Uploading…' : 'Upload sermon'}</button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mt-6 rounded-3xl bg-white border border-[#E8DEC9] p-4 shadow-sm">
          <p className="font-extrabold text-sm">🔐 Sermon managers</p>
          <p className="text-xs text-[#766E63] mt-1">Give a member full control of sermons: upload, edit and delete. Admins always retain full access.</p>
          <input value={managerSearch} onChange={e => setManagerSearch(e.target.value)} placeholder="Search members…" className="w-full mt-3 rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm" />
          <div className="mt-3 space-y-2 max-h-64 overflow-auto">
            {managerUsers.filter(u => `${u.username} ${u.name}`.toLowerCase().includes(managerSearch.trim().toLowerCase())).slice(0, 20).map(u => {
              const on = String(u.grants || '').split(',').filter(Boolean).includes('manage_sermons')
              return <div key={u.username} className="flex items-center gap-3 rounded-2xl border border-[#F0E7D8] p-3">
                <div className="min-w-0 flex-1"><p className="text-sm font-bold truncate">{u.name || u.username}</p><p className="text-[11px] text-[#766E63] truncate">@{u.username} · {u.group_name || 'Member'}</p></div>
                <button disabled={managerBusy === u.username} onClick={() => void toggleSermonManager(u)} className={`px-3 py-2 rounded-xl text-xs font-bold ${on ? 'bg-[#7C3AED] text-white' : 'bg-[#F5EEDF] text-[#5C554C]'}`}>{managerBusy === u.username ? '…' : on ? 'Manager ✓' : 'Give access'}</button>
              </div>
            })}
          </div>
        </div>
      )}

      {/* admin edit sheet */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setEditing(null)} role="dialog" aria-label="Edit sermon">
          <div className="w-full sm:max-w-lg bg-white rounded-t-[28px] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-extrabold text-sm">✏️ Edit sermon</p>
            <input value={editing.title || ''} onChange={e => setEditing((x: any) => ({ ...x, title: e.target.value }))} placeholder="Title" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <input value={editing.speaker || ''} onChange={e => setEditing((x: any) => ({ ...x, speaker: e.target.value }))} placeholder="Speaker" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <input value={editing.scripture || ''} onChange={e => setEditing((x: any) => ({ ...x, scripture: e.target.value }))} placeholder="Scripture (e.g. John 3:16-21)" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]" />
            <textarea value={editing.description || ''} onChange={e => setEditing((x: any) => ({ ...x, description: e.target.value }))} rows={3} placeholder="Description" className="w-full rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED] resize-y" />
            <div className="flex gap-2">
              <button onClick={() => void saveEdit()} disabled={busy === 'edit'} className="flex-1 py-3 rounded-xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-50">{busy === 'edit' ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(null)} className="px-4 py-3 rounded-xl bg-[#F4E8D0] text-sm font-bold">Cancel</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
