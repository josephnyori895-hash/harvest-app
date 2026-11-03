import { useEffect, useMemo, useRef, useState } from 'react'
import { showToast } from './Toast'
import { fetchMusic, useApi } from '../lib/api'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { useAuth } from '../state/auth'
import {
  playFromQueue, playTrack, togglePlay as togglePlayGlobal, seekToFraction, seekTo, closePlayer,
  previousTrack, nextTrack, subscribePlayer, getLastPlayed,
  type PlayerState, type PlayerTrack,
} from '../lib/audioPlayer'
import { stopFeedPlayback } from '../lib/feedPlayback'
import { Icon } from '../ui'
import TrackArt from './TrackArt'

// Worship room — the church library, daily listening and online search.
//
// Daily listening is the whole design goal: a Continue-listening card that
// resumes where the member stopped, a date-seeded "Today's worship" rotation
// that is different every morning, Play-all through the global queue so one tap
// never dead-ends, and a now-playing bar with prev/next that follows them
// across every tab.

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

const toPlayer = (t: Track): PlayerTrack => ({
  id: t.id, title: t.title, artist: t.artist, url: t.url || null, artwork: t.artwork || null, origin: 'music',
})

const mapServer = (rows: any[]): Track[] => (rows || [])
  .filter((t: any) => t.url)
  .map((t: any) => ({ id: `srv_${t.id}`, title: t.title, artist: t.artist, artwork: t.cover_url, url: t.url, source: 'server' as const }))

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

/** Date-seeded shuffle: the same shelf all day, a new one tomorrow. */
function seededShuffle<T>(items: T[], seed: number, take: number): T[] {
  const arr = [...items]
  let s = (seed % 2147483647) || 7
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, Math.min(take, arr.length))
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
  const [downloading, setDownloading] = useState('')
  const [continueAt, setContinueAt] = useState(0)
  const useServer = useApi()
  const { isAdmin } = useAuth()

  // Audio lives in the global player (lib/audioPlayer) so backing out of this
  // screen — or switching tabs — never stops whatever the member is hearing.
  const [player, setPlayer] = useState<PlayerState>({ track: null, playing: false, currentTime: 0, duration: 0, error: null })
  useEffect(() => subscribePlayer(setPlayer), [])

  const activeTrack = player.track as (PlayerTrack & { seconds?: number }) | null
  const playingId: string | null = activeTrack && player.playing ? activeTrack.id : null
  const progress = activeTrack
    ? { id: activeTrack.id, seconds: player.currentTime, duration: player.duration || 0 }
    : { id: null as string | null, seconds: 0, duration: 0 }

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

  const submitUpload = async () => {
    if (!upFile || upBusy) return
    if (!upTitle.trim()) { showToast('Give the track a title'); return }
    setUpBusy(true); setUpPct(5)
    const title = upTitle.trim()
    const artist = upArtist.trim()
    const audio = upFile
    const cover = upCover
    try {
      void startBackgroundUpload({
        label: `music: ${title}`,
        successMsg: `"${title}" added to the church library 🎵`,
        task: { kind: 'track', file: audio, title, artist: artist || 'Harvest Worship', cover: cover || undefined },
      }).catch(() => {})
      setShowUpload(false); setUpFile(null); setUpCover(null); setUpTitle(''); setUpArtist(''); setUpPct(0)
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
    setContinueAt(getLastPlayed()?.position || 0)
  }, [])

  // Church library (admin uploads).
  useEffect(() => {
    if (!useServer) return
    let cancelled = false
    setLoadingServer(true)
    fetchMusic()
      .then(r => { if (!cancelled) setServerTracks(mapServer(r.tracks as any[])) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingServer(false) })
    return () => { cancelled = true }
  }, [useServer])

  // A background track upload just published — refresh the library.
  useEffect(() => {
    const bump = () => { fetchMusic().then(r => setServerTracks(mapServer(r.tracks as any[]))).catch(() => {}) }
    window.addEventListener('harvest:tracks-updated', bump)
    return () => window.removeEventListener('harvest:tracks-updated', bump)
  }, [])

  // Online search — every result is a FULL-LENGTH, legally downloadable song.
  // 1) Jamendo when a key is set at build time (VITE_JAMENDO_CLIENT_ID).
  // 2) Internet Archive / Free Music Archive — no key needed, CC-licensed.
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
          id: `jam_${x.id}`, title: x.name, artist: x.artist_name || 'Jamendo artist',
          artwork: x.image || undefined, url: x.audio || null, seconds: Number(x.duration) || undefined, source: 'online' as const,
        }))
        if (tracks.length) { setOnline(tracks); return }
      }
      const qry = `collection:(freemusicarchive) AND mediatype:audio AND (title:("${needle.replace(/"/g, '')}") OR creator:("${needle.replace(/"/g, '')}") OR subject:("${needle.replace(/"/g, '')}"))`
      const sr = await fetch(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(qry)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=18&page=1&output=json&sort[]=downloads+desc`)
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

  const startOne = (track: Track) => {
    setError('')
    stopFeedPlayback()
    void playTrack(toPlayer(track))
  }
  const togglePlay = (track: Track) => {
    if (activeTrack?.id === track.id) { void togglePlayGlobal(); return }
    startOne(track)
  }
  const playShelf = (tracks: Track[], startIndex = 0) => {
    stopFeedPlayback()
    void playFromQueue(tracks.map(toPlayer), startIndex)
  }
  const seek = (fraction: number) => seekToFraction(fraction)

  const resumeLast = () => {
    const last = getLastPlayed()
    if (!last?.track?.url) return
    stopFeedPlayback()
    // playTrack always starts at 0, so restore the saved position after it
    // accepts the play (autoplay policies can reject it).
    void playTrack(last.track).then(ok => { if (ok && last.position > 3) seekTo(last.position) })
  }

  const doDownload = async (track: Track) => {
    if (!track.url) { showToast('No audio source for this track'); return }
    setDownloading(track.id)
    try {
      await downloadFile(track.url, `${track.title} - ${track.artist}.mp3`)
      showToast('Downloaded ✓ Check your Downloads folder')
    } catch {
      try { window.open(track.url, '_blank'); showToast("Opened in browser — use the player's download there") }
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

  const daySeed = Math.floor(Date.now() / 86400000)
  const todaysWorship = useMemo(() => seededShuffle(allLibrary, daySeed, 8), [allLibrary, daySeed])
  const lastPlayed = useMemo(() => getLastPlayed(), [player.track?.id])
  const filtered = (tracks: Track[]) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tracks
    return tracks.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(needle))
  }

  const TrackRow = ({ track, index, shelf }: { track: Track; index?: number; shelf?: Track[] }) => {
    const isPlaying = playingId === track.id
    const showBar = progress.id === track.id
    const pct = showBar && progress.duration > 0 ? (progress.seconds / progress.duration) * 100 : 0
    const serverId = track.id.startsWith('srv_') ? track.id.slice(4) : null
    const isEditing = serverId !== null && editingId === serverId
    const isSaved = saved.some(t => t.id === track.id)
    if (isEditing) {
      return (
        <div className="rounded-card border border-line bg-surface-raised p-4" data-testid="track-editor">
          <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">Editing track</p>
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" className="input-base mt-2" aria-label="Track title" />
          <input value={editArtist} onChange={e => setEditArtist(e.target.value)} placeholder="Artist" className="input-base mt-2" aria-label="Track artist" />
          <div className="mt-3 flex gap-2">
            <button onClick={() => serverId && void saveEdit(serverId)} className="min-h-10 flex-1 rounded-full bg-accent text-2xs font-extrabold text-white">Save</button>
            <button onClick={() => setEditingId(null)} className="min-h-10 rounded-full border border-line px-4 text-2xs font-extrabold text-ink-muted">Cancel</button>
          </div>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-2.5" data-testid="track-row">
        <button
          onClick={() => togglePlay(track)}
          aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-sunken"
        >
          <TrackArt src={track.artwork} title={track.title} className="h-full w-full" iconSize={20} />
          <span className={`absolute inset-0 grid place-items-center ${isPlaying ? 'bg-ink/45' : 'bg-ink/25'}`}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={18} className="text-white" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-extrabold text-ink">{track.title}</p>
          <p className="truncate text-2xs text-ink-muted">
            {track.artist}{track.seconds ? ` · ${fmt(track.seconds)}` : ''}
            {track.source === 'server' ? ' · Church library' : track.source === 'online' ? ' · Full song' : ''}
          </p>
          {showBar && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
              <span className="text-2xs text-ink-subtle tabular-nums">{fmt(progress.seconds)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shelf && shelf.length > 1 && typeof index === 'number' && (
            <button onClick={() => playShelf(shelf, index)} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken" aria-label={`Play from ${track.title}`}><Icon name="play" size={16} /></button>
          )}
          <button onClick={() => void doDownload(track)} disabled={downloading === track.id} aria-label={`Download ${track.title}`} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken disabled:opacity-40">
            <Icon name="share" size={16} />
          </button>
          <button
            onClick={() => (isSaved ? unsave(track.id) : saveTrack(track))}
            aria-pressed={isSaved}
            aria-label={isSaved ? `Remove ${track.title} from saved` : `Save ${track.title}`}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken"
          >
            <Icon name="heart" size={18} strokeWidth={isSaved ? 2.4 : 1.7} className={isSaved ? 'fill-current text-danger' : ''} />
          </button>
          {isAdmin && serverId && (
            <button onClick={() => { setEditingId(serverId); setEditTitle(track.title); setEditArtist(track.artist) }} aria-label={`Edit ${track.title}`} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken">
              <Icon name="dots" size={18} />
            </button>
          )}
          {isAdmin && serverId && (
            <button onClick={() => void deleteTrack(serverId, track.title)} aria-label={`Delete ${track.title}`} className="grid h-9 w-9 place-items-center rounded-full text-danger hover:bg-surface-sunken">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const playingNow = Boolean(activeTrack)
  return (
    <div className="min-h-[calc(100dvh-72px)] bg-surface pb-28 text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight">Worship</h1>
            <p className="text-2xs text-ink-muted">Songs that carry your week</p>
          </div>
          {isAdmin && tab === 'library' && (
            <button onClick={() => setShowUpload(s => !s)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 text-2xs font-extrabold text-white">
              <Icon name={showUpload ? 'close' : 'plus'} size={14} /> {showUpload ? 'Close' : 'Add'}
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3.5">
          <Icon name="search" size={18} className="text-ink-subtle" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && tab === 'online') void searchOnline(q) }}
            placeholder={tab === 'online' ? 'Search songs worldwide…' : 'Search songs, artists…'}
            className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
            aria-label="Search worship music"
          />
          {q && <button onClick={() => { setQ(''); if (tab === 'online') { setOnline([]); setSearched(false) } }} aria-label="Clear search" className="shrink-0 text-ink-subtle"><Icon name="close" size={16} /></button>}
          {tab === 'online' && <button onClick={() => void searchOnline(q)} disabled={searching} className="shrink-0 text-2xs font-extrabold text-accent disabled:opacity-50">{searching ? '…' : 'Search'}</button>}
        </div>
        <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Worship sections">
          {([
            ['library', 'Church library', serverTracks.length],
            ['saved', 'Saved', saved.length],
            ['online', 'Discover', 0],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id as any)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-2xs font-extrabold transition ${tab === id ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
            >
              {label}{count ? <span className="opacity-70">{count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      {isAdmin && showUpload && tab === 'library' && (
        <div className="mx-4 mt-4 space-y-3 rounded-card border border-line bg-surface-raised p-4">
          <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">Add to church library</p>
          <div className="flex items-start gap-3">
            <button onClick={() => coverInputRef.current?.click()} aria-label="Choose cover art" className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-sunken">
              {upCover ? <img src={URL.createObjectURL(upCover)} alt="" className="h-full w-full object-cover" /> : <Icon name="camera" size={20} className="text-ink-muted" />}
            </button>
            <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setUpCover(e.target.files?.[0] || null)} className="hidden" />
            <div className="min-w-0 flex-1 space-y-2">
              <input value={upTitle} onChange={e => setUpTitle(e.target.value)} placeholder="Track title *" className="input-base" aria-label="New track title" />
              <input value={upArtist} onChange={e => setUpArtist(e.target.value)} placeholder="Artist / ministry (optional)" className="input-base" aria-label="New track artist" />
            </div>
          </div>
          <button onClick={() => audioInputRef.current?.click()} className="w-full rounded-xl border border-dashed border-line bg-surface-sunken px-3 py-3 text-2xs font-bold text-ink-muted">
            {upFile ? `${upFile.name} · ${(upFile.size / 1024 / 1024).toFixed(1)} MB — tap to change` : 'Choose audio file (MP3, M4A, WAV — up to 20 MB)'}
          </button>
          <input ref={audioInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/m4a,audio/x-m4a,audio/mp4,audio/wav,audio/aac,audio/ogg" onChange={e => setUpFile(e.target.files?.[0] || null)} className="hidden" />
          {upBusy && <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full bg-accent transition-all" style={{ width: `${upPct}%` }} /></div>}
          <button onClick={() => void submitUpload()} disabled={upBusy || !upFile || !upTitle.trim()} className="min-h-11 w-full rounded-full bg-accent text-sm font-extrabold text-white disabled:opacity-40">
            {upBusy ? `Uploading… ${upPct}%` : 'Add to library'}
          </button>
        </div>
      )}

      <div className="space-y-4 px-4 py-4">
        {error && <div role="status" className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}</div>}

        {/* Continue listening — the reason to come back tomorrow. */}
        {lastPlayed && tab === 'library' && (
          <section className="overflow-hidden rounded-card border border-line bg-surface-raised" data-testid="continue-listening">
            <div className="flex items-center gap-3 p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-sunken">
                <TrackArt src={lastPlayed.track.artwork} title={lastPlayed.track.title} className="h-full w-full" iconSize={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">Continue listening</p>
                <p className="truncate text-caption font-extrabold text-ink">{lastPlayed.track.title}</p>
                <p className="truncate text-2xs text-ink-muted">{lastPlayed.track.artist || 'Harvest Worship'}{continueAt > 3 ? ` · resume at ${fmt(continueAt)}` : ''}</p>
              </div>
              <button onClick={resumeLast} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white" aria-label="Resume last worship track">
                <Icon name="play" size={18} />
              </button>
            </div>
          </section>
        )}

        {/* Today's worship — a fresh rotation each morning. */}
        {tab === 'library' && todaysWorship.length > 0 && (
          <section data-testid="todays-worship">
            <div className="flex items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-ink">Today’s worship</h2>
                <p className="text-2xs text-ink-muted">A new set every morning · {todaysWorship.length} tracks</p>
              </div>
              <button onClick={() => playShelf(todaysWorship)} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-2xs font-extrabold text-white">
                <Icon name="play" size={13} /> Play all
              </button>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {todaysWorship.map((t, i) => {
                const isPlaying = playingId === t.id
                return (
                  <button key={t.id} onClick={() => playShelf(todaysWorship, i)} className="w-28 shrink-0 text-left" aria-label={`Play ${t.title}`}>
                    <span className="relative block h-28 w-28 overflow-hidden rounded-xl bg-surface-sunken">
                      <TrackArt src={t.artwork} title={t.title} className="h-full w-full" iconSize={22} />
                      <span className={`absolute inset-0 grid place-items-center ${isPlaying ? 'bg-ink/40' : 'bg-transparent'}`}>
                        {isPlaying && <Icon name="pause" size={18} className="text-white" />}
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-2xs font-extrabold text-ink">{t.title}</span>
                    <span className="block truncate text-2xs text-ink-muted">{t.artist}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {tab === 'library' && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-ink">Church library</h2>
              {filtered(allLibrary).length > 0 && (
                <button onClick={() => playShelf(filtered(allLibrary))} className="text-2xs font-extrabold text-accent">Play all</button>
              )}
            </div>
            {loadingServer ? <p className="py-8 text-center text-sm text-ink-muted">Loading the church library…</p>
              : filtered(allLibrary).length === 0 ? (
                <div className="rounded-card border border-line bg-surface-raised px-4 py-10 text-center">
                  <Icon name="music" size={26} className="mx-auto text-ink-subtle" />
                  <p className="mt-3 text-sm font-extrabold text-ink">{q ? 'No matches in the church library' : 'The church library is empty'}</p>
                  <p className="mt-1 text-2xs text-ink-muted">Worship tracks uploaded by your leaders appear here</p>
                </div>
              ) : filtered(allLibrary).map((t, i) => <TrackRow key={t.id} track={t} index={i} shelf={filtered(allLibrary)} />)}
          </section>
        )}

        {tab === 'online' && (
          <section className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {['Worship', 'Gospel', 'Hymns', 'Praise', 'Choir', 'Instrumental'].map(g => (
                <button key={g} onClick={() => { setQ(g); void searchOnline(g) }} disabled={searching} className={`min-h-9 shrink-0 rounded-full px-3.5 text-2xs font-extrabold ${q === g ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted'}`}>{g}</button>
              ))}
            </div>
            {searching ? <p className="py-8 text-center text-sm text-ink-muted">Searching the web…</p>
              : online.length === 0 ? (
                <div className="rounded-card border border-line bg-surface-raised px-4 py-10 text-center">
                  <Icon name="globe" size={26} className="mx-auto text-ink-subtle" />
                  <p className="mt-3 text-sm font-extrabold text-ink">{searched ? 'No results — try another search' : 'Discover full-length worship'}</p>
                  <p className="mt-1 text-2xs text-ink-muted">Every result plays in full and downloads complete. Try “Worship”, “Gospel”, “Hymns”…</p>
                </div>
              ) : online.map((t, i) => <TrackRow key={t.id} track={t} index={i} shelf={online} />)}
          </section>
        )}

        {tab === 'saved' && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-ink">Saved songs</h2>
              {saved.length > 0 && <button onClick={() => playShelf(saved)} className="text-2xs font-extrabold text-accent">Play all</button>}
            </div>
            {saved.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised px-4 py-10 text-center">
                <Icon name="heart" size={26} className="mx-auto text-ink-subtle" />
                <p className="mt-3 text-sm font-extrabold text-ink">Nothing saved yet</p>
                <p className="mt-1 text-2xs text-ink-muted">Tap the heart on any track to keep it here</p>
              </div>
            ) : saved.map((t, i) => <TrackRow key={t.id} track={t} index={i} shelf={saved} />)}
          </section>
        )}
      </div>

      {/* Persistent mini-player — stays while browsing tabs, seekable, dismissible */}
      {playingNow && (
        <div className="fixed inset-x-0 bottom-[calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))+124px)] z-30 px-3">
          <div className="mx-auto max-w-lg rounded-2xl border border-line bg-ink px-3 py-2 text-surface shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
                <TrackArt src={activeTrack?.artwork} title={activeTrack?.title} className="h-full w-full" iconSize={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-extrabold">{activeTrack?.title}</p>
                <p className="truncate text-2xs text-surface/60">{activeTrack?.artist}{progress.duration > 0 ? ` · ${fmt(progress.seconds)} / ${fmt(progress.duration)}` : ''}</p>
              </div>
              <button onClick={() => void previousTrack()} aria-label="Previous track" disabled={!player.hasPrev} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-surface/70 disabled:opacity-30"><Icon name="arrow-left" size={16} /></button>
              <button onClick={() => void togglePlayGlobal()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-ink" aria-label={player.playing ? 'Pause' : 'Play'}>
                <Icon name={player.playing ? 'pause' : 'play'} size={16} />
              </button>
              <button onClick={() => void nextTrack()} aria-label="Next track" disabled={!player.hasNext} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-surface/70 disabled:opacity-30"><Icon name="arrow-right" size={16} /></button>
              <button onClick={closePlayer} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface/10 text-surface/70" aria-label="Close player"><Icon name="close" size={14} /></button>
            </div>
            {player.error && <p className="mt-1 text-2xs text-gold">{player.error}</p>}
            <div
              role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={progress.duration > 0 ? Math.round((progress.seconds / progress.duration) * 100) : 0}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width) }}
              className="mt-2 h-1 cursor-pointer overflow-hidden rounded-full bg-surface/20"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-gold to-accent" style={{ width: progress.duration > 0 ? `${(progress.seconds / progress.duration) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
