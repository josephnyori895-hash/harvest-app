import { useEffect, useMemo, useRef, useState } from 'react'
import { IgIcon } from './Icons'
import { showToast } from './Toast'
import { fetchMusic, useApi } from '../lib/api'
import { useAuth } from '../state/auth'

// Worship room: the church library (admin uploads) + online search with
// 30-second previews (Apple iTunes Search API — no key required, free).
// Members can play, download and save tracks; only admins upload to the library.

type Track = {
  id: string
  title: string
  artist: string
  artwork?: string
  url?: string | null
  preview?: boolean
  source: 'server' | 'online' | 'local'
  seconds?: number
}

const fmt = (s: number) => (!Number.isFinite(s) || s < 0) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

async function downloadFile(url: string, filename: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('download failed')
  const blob = await r.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.replace(/[^\w\s.-]/g, '').trim() || 'harvest-track'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export default function Music() {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'library' | 'online' | 'saved'>('library')
  const [serverTracks, setServerTracks] = useState<Track[]>([])
  const [loadingServer, setLoadingServer] = useState(false)
  const [online, setOnline] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Track[]>([])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState({ id: null as string | null, seconds: 0, duration: 0 })
  const [downloading, setDownloading] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const useServer = useApi()
  const { isAdmin } = useAuth()

  // ── Admin upload console state ──
  const [showUpload, setShowUpload] = useState(false)
  const [upFile, setUpFile] = useState<File | null>(null)
  const [upCover, setUpCover] = useState<File | null>(null)
  const [upTitle, setUpTitle] = useState('')
  const [upArtist, setUpArtist] = useState('')
  const [upBusy, setUpBusy] = useState(false)
  const [upPct, setUpPct] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editArtist, setEditArtist] = useState('')
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('harvest_token') || ''}` })
  const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

  // Upload one file (audio or cover image) → returns the storage key.
  const uploadBlob = async (file: File, type: 'track' | 'post') => {
    const pr = await fetch(`${API}/api/media/presign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify({ type, contentType: file.type, bytes: file.size, ext: file.name.split('.').pop() }),
    })
    const presign = await pr.json().catch(() => ({}))
    if (!pr.ok) throw new Error(presign.error || 'presign failed')
    const fd = new FormData()
    Object.entries(presign.fields || {}).forEach(([k, v]) => fd.append(k, String(v)))
    fd.append('file', file)
    const direct = /^https?:\/\//.test(presign.url)
    const up = await fetch(direct ? presign.url : `${API}${presign.url}`, { method: 'POST', body: fd, headers: direct ? undefined : authHdr() })
    if (!up.ok) throw new Error('upload failed')
    return presign.key as string
  }

  const submitUpload = async () => {
    if (!upFile || upBusy) return
    if (!upTitle.trim()) { showToast('Give the track a title'); return }
    setUpBusy(true); setUpPct(5)
    try {
      const audioKey = await uploadBlob(upFile, 'track')
      setUpPct(55)
      let coverKey: string | undefined
      if (upCover) coverKey = await uploadBlob(upCover, 'post')
      const cf = await fetch(`${API}/api/media/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ key: audioKey, type: 'track', title: upTitle.trim(), artist: upArtist.trim(), cover_key: coverKey }),
      })
      const d = await cf.json().catch(() => ({}))
      if (!cf.ok) throw new Error(d.error || 'publish failed')
      showToast(`"${upTitle.trim()}" added to the church library 🎵`)
      setShowUpload(false); setUpFile(null); setUpCover(null); setUpTitle(''); setUpArtist(''); setUpPct(0)
      // Reload the church library
      fetchMusic().then(r => {
        const mapped: Track[] = (r.tracks || []).filter((t: any) => t.url).map((t: any) => ({ id: `srv_${t.id}`, title: t.title, artist: t.artist, artwork: t.cover_url, url: t.url, source: 'server' as const }))
        setServerTracks(mapped)
      }).catch(() => {})
    } catch (e: any) { showToast(e?.message || 'Upload failed') } finally { setUpBusy(false); setUpPct(0) }
  }

  const saveEdit = async (serverId: string) => {
    try {
      const r = await fetch(`${API}/api/admin/media/tracks/${serverId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ title: editTitle.trim(), artist: editArtist.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'save failed')
      setServerTracks(ts => ts.map(t => t.id === `srv_${serverId}` ? { ...t, title: editTitle.trim() || t.title, artist: editArtist.trim() || t.artist } : t))
      showToast('Track updated')
      setEditingId(null)
    } catch (e: any) { showToast(e?.message || 'Could not save') }
  }

  const deleteTrack = async (serverId: string, title: string) => {
    if (!window.confirm(`Delete "${title}" permanently? This also removes the audio file.`)) return
    try {
      const r = await fetch(`${API}/api/admin/media/tracks/${serverId}`, { method: 'DELETE', headers: authHdr() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'delete failed')
      setServerTracks(ts => ts.filter(t => t.id !== `srv_${serverId}`))
      showToast(`"${title}" deleted`)
    } catch (e: any) { showToast(e?.message || 'Could not delete') }
  }

  // Personal library persisted on-device.
  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem('harvest_saved_tracks') || '[]')) } catch {}
  }, [])

  // Church library (admin uploads).
  useEffect(() => {
    if (!useServer) return
    let cancelled = false
    setLoadingServer(true)
    fetchMusic()
      .then(r => {
        if (cancelled) return
        const mapped: Track[] = (r.tracks || []).filter((t: any) => t.url).map((t: any) => ({
          id: `srv_${t.id}`, title: t.title, artist: t.artist, artwork: t.cover_url, url: t.url, source: 'server' as const,
        }))
        setServerTracks(mapped)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingServer(false) })
    return () => { cancelled = true }
  }, [useServer])

  // Online search — every result is a FULL-LENGTH, legally downloadable song.
  // 1) Jamendo (best curation + covers) when a key is set at build time
  //    (free at dev.jamendo.com → VITE_JAMENDO_CLIENT_ID).
  // 2) Internet Archive / Free Music Archive — no key needed, CC-licensed,
  //    complete MP3s served with range support. iTunes 30s previews removed.
  const JAMENDO_ID = (import.meta.env.VITE_JAMENDO_CLIENT_ID || '').trim()
  const parseIaLength = (v: any): number => {
    const s = String(v ?? '')
    if (s.includes(':')) { const [m, sec] = s.split(':'); return (Number(m) || 0) * 60 + (Number(sec) || 0) }
    return Math.round(Number(s) || 0)
  }
  const searchOnline = async (term: string) => {
    const needle = term.trim()
    if (!needle) return
    setSearching(true); setError(''); setSearched(true)
    try {
      if (JAMENDO_ID) {
        const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(JAMENDO_ID)}&format=json&limit=25&search=${encodeURIComponent(needle)}&audioformat=mp32&include=musicinfo`)
        const data = await r.json()
        const tracks: Track[] = (data.results || []).map((x: any) => ({
          id: `jam_${x.id}`,
          title: x.name,
          artist: x.artist_name || 'Jamendo artist',
          artwork: x.image || undefined,
          url: x.audio || null,
          seconds: Number(x.duration) || undefined,
          source: 'online' as const,
        }))
        if (tracks.length) { setOnline(tracks); return }
      }
      // Internet Archive / Free Music Archive: search items, then read each
      // item's file list for a playable full-length MP3.
      const q = `collection:(freemusicarchive) AND mediatype:audio AND (title:("${needle.replace(/"/g, '')}") OR creator:("${needle.replace(/"/g, '')}") OR subject:("${needle.replace(/"/g, '')}"))`
      const sr = await fetch(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=18&page=1&output=json&sort[]=downloads+desc`)
      const sd = await sr.json()
      const docs: any[] = sd?.response?.docs || []
      const settled = await Promise.allSettled(docs.slice(0, 12).map(async (doc) => {
        const mr = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`)
        const md = await mr.json()
        const audio = (md?.files || []).find((f: any) => f.name?.toLowerCase().endsWith('.mp3'))
          || (md?.files || []).find((f: any) => f.name?.toLowerCase().endsWith('.ogg'))
        if (!audio) throw new Error('no audio')
        return {
          id: `ia_${doc.identifier}`,
          title: String(doc.title || audio.name || 'Untitled').slice(0, 90),
          artist: String(doc.creator || md?.metadata?.creator || 'Archive artist').replace(/^\[|\]$/g, '').slice(0, 70),
          artwork: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
          url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(audio.name)}`,
          seconds: parseIaLength(audio.length),
          source: 'online' as const,
        } as Track
      }))
      setOnline(settled.filter(s => s.status === 'fulfilled').map(s => (s as PromiseFulfilledResult<Track>).value))
    } catch {
      setError('Online search failed — check your connection')
      setOnline([])
    } finally { setSearching(false) }
  }

  // Single shared audio element; cleaned up on unmount.
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null }, [])

  const [nowPlaying, setNowPlaying] = useState<Track | null>(null)
  const togglePlay = (track: Track) => {
    setError('')
    if (!track.url) { showToast('This track has no audio source yet'); return }
    if (playingId === track.id) { audioRef.current?.pause(); setPlayingId(null); return }
    audioRef.current?.pause()
    const audio = new Audio(track.url)
    audio.onended = () => { setPlayingId(null); setProgress(p => ({ ...p, id: null, seconds: 0 })) }
    audio.ontimeupdate = () => setProgress({ id: track.id, seconds: audio.currentTime, duration: audio.duration || 0 })
    audio.onerror = () => { setPlayingId(null); setError(`Unable to play "${track.title}". Try another track.`) }
    audio.play().then(() => { audioRef.current = audio; setPlayingId(track.id); setNowPlaying(track) }).catch(() => showToast('Tap again to allow audio playback'))
  }
  const seek = (fraction: number) => {
    const a = audioRef.current
    if (a && Number.isFinite(a.duration) && a.duration > 0) a.currentTime = Math.min(Math.max(fraction * a.duration, 0), a.duration)
  }
  const stopAndClosePlayer = () => {
    audioRef.current?.pause()
    setPlayingId(null); setNowPlaying(null); setProgress({ id: null, seconds: 0, duration: 0 })
  }

  const doDownload = async (track: Track) => {
    if (!track.url) { showToast('No audio source for this track'); return }
    setDownloading(track.id)
    try {
      await downloadFile(track.url, `${track.title} - ${track.artist}.mp3`)
      showToast('Downloaded ✓ Check your Downloads folder')
    } catch {
      // Some CDNs block cross-origin downloads — open in the browser instead.
      try { window.open(track.url, '_blank') ; showToast('Opened in browser — use the player\'s download there') }
      catch { showToast('Download failed — try again') }
    } finally { setDownloading('') }
  }

  const saveTrack = (track: Track) => {
    if (saved.some(t => t.id === track.id)) { showToast('Already in your saved list'); return }
    const next = [track, ...saved].slice(0, 100)
    setSaved(next)
    localStorage.setItem('harvest_saved_tracks', JSON.stringify(next))
    showToast(`"${track.title}" saved`)
  }

  const unsave = (id: string) => {
    const next = saved.filter(t => t.id !== id)
    setSaved(next)
    localStorage.setItem('harvest_saved_tracks', JSON.stringify(next))
  }

  const allLibrary = useMemo(() => {
    const seen = new Set<string>()
    return [...serverTracks, ...saved.filter(t => t.source !== 'server')].filter(t => {
      const k = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
      if (seen.has(k)) return false
      seen.add(k); return true
    })
  }, [serverTracks, saved])

  const listFor = (t: Track[]): Track[] => t
  const filtered = (tracks: Track[]) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tracks
    return tracks.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(needle))
  }

  const TrackRow = ({ track }: { track: Track }) => {
    const isPlaying = playingId === track.id
    const showBar = progress.id === track.id && isPlaying
    const pct = showBar && progress.duration > 0 ? (progress.seconds / progress.duration) * 100 : 0
    const serverId = track.id.startsWith('srv_') ? track.id.slice(4) : null
    // Only library tracks can be edited; never match the null default (which
    // previously put every online/saved track into edit mode).
    const isEditing = serverId !== null && editingId === serverId
    if (isEditing) {
      return (
        <div className="p-4 rounded-2xl bg-white border-2 border-purple-300 shadow-sm space-y-2">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-purple-700">Editing track</p>
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none placeholder:text-neutral-500 focus:border-purple-500" />
          <input value={editArtist} onChange={e => setEditArtist(e.target.value)} placeholder="Artist" className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none placeholder:text-neutral-500 focus:border-purple-500" />
          <div className="flex gap-2">
            <button onClick={() => serverId && void saveEdit(serverId)} className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white text-xs font-extrabold">Save</button>
            <button onClick={() => setEditingId(null)} className="px-4 py-2.5 rounded-xl bg-neutral-100 text-neutral-600 text-xs font-bold">Cancel</button>
          </div>
        </div>
      )
    }
    return (
      <div className="flex gap-3 p-4 items-center rounded-2xl bg-white border border-neutral-200 shadow-sm">
        <div className="relative shrink-0">
          {track.artwork
            ? <img src={track.artwork} alt="" className="w-14 h-14 rounded-xl object-cover shadow-md" />
            : <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-white text-xl">🎵</div>}
          <button onClick={() => togglePlay(track)} className={`absolute inset-0 flex items-center justify-center rounded-xl ${isPlaying ? 'bg-purple-600/90' : 'bg-black/35'}`} aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>
            <span className="text-white text-xl">{isPlaying ? '⏸' : '▶'}</span>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-neutral-900 truncate text-sm">{track.title}</p>
          <p className="text-xs text-neutral-600 truncate">{track.artist}{track.seconds ? ` · ${fmt(track.seconds)}` : ''}</p>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            {track.source === 'server' && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">CHURCH LIBRARY</span>}
            {track.preview && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">30s PREVIEW</span>}
            {track.source === 'online' && !track.preview && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">FULL SONG ✓</span>}
            {track.source === 'local' && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">SAVED</span>}
          </div>
          {showBar && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 bg-neutral-200 rounded-full overflow-hidden"><div className="h-full bg-purple-600" style={{ width: `${pct}%` }} /></div>
              <span className="text-[10px] text-neutral-500 font-mono">{fmt(progress.seconds)}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={() => void doDownload(track)} disabled={downloading === track.id} className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-sm disabled:opacity-50" aria-label={`Download ${track.title}`}>{downloading === track.id ? '…' : '⬇'}</button>
          {tab === 'saved'
            ? <button onClick={() => unsave(track.id)} className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-sm" aria-label={`Remove ${track.title} from saved`}>✕</button>
            : <button onClick={() => saveTrack(track)} className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-sm" aria-label={`Save ${track.title}`}>＋</button>}
          {isAdmin && serverId && (
            <>
              <button onClick={() => { setEditingId(serverId); setEditTitle(track.title); setEditArtist(track.artist) }} className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center text-sm" aria-label={`Edit ${track.title}`}>✏️</button>
              <button onClick={() => void deleteTrack(serverId, track.title)} className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center text-sm" aria-label={`Delete ${track.title}`}>🗑</button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-49px)] bg-gradient-to-b from-amber-50 to-purple-50 text-neutral-900">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-neutral-200 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center text-white font-bold">🎵</div>
            <h1 className="text-xl font-extrabold truncate">Worship Room</h1>
          </div>
        </div>
        {tab === 'online' && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2 scrollbar-none">
            {['Worship', 'Gospel', 'Hymns', 'Praise', 'Choir', 'Instrumental'].map(g => (
              <button key={g} onClick={() => { setQ(g); void searchOnline(g) }} disabled={searching} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${q === g ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-200'}`}>{g}</button>
            ))}
          </div>
        )}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-white border-2 border-neutral-200 rounded-xl px-3 py-2.5 focus-within:border-purple-500 transition">
            <IgIcon name="search" active={false} size={20} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && tab === 'online') void searchOnline(q) }}
              placeholder={tab === 'online' ? 'Search songs worldwide… (press enter)' : 'Search songs, artists…'}
              className="min-w-0 flex-1 bg-transparent outline-none text-sm"
            />
            {q && <button onClick={() => { setQ(''); if (tab === 'online') { setOnline([]); setSearched(false) } }} className="text-neutral-400 text-sm">✕</button>}
          </div>
          {tab === 'online' && <button onClick={() => void searchOnline(q)} disabled={searching} className="px-4 rounded-xl bg-purple-600 text-white text-xs font-bold disabled:opacity-50">{searching ? '…' : 'Search'}</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
      {nowPlaying && (
        <div className="sticky top-[calc(100vh-140px)] z-20 mx-4 mt-4 mb-1">
          <div className="rounded-2xl bg-neutral-900 text-white shadow-2xl border border-neutral-700 px-3 py-2.5">
            <div className="flex items-center gap-3">
              {nowPlaying.artwork
                ? <img src={nowPlaying.artwork} alt="" className="w-10 h-10 rounded-lg object-cover" />
                : <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-purple-600 flex items-center justify-center">🎵</div>}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{nowPlaying.title}</p>
                <p className="text-[10px] text-neutral-400 truncate">{nowPlaying.artist}{progress.duration > 0 ? ` · ${fmt(progress.seconds)} / ${fmt(progress.duration)}` : ''}</p>
              </div>
              <button onClick={() => togglePlay(nowPlaying)} className="w-9 h-9 rounded-full bg-white text-neutral-900 flex items-center justify-center font-bold shrink-0" aria-label={playingId ? 'Pause' : 'Play'}>{playingId ? '⏸' : '▶'}</button>
              <button onClick={stopAndClosePlayer} className="w-7 h-7 rounded-full bg-neutral-800 text-neutral-400 flex items-center justify-center text-xs shrink-0" aria-label="Close player">✕</button>
            </div>
            <div
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.duration > 0 ? Math.round((progress.seconds / progress.duration) * 100) : 0}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }}
              className="mt-2 h-1.5 bg-neutral-700 rounded-full overflow-hidden cursor-pointer"
            >
              <div className="h-full bg-gradient-to-r from-amber-400 to-purple-500" style={{ width: progress.duration > 0 ? `${(progress.seconds / progress.duration) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>
      )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([
            ['library', `⛪ Church library${serverTracks.length ? ` (${serverTracks.length})` : ''}`],
            ['online', '🌍 Search online'],
            ['saved', `🎧 Saved${saved.length ? ` (${saved.length})` : ''}`],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as any)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all ${tab === t ? 'bg-gradient-to-r from-amber-400 to-purple-600 text-white shadow-lg' : 'bg-white text-neutral-700 border border-neutral-200'}`}>
              {label}
            </button>
          ))}
          {isAdmin && tab === 'library' && (
            <button onClick={() => setShowUpload(s => !s)} className={`shrink-0 px-4 py-2 rounded-full text-sm font-extrabold transition-all ${showUpload ? 'bg-neutral-900 text-white' : 'bg-purple-600 text-white shadow-lg'}`}>
              {showUpload ? '✕ Close' : '＋ Add music'}
            </button>
          )}
        </div>
      </div>

      {/* Persistent mini-player — stays while browsing tabs, seekable, dismissible */}
      {isAdmin && showUpload && tab === 'library' && (
        <div className="mx-4 mt-4 p-4 rounded-2xl bg-white border-2 border-purple-200 shadow-lg space-y-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-purple-700">Add to church library</p>
          <div className="flex gap-3 items-start">
            <button onClick={() => coverInputRef.current?.click()} className="shrink-0 w-20 h-20 rounded-xl bg-gradient-to-br from-amber-100 to-purple-100 border-2 border-dashed border-purple-300 flex items-center justify-center overflow-hidden" aria-label="Choose cover art">
              {upCover
                ? <img src={URL.createObjectURL(upCover)} alt="" className="w-full h-full object-cover" />
                : <span className="text-2xl">🖼️</span>}
            </button>
            <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setUpCover(e.target.files?.[0] || null)} className="hidden" />
            <div className="flex-1 space-y-2">
              <input value={upTitle} onChange={e => setUpTitle(e.target.value)} placeholder="Track title *" className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none placeholder:text-neutral-500 focus:border-purple-500" />
              <input value={upArtist} onChange={e => setUpArtist(e.target.value)} placeholder="Artist / ministry (optional)" className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none placeholder:text-neutral-500 focus:border-purple-500" />
            </div>
          </div>
          <button onClick={() => audioInputRef.current?.click()} className={`w-full py-3 rounded-xl border-2 border-dashed text-sm font-semibold ${upFile ? 'border-green-400 bg-green-50 text-green-700' : 'border-neutral-300 text-neutral-500'}`}>
            {upFile ? `🎵 ${upFile.name} (${(upFile.size / 1024 / 1024).toFixed(1)} MB) — tap to change` : '🎵 Choose audio file (MP3, M4A, WAV — up to 20 MB)'}
          </button>
          <input ref={audioInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/m4a,audio/x-m4a,audio/mp4,audio/wav,audio/aac,audio/ogg" onChange={e => setUpFile(e.target.files?.[0] || null)} className="hidden" />
          {upBusy && (
            <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden"><div className="h-full bg-purple-600 transition-all" style={{ width: `${upPct}%` }} /></div>
          )}
          <button onClick={() => void submitUpload()} disabled={upBusy || !upFile || !upTitle.trim()} className="w-full py-3 rounded-full bg-purple-600 text-white text-sm font-extrabold disabled:opacity-40">
            {upBusy ? `Uploading… ${upPct}%` : 'Add to library'}
          </button>
        </div>
      )}

      <div className="px-4 py-5 space-y-3">
        {error && <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {tab === 'library' && (
          loadingServer ? <p className="text-center text-sm text-neutral-500 py-10">Loading the church library…</p>
            : filtered(listFor(allLibrary)).length === 0 ? (
              <div className="text-center py-12"><div className="text-6xl mb-4">🎶</div><p className="text-neutral-500 font-medium">{q ? 'No matches in the church library' : 'The church library is empty'}</p><p className="text-sm text-neutral-400 mt-1">Worship tracks uploaded by your leaders appear here</p></div>
            ) : filtered(listFor(allLibrary)).map(t => <TrackRow key={t.id} track={t} />)
        )}

        {tab === 'online' && (
          searching ? <p className="text-center text-sm text-neutral-500 py-10">Searching the web…</p>
            : online.length === 0 ? (
              <div className="text-center py-12"><div className="text-6xl mb-4">🌍</div>              <p className="text-neutral-500 font-medium">{searched ? 'No results — try another search' : 'Search free full-length songs'}</p><p className="text-sm text-neutral-400 mt-1">Every result plays in full and downloads complete — no 30-second previews. Try "Worship", "Gospel", "Hymns"…</p></div>
            ) : online.map(t => <TrackRow key={t.id} track={t} />)
        )}

        {tab === 'saved' && (
          saved.length === 0 ? (
            <div className="text-center py-12"><div className="text-6xl mb-4">🎧</div><p className="text-neutral-500 font-medium">Nothing saved yet</p><p className="text-sm text-neutral-400 mt-1">Tap ＋ on any track to keep it here</p></div>
          ) : saved.map(t => <TrackRow key={t.id} track={t} />)
        )}
      </div>
    </div>
  )
}
