// Sermons — the church's teaching library.
//
// Designed to keep someone listening: a "continue listening" strip that resumes
// whatever the global player holds, the newest teaching featured, and compact
// rows that read like a catalogue rather than a stack of forms. Audio keeps
// playing while the member browses (the global player owns the element), so
// every row is a one-tap way back into the Word.
//
// Counts are live: the list pages past the first 50, and teachings, plays,
// downloads and comments refresh quietly in the background.

import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from './Toast'
import { startBackgroundUpload, getUploadHistory, subscribeUploads, retryUpload, sermonKindOf, type UploadHistoryEntry } from '../lib/backgroundUploads'
import { playTrack, togglePlay as togglePlayGlobal, seekToFraction, pausePlayer, subscribePlayer, type PlayerState, type PlayerTrack } from '../lib/audioPlayer'
import { stopFeedPlayback } from '../lib/feedPlayback'
import { timeAgo } from '../lib/time'
import { useAuth } from '../state/auth'
import Comments from './Comments'

import ErrorMessage from './ErrorMessage'
import { Icon, Spinner } from '../ui'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const PAGE = 50

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
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export default function Sermons({ isAdmin, focusId, onFocused }: { isAdmin: boolean; verified?: boolean; focusId?: string | null; onFocused?: () => void }) {
  const { username } = useAuth()
  const [sermons, setSermons] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [commentTarget, setCommentTarget] = useState<any | null>(null)
  const [playerReady, setPlayerReady] = useState<Record<string, boolean>>({})
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadKind, setUploadKind] = useState<'audio' | 'video'>('audio')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadSpeaker, setUploadSpeaker] = useState('')
  const [uploadScripture, setUploadScripture] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [failedSermonUpload, setFailedSermonUpload] = useState<UploadHistoryEntry | null>(null)
  const [dismissedFail, setDismissedFail] = useState('')
  const [canManageSermons, setCanManageSermons] = useState(isAdmin)
  const [managerUsers, setManagerUsers] = useState<any[]>([])
  const [managerBusy, setManagerBusy] = useState('')
  const [managerSearch, setManagerSearch] = useState('')
  const [sermonQuery, setSermonQuery] = useState('')
  const [sermonKind, setSermonKind] = useState<'all' | 'audio' | 'video'>('all')
  const [sermonSort, setSermonSort] = useState<'newest' | 'oldest' | 'largest' | 'smallest' | 'longest' | 'shortest' | 'topic'>('newest')
  const uploadInput = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const loadedRef = useRef(0)
  useEffect(() => { loadedRef.current = sermons.length }, [sermons.length])

  // Audio sermons are routed through the global player singleton
  // (lib/audioPlayer) so leaving this screen — or switching tabs — does not
  // stop playback. Only video needs a local element in the row.
  const [player, setPlayer] = useState<PlayerState>({ track: null, playing: false, currentTime: 0, duration: 0, error: null })
  useEffect(() => subscribePlayer(setPlayer), [])
  const playingAudioId: string | null = (() => {
    const t: PlayerTrack | null = player.track
    if (!t || !player.playing || !t.id.startsWith('sermon:')) return null
    return t.id.slice('sermon:'.length)
  })()
  const playerSermonId = player.track && String(player.track.id).startsWith('sermon:') ? String(player.track.id).slice('sermon:'.length) : null
  const progressPct = player.duration > 0 ? Math.min(100, (player.currentTime / player.duration) * 100) : 0

  const load = useCallback(async (silent = false, opts: { offset?: number; limit?: number } = {}) => {
    const limit = opts.limit ?? PAGE
    const offset = opts.offset ?? 0
    if (!silent && offset === 0) setLoading(true)
    try {
      const r = await fetch(`${API}/api/sermons?limit=${limit}&offset=${offset}`, { headers: authHeaders() })
      if (!r.ok) throw new Error('Could not load sermons')
      const d = await r.json().catch(() => ({}))
      const rows = Array.isArray(d.sermons) ? d.sermons : []
      setTotal(Number(d.total) || rows.length)
      setSermons(prev => (offset > 0 ? [...prev, ...rows.filter(x => !prev.some(p => String(p.id) === String(x.id)))] : rows))
      setError('')
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Could not load sermons')
    } finally {
      if (!silent && offset === 0) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Why an upload died belongs on this screen. Making the admin dig through
  // Profile history to find out is how "it just doesn't upload" happens.
  useEffect(() => {
    const pick = () => setFailedSermonUpload(getUploadHistory().find(h => h.status === 'failed' && /sermon/i.test(h.label)) || null)
    pick()
    return subscribeUploads(pick)
  }, [])

  // Counts on this screen (teachings, plays, downloads, comments) must be live.
  // Refresh quietly instead of freezing at mount.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void load(true, { limit: Math.min(Math.max(loadedRef.current || PAGE, PAGE), 200) })
    }
    const id = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  // A background upload just registered a sermon — refetch so it appears
  // without leaving the screen.
  useEffect(() => {
    const bump = () => { void load(true, { limit: PAGE }) }
    window.addEventListener('harvest:sermons-updated' as any, bump)
    return () => window.removeEventListener('harvest:sermons-updated' as any, bump)
  }, [load])

  const loadMore = async () => {
    if (loadingMore || sermons.length >= total) return
    setLoadingMore(true)
    await load(true, { offset: sermons.length, limit: PAGE })
    setLoadingMore(false)
  }

  // Deep link (e.g. from search): auto-open the requested sermon once loaded.
  useEffect(() => {
    if (!focusId || loading || sermons.length === 0) return
    const target = sermons.find((s: any) => String(s.id) === String(focusId))
    if (target) {
      setPlaying(String(focusId))
      if (target.kind !== 'video' && target.media_url) {
        stopFeedPlayback()
        void playTrack({ id: `sermon:${focusId}`, title: target.title || 'Sermon', artist: target.speaker || 'Harvest Family Church', url: target.media_url, artwork: null, origin: 'sermons' }).then(ok => { if (!ok) showToast('Tap play to start the sermon', 'info') })
      } else if (target.kind === 'video') {
        setPlayerReady(prev => ({ ...prev, [String(focusId)]: true }))
      }
    }
    onFocused?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, sermons])

  useEffect(() => {
    fetch(`${API}/api/me`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setCanManageSermons(isAdmin || (d?.grants || []).includes('manage_sermons')))
      .catch(() => setCanManageSermons(isAdmin))
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

  const visibleSermons = [...sermons]
    .filter(s => {
      const q = sermonQuery.trim().toLowerCase()
      if (sermonKind !== 'all' && s.kind !== sermonKind) return false
      if (!q) return true
      return [s.title, s.speaker, s.scripture, s.description].some(v => String(v || '').toLowerCase().includes(q))
    })
    .sort((a, b) => {
      if (sermonSort === 'oldest') return String(a.created_at || '').localeCompare(String(b.created_at || ''))
      if (sermonSort === 'largest') return (Number(b.bytes) || 0) - (Number(a.bytes) || 0)
      if (sermonSort === 'smallest') return (Number(a.bytes) || 0) - (Number(b.bytes) || 0)
      if (sermonSort === 'longest') return (Number(b.duration_secs) || 0) - (Number(a.duration_secs) || 0)
      if (sermonSort === 'shortest') return (Number(a.duration_secs) || 0) - (Number(b.duration_secs) || 0)
      if (sermonSort === 'topic') {
        const topicA = String(a.scripture || a.title || '').toLowerCase()
        const topicB = String(b.scripture || b.title || '').toLowerCase()
        return topicA.localeCompare(topicB)
      }
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })

  // The newest teaching gets a feature card, but only in the default view — a
  // search or filter means the member wants the filtered list, not a hero.
  const showFeatured = !sermonQuery.trim() && sermonKind === 'all' && sermonSort === 'newest' && visibleSermons.length > 0
  const featured = showFeatured ? visibleSermons[0] : null
  const rows = showFeatured ? visibleSermons.slice(1) : visibleSermons

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
    const audioActive = playingAudioId === String(s.id)
    if (playing === s.id) {
      if (s.kind === 'video') { videoRef.current?.pause(); setPlayerReady(prev => ({ ...prev, [s.id]: false })) }
      else void togglePlayGlobal()
      if (!audioActive) setPlaying(null)
      return
    }
    if (!s.media_url) {
      showToast('Sermon media is unavailable', 'error')
      return
    }
    pausePlayer()
    stopFeedPlayback()
    videoRef.current?.pause()
    if (s.kind === 'audio') {
      const ok = await playTrack({ id: `sermon:${s.id}`, title: s.title || 'Sermon', artist: s.speaker || 'Harvest Family Church', url: s.media_url, artwork: null, origin: 'sermons' })
      if (!ok) { showToast(player.error || 'Tap again to allow audio', 'error'); return }
    } else {
      setPlayerReady(prev => ({ ...prev, [s.id]: true }))
    }
    setPlaying(s.id)
    fetch(`${API}/api/sermons/${s.id}/play`, { method: 'POST', headers: authHeaders() }).catch(() => {})
    // Reflect the play immediately instead of waiting for the next refresh.
    setSermons(xs => xs.map(x => x.id === s.id ? { ...x, plays: (Number(x.plays) || 0) + 1 } : x))
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
      a.download = d.filename || `${s.title.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.${ext}`
      a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      showToast(`Download started — ${ext.toUpperCase()}`, 'success')
      setSermons(xs => xs.map(x => x.id === s.id ? { ...x, downloads: (Number(x.downloads) || 0) + 1 } : x))
    } catch (e: any) {
      showToast(e?.message || 'Could not download', 'error')
    } finally { setBusy('') }
  }

  // RS-103: a sermon is one logical recording, so its upload key comes from the
  // file itself rather than from the moment someone pressed the button. The
  // manager already reuses a task's key for its own retries; deriving it from
  // name+size+mtime means re-picking the same recording after a give-up replays
  // onto the same storage key instead of publishing a second copy. Hex only, so
  // the server's key sanitiser keeps it intact.
  const sermonUploadKey = (file: File) => {
    const stamp = `${file.name}|${file.size}|${file.lastModified || 0}`
    let hash = 0
    for (let i = 0; i < stamp.length; i++) hash = (hash * 31 + stamp.charCodeAt(i)) >>> 0
    return `${hash.toString(16).padStart(8, '0')}${file.size.toString(16)}`.slice(0, 36)
  }

  const uploadSermon = async () => {
    if (!uploadFile || !uploadTitle.trim() || uploading) return
    const maxBytes = uploadKind === 'video' ? 5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024
    if (uploadFile.size > maxBytes) {
      showToast(uploadKind === 'video' ? 'Video is limited to 5 GB.' : 'Audio is limited to 2 GB.', 'error')
      return
    }
    setUploading(true)
    const kind = uploadKind === 'video' ? 'sermon_video' : 'sermon_audio'
    void startBackgroundUpload({
      label: uploadKind === 'video' ? 'Sermon video' : 'Sermon audio',
      successMsg: 'Sermon published',
      task: {
        kind,
        file: uploadFile,
        idempotency_key: sermonUploadKey(uploadFile),
        caption: uploadDescription,
        title: uploadTitle,
        artist: uploadSpeaker || undefined,
        scripture: uploadScripture || undefined,
        description: uploadDescription,
      },
    }).then(() => {
      setUploading(false)
      setUploadOpen(false)
      setUploadFile(null)
      setUploadTitle('')
      setUploadSpeaker('')
      setUploadScripture('')
      setUploadDescription('')
      void load(true, { limit: PAGE })
    }).catch(() => {
      // Terminal failure: composer stays open (input retained) — retry via pill.
      setUploading(false)
    })
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
      showToast('Sermon updated', 'success')
      setEditing(null)
      void load(true, { limit: PAGE })
    } catch (e: any) { showToast(e?.message || 'Could not save', 'error') } finally { setBusy('') }
  }

  const remove = async (s: any) => {
    if (!window.confirm(`Delete "${s.title}" permanently? Members will no longer see it.`)) return
    setBusy(s.id)
    try {
      const r = await fetch(`${API}/api/sermons/${s.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!r.ok) throw new Error('failed')
      showToast('Sermon deleted')
      setSermons(xs => xs.filter(x => x.id !== s.id))
      setTotal(t => Math.max(0, t - 1))
    } catch { showToast('Could not delete', 'error') } finally { setBusy('') }
  }

  const bumpComments = (sermonId: string, delta: number) => {
    setSermons(xs => xs.map(x => String(x.id) === String(sermonId) ? { ...x, comments: Math.max((Number(x.comments) || 0) + delta, 0) } : x))
  }

  const playLabel = (s: any) => {
    if (playing !== s.id) return s.kind === 'video' ? 'Watch' : 'Listen'
    if (s.kind === 'video') return 'Hide player'
    return playingAudioId === String(s.id) && player.playing ? 'Pause' : 'Resume'
  }

  return (
    <div className="min-h-[70vh] bg-surface pb-8">
      <section className="relative overflow-hidden bg-gradient-to-br from-accent via-accent to-accent-strong px-5 pb-7 pt-7 text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-gold/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
        <div className="relative">
          <p className="text-2xs font-extrabold uppercase tracking-[0.2em] text-white/70">Harvest Word</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Sermons</h1>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-white/80">Carry the Word with you — listen on the way, watch when you can, and pick up where you left off.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-2xs font-extrabold backdrop-blur-sm">
              <Icon name="mic" size={13} /> {total} teaching{total === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-2xs font-extrabold backdrop-blur-sm">
              <Icon name="play" size={11} className="fill-current" /> Keeps playing as you browse
            </span>
          </div>
        </div>
      </section>

      {/* continue listening — the reason to stay */}
      {playerSermonId && player.track && (
        <div className="px-4 pt-4">
          <div className="flex items-center gap-3 rounded-card border border-accent-soft bg-accent-wash p-3">
            <button
              onClick={() => void togglePlayGlobal()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white transition active:scale-95"
              aria-label={player.playing ? 'Pause the sermon' : 'Resume the sermon'}
            >
              <Icon name={player.playing ? 'pause' : 'play'} size={16} className="fill-current" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-accent-strong">Continue listening</p>
              <p className="truncate text-sm font-extrabold text-ink">{player.track.title}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <span className="shrink-0 text-2xs font-bold text-ink-muted">{fmtDur(player.currentTime)}</span>
          </div>
        </div>
      )}

      {canManageSermons && (
        <div className="px-4 pt-4">
          <button onClick={() => setUploadOpen(true)} className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-raised p-3 text-left transition hover:bg-surface-sunken">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white"><Icon name="plus" size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-ink">Upload a sermon</span>
              <span className="block text-2xs text-ink-muted">{isAdmin ? 'MP3, M4A, MP4, MKV or 3GP · publishes immediately' : 'Sermon manager · publishes immediately'}</span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-ink-subtle" />
          </button>
        </div>
      )}

      {failedSermonUpload && failedSermonUpload.id !== dismissedFail && (
        <div className="px-4 pt-4">
          <div className="rounded-card border border-line bg-surface-raised p-3">
            <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-danger">Last sermon upload failed</p>
            {/* The server's own refusal, verbatim — every upload path preserves it. */}
            <p className="mt-1 text-sm font-extrabold text-ink">{failedSermonUpload.detail || 'No reason came back from the server — the transfer was cut off. Try again.'}</p>
            <p className="mt-0.5 text-2xs text-ink-muted">{failedSermonUpload.label} · {timeAgo(new Date(failedSermonUpload.at).toISOString())}</p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => { if (!retryUpload(failedSermonUpload.id)) showToast('That upload can no longer be retried — choose the file again', 'error') }}
                className="min-h-9 rounded-full bg-accent px-3.5 text-2xs font-extrabold text-white transition active:scale-95"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => setDismissedFail(failedSermonUpload.id)}
                className="min-h-9 rounded-full border border-line px-3.5 text-2xs font-extrabold text-ink-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="px-4 pt-4"><ErrorMessage message={error} /></div>}

      {!loading && sermons.length > 0 && (
        <div className="px-4 pt-4">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search sermon topics</span>
              <input
                value={sermonQuery}
                onChange={e => setSermonQuery(e.target.value)}
                placeholder="Search topics, Scripture, title…"
                className="min-h-11 w-full rounded-full border border-line bg-surface-raised px-4 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
                aria-label="Search sermon topics, Scripture and titles"
              />
            </label>
            <label className="shrink-0">
              <span className="sr-only">Sort sermons</span>
              <select
                value={sermonSort}
                onChange={e => setSermonSort(e.target.value as typeof sermonSort)}
                className="h-full min-h-11 rounded-full border border-line bg-surface-raised px-3 text-2xs font-bold text-ink-muted focus:border-accent focus:outline-none"
                aria-label="Sort sermons"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="longest">Longest</option>
                <option value="shortest">Shortest</option>
                <option value="largest">Largest file</option>
                <option value="smallest">Smallest file</option>
                <option value="topic">Topic / Scripture</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(['all', 'audio', 'video'] as const).map(kind => (
              <button
                key={kind}
                type="button"
                onClick={() => setSermonKind(kind)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-2xs font-extrabold transition ${sermonKind === kind ? 'border-ink bg-ink text-white' : 'border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
                aria-pressed={sermonKind === kind}
              >
                {kind === 'all' ? 'All' : kind === 'audio' ? <><Icon name="music" size={12} /> Audio</> : <><Icon name="reels" size={12} /> Video</>}
              </button>
            ))}
            <span className="ml-auto text-2xs text-ink-subtle">{visibleSermons.length} of {sermons.length}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5 px-4 pt-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3">
              <div className="skeleton h-14 w-14 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-3/5 rounded-full" />
                <div className="skeleton h-2.5 w-2/5 rounded-full" />
                <div className="skeleton h-2.5 w-1/3 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : sermons.length === 0 ? (
        <div className="mx-4 mt-4 rounded-card border border-line bg-surface-raised px-4 py-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent"><Icon name="mic" size={24} /></span>
          <p className="mt-3 text-sm font-extrabold text-ink">No sermons yet</p>
          <p className="mt-1 text-2xs text-ink-muted">{canManageSermons ? 'Upload the first one above.' : 'Check back soon — new teachings are on the way.'}</p>
        </div>
      ) : (
        <>
          {featured && (
            <div className="px-4 pt-4">
              <button
                onClick={() => void play(featured)}
                className="relative w-full overflow-hidden rounded-card bg-gradient-to-br from-accent to-accent-strong p-4 text-left text-white shadow-card transition active:scale-[0.99]"
              >
                <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gold/25 blur-2xl" />
                <span className="relative block text-2xs font-extrabold uppercase tracking-[0.16em] text-white/70">Latest teaching</span>
                <span className="relative mt-1 block text-lg font-black leading-6 line-clamp-2">{featured.title}</span>
                <span className="relative mt-1 block truncate text-2xs text-white/75">
                  {featured.speaker || 'Harvest Family Church'}{featured.scripture ? ` · ${featured.scripture}` : ''}
                </span>
                <span className="relative mt-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-2xs font-extrabold text-accent-strong">
                  <Icon name={playing === featured.id && player.playing ? 'pause' : 'play'} size={13} className="fill-current" />
                  {playLabel(featured)} · {fmtDur(Number(featured.duration_secs) || 0)}
                </span>
              </button>
            </div>
          )}

          <div className="mt-3 space-y-2.5 px-4">
            {rows.map(s => {
              const count = Number(s.comments) || 0
              const seconds = Number(s.duration_secs) || 0
              return (
                <article key={s.id} className="rounded-card border border-line bg-surface-raised p-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void play(s)}
                      className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-sunken text-ink-muted"
                      aria-label={`${playLabel(s)} ${s.title}`}
                    >
                      {s.cover_url
                        ? <img src={s.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : <Icon name={s.kind === 'video' ? 'reels' : 'music'} size={22} />}
                      <span className="absolute inset-0 grid place-items-center bg-ink/35 text-white">
                        <Icon name={playing === s.id && player.playing ? 'pause' : 'play'} size={16} className="fill-current" />
                      </span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-extrabold leading-5 text-ink">{s.title}</p>
                      <p className="mt-0.5 truncate text-2xs text-ink-muted">
                        {s.speaker || 'Harvest Family Church'}{s.scripture ? ` · ${s.scripture}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-subtle">
                        <span className="inline-flex items-center gap-1"><Icon name={s.kind === 'video' ? 'reels' : 'music'} size={11} /> {seconds ? fmtDur(seconds) : timeAgo(s.created_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{Number(s.plays) || 0} plays</span>
                        <button
                          type="button"
                          onClick={() => setCommentTarget(s)}
                          className="inline-flex items-center gap-1 font-extrabold text-ink-muted transition hover:text-ink"
                          aria-label={`Comments on ${s.title}`}
                        >
                          <Icon name="chat" size={11} /> {count}
                        </button>
                      </div>
                    </div>
                  </div>

                  {playing === s.id && s.kind === 'video' && playerReady[s.id] && (
                    <div className="mt-3">
                      <video ref={videoRef} key={s.id} src={s.media_url} controls autoPlay playsInline className="w-full rounded-xl bg-ink" />
                    </div>
                  )}
                  {playing === s.id && s.kind !== 'video' && playingAudioId === String(s.id) && (
                    <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
                      <button onClick={() => void togglePlayGlobal()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white" aria-label={player.playing ? 'Pause sermon' : 'Play sermon'}>
                        <Icon name={player.playing ? 'pause' : 'play'} size={14} className="fill-current" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div
                          role="slider"
                          aria-label="Seek sermon"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(progressPct)}
                          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekToFraction((e.clientX - r.left) / r.width) }}
                          className="h-1.5 cursor-pointer overflow-hidden rounded-full bg-line"
                        >
                          <div className="h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
                        </div>
                        <p className="mt-1 text-2xs font-mono text-ink-subtle">{fmtDur(player.currentTime)} / {fmtDur(player.duration)}{player.error ? ` · ${player.error}` : ''}</p>
                      </div>
                    </div>
                  )}

                  {s.description && <p className="mt-2 line-clamp-2 text-2xs leading-5 text-ink-muted">{s.description}</p>}

                  <div className="mt-3 flex items-center gap-2">
                    <button onClick={() => void play(s)} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-2xs font-extrabold ${playing === s.id ? 'bg-ink text-white' : 'bg-accent text-white'}`}>
                      <Icon name={playing === s.id && player.playing ? 'pause' : 'play'} size={13} className="fill-current" /> {playLabel(s)}
                    </button>
                    <button onClick={() => void download(s)} disabled={busy === s.id} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 text-2xs font-extrabold text-accent-strong disabled:opacity-50">
                      {busy === s.id ? <Spinner size={13} /> : <Icon name="chevron-down" size={13} />} {s.kind === 'video' ? 'MP4' : 'MP3'}
                    </button>
                    {canManageSermons && (
                      <>
                        <button onClick={() => setEditing({ ...s })} className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-ink-muted" aria-label={`Edit ${s.title}`}><Icon name="pencil" size={15} /></button>
                        <button onClick={() => void remove(s)} disabled={busy === s.id} className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-danger disabled:opacity-50" aria-label={`Delete ${s.title}`}><Icon name="trash" size={15} /></button>
                      </>
                    )}
                  </div>
                </article>
              )
            })}
            {visibleSermons.length === 0 && (
              <div className="rounded-card border border-line bg-surface-raised px-4 py-10 text-center">
                <p className="text-sm font-extrabold text-ink">No matching sermons</p>
                <p className="mt-1 text-2xs text-ink-muted">Try another topic, Scripture reference, or title.</p>
              </div>
            )}
          </div>
        </>
      )}

      {!loading && sermons.length < total && (
        <div className="px-4 pt-4">
          <button onClick={() => void loadMore()} disabled={loadingMore} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface-raised text-2xs font-extrabold text-accent-strong transition hover:bg-surface-sunken disabled:opacity-50">
            {loadingMore ? <><Spinner size={14} /> Loading…</> : <>Load more · {total - sermons.length} to go</>}
          </button>
        </div>
      )}

      {canManageSermons && (
        <p className="px-4 pt-4 text-center text-2xs text-ink-subtle">Streaming and downloads are recorded so the church can see what is being received.</p>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-[2px]" onClick={() => !uploading && setUploadOpen(false)} role="dialog" aria-label="Upload sermon">
          <div className="w-full space-y-3 rounded-t-3xl border border-line bg-surface-raised p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] sm:max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-ink">Upload sermon</p>
              <button onClick={() => !uploading && setUploadOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-ink-muted" aria-label="Close upload"><Icon name="close" size={17} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setUploadKind('audio'); setUploadFile(null) }} className={`min-h-11 rounded-xl border text-2xs font-extrabold ${uploadKind === 'audio' ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface text-ink-muted'}`}>Audio file</button>
              <button onClick={() => { setUploadKind('video'); setUploadFile(null) }} className={`min-h-11 rounded-xl border text-2xs font-extrabold ${uploadKind === 'video' ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface text-ink-muted'}`}>Video file</button>
            </div>
            <input ref={uploadInput} type="file" accept={uploadKind === 'video' ? '.mp4,video/mp4,.mkv,video/x-matroska,.3gp,video/3gpp,.mov,video/quicktime,.m4v,video/x-m4v,.webm,video/webm' : '.mp3,audio/mpeg,.m4a,audio/mp4,.aac,audio/aac,.wav,audio/wav,.ogg,audio/ogg'} onChange={e => {
              const f = e.target.files?.[0] || null
              if (!f) return
              const max = uploadKind === 'video' ? 5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024
              // Judge the pick by extension first, MIME second: a phone reports
              // an empty or generic type for a chosen recording, and one that
              // sends audio/mp4 for a plain .mp3 must not be turned away here.
              if (sermonKindOf(f) !== uploadKind) {
                showToast(uploadKind === 'video' ? 'Choose an MP4, MKV, 3GP, MOV or WEBM video.' : 'Choose an MP3, M4A, AAC, WAV or OGG audio file.', 'error')
                e.target.value = ''
                return
              }
              if (f.size > max) { showToast(uploadKind === 'video' ? 'Video is limited to 5 GB.' : 'Audio is limited to 2 GB.', 'error'); e.target.value = ''; return }
              setUploadFile(f)
            }} className="hidden" />
            <button onClick={() => uploadInput.current?.click()} className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-dashed border-line bg-surface px-3 text-left text-2xs font-bold text-ink-muted">
              <Icon name="plus" size={16} /> {uploadFile ? `${uploadFile.name} · ${fmtBytes(uploadFile.size)}` : 'Choose file'}
            </button>
            <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Sermon title *" className="input-base" />
            <input value={uploadSpeaker} onChange={e => setUploadSpeaker(e.target.value)} placeholder="Speaker / preacher" className="input-base" />
            <input value={uploadScripture} onChange={e => setUploadScripture(e.target.value)} placeholder="Scripture reference" className="input-base" />
            <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} rows={3} placeholder="Description" className="input-base resize-y" />
            <button disabled={uploading || !uploadFile || !uploadTitle.trim()} onClick={() => void uploadSermon()} className="min-h-12 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">{uploading ? 'Uploading…' : 'Upload sermon'}</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-[2px]" onClick={() => setEditing(null)} role="dialog" aria-label="Edit sermon">
          <div className="w-full space-y-3 rounded-t-3xl border border-line bg-surface-raised p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] sm:max-w-lg" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-extrabold text-ink">Edit sermon</p>
            <input value={editing.title || ''} onChange={e => setEditing((x: any) => ({ ...x, title: e.target.value }))} placeholder="Title" className="input-base" />
            <input value={editing.speaker || ''} onChange={e => setEditing((x: any) => ({ ...x, speaker: e.target.value }))} placeholder="Speaker" className="input-base" />
            <input value={editing.scripture || ''} onChange={e => setEditing((x: any) => ({ ...x, scripture: e.target.value }))} placeholder="Scripture (e.g. John 3:16-21)" className="input-base" />
            <textarea value={editing.description || ''} onChange={e => setEditing((x: any) => ({ ...x, description: e.target.value }))} rows={3} placeholder="Description" className="input-base resize-y" />
            <div className="flex gap-2">
              <button onClick={() => void saveEdit()} disabled={busy === 'edit'} className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">{busy === 'edit' ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(null)} className="min-h-12 rounded-xl bg-surface-sunken px-4 text-sm font-extrabold text-ink">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mx-4 mt-6 rounded-card border border-line bg-surface-raised p-4">
          <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><Icon name="shield" size={16} /> Sermon managers</p>
          <p className="mt-1 text-2xs leading-relaxed text-ink-muted">Give a member full control of sermons: upload, edit and delete. Admins always retain full access.</p>
          <input value={managerSearch} onChange={e => setManagerSearch(e.target.value)} placeholder="Search members…" className="input-base mt-3" />
          <div className="mt-3 max-h-64 space-y-2 overflow-auto">
            {managerUsers.filter(u => `${u.username} ${u.name}`.toLowerCase().includes(managerSearch.trim().toLowerCase())).slice(0, 20).map(u => {
              const on = String(u.grants || '').split(',').filter(Boolean).includes('manage_sermons')
              return (
                <div key={u.username} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{u.name || u.username}</p>
                    <p className="truncate text-2xs text-ink-muted">@{u.username} · {u.group_name || 'Member'}</p>
                  </div>
                  <button disabled={managerBusy === u.username} onClick={() => void toggleSermonManager(u)} className={`min-h-9 shrink-0 rounded-full px-3 text-2xs font-extrabold ${on ? 'bg-accent text-white' : 'bg-surface-sunken text-ink-muted'}`}>
                    {managerBusy === u.username ? '…' : on ? 'Manager' : 'Give access'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {commentTarget && (
        <Comments
          scope="sermon"
          postId={String(commentTarget.id)}
          me={username}
          isAdmin={isAdmin}
          onCountChange={delta => bumpComments(String(commentTarget.id), delta)}
          onClose={() => setCommentTarget(null)}
        />
      )}

    </div>
  )
}
