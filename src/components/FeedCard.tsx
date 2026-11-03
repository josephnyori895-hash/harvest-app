// Harvest Family community post card.
//
// Anatomy follows a real feed post: no card frame, media edge-to-edge, an
// icon-only monochrome action row, then the text stack (count, caption,
// comments link, timestamp). Colour is reserved for meaning — a liked heart —
// rather than decorating each button.
//
// Music attached to a photo or clip follows the feed convention: a spinning
// album-art disc sits in the corner of the media. It is the only music control
// on the post — spinning while the song plays, still when it is paused, and a
// tap toggles it (which is also how the member mutes music for good).

import { useEffect, useRef, useState } from 'react'
import { setFeedAutoplayPref, markAudioUnlocked } from '../lib/audioPlayer'
import { toggleInlineMediaTrack, stopInlineMediaAudio, subscribeInlineMediaAudio } from '../lib/inlineMediaAudio'
import { startFeedPlayback, stopFeedPlayback } from '../lib/feedPlayback'
import FeedMediaPreview from './FeedMediaPreview'
import TrackArt from './TrackArt'
import { Icon, Spinner } from '../ui'

export type FeedCardPost = {
  key: string
  id?: string
  user: string
  username?: string
  avatar_url?: string | null
  verified?: boolean
  loc?: string
  time?: string
  img?: string
  video?: string
  caption?: string
  kind?: string
  likes?: number
  comments?: number
  liked?: boolean
  music?: { id: string; title: string; artist?: string; url?: string | null; cover_url?: string | null } | null
}

type Props = {
  p: FeedCardPost
  liked: boolean
  displayLikes: number
  menuOpen: boolean
  onToggleMenu: () => void
  onLike: () => void
  onComment: () => void
  onShare: () => void
  saved?: boolean
  onSave?: () => void
  onOpenUser?: (u: any) => void
}

const fmtCount = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// Sponsored project slot — a 2026 advert, not a banner. Full-bleed artwork,
// one loud number (progress toward the goal), the human detail underneath and
// a single action. It is always labelled Sponsored and never mimics an organic
// post: church projects get a campaign card, not a grey box with a link.
export type ProjectAdvert = {
  id: string
  advert_id?: string
  title?: string
  caption?: string
  body?: string
  image_url?: string | null
  cta_url?: string | null
  project?: {
    id?: string
    name?: string
    description?: string
    goal_kes?: number
    raised_kes?: number
    committed_kes?: number
    participants?: number
    deadline?: string | null
  } | null
}

export function AdvertCard({ advert, onOpen }: { advert: ProjectAdvert; onOpen?: () => void }) {
  const project = advert.project || null
  const title = project?.name || advert.title || advert.caption || 'Harvest partner'
  const body = advert.body || project?.description || advert.caption || ''
  const raised = Number(project?.raised_kes) || 0
  const goal = Number(project?.goal_kes) || 0
  const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0
  const participants = Number(project?.participants) || 0
  const deadline = project?.deadline ? new Date(project.deadline) : null
  const daysLeft = deadline && Number.isFinite(deadline.getTime())
    ? Math.ceil((deadline.getTime() - Date.now()) / 86_400_000)
    : null
  const open = () => { if (onOpen) onOpen(); else if (advert.cta_url) window.open(advert.cta_url, '_blank', 'noopener') }
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  // Church project → dark campaign card: one number, a thin gold progress line,
  // the human detail in small caps, one action. No pastel chips, no stacked
  // borders — this is the shape of a funded campaign in 2026.
  if (project && goal > 0) {
    return (
      <article className="overflow-hidden rounded-3xl bg-ink text-surface shadow-card" data-advert-id={advert.advert_id || advert.id}>
        <button type="button" onClick={open} className="block w-full text-left" aria-label={`Open ${title}`}>
          <div className="p-4 pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold">
                <span className="h-1 w-1 rounded-full bg-gold" aria-hidden="true" /> Harvest project
              </span>
              <span className="rounded-full bg-surface/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-surface/60">Sponsored</span>
            </div>
            <h3 className="mt-2.5 text-xl font-extrabold leading-tight tracking-tight">{title}</h3>
            {body && <p className="mt-1 line-clamp-2 max-w-[42ch] text-2xs leading-relaxed text-surface/55">{body}</p>}
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-extrabold leading-none tabular-nums">KES {raised.toLocaleString()}</p>
                <p className="mt-1 text-2xs text-surface/45">of {goal.toLocaleString()} goal</p>
              </div>
              <p className="shrink-0 text-2xs font-extrabold text-gold">{pct}%</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface/10" data-testid="advert-progress">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(pct, 1.5)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-surface/40">
              <span>{participants} participating</span>
              <span>{daysLeft === null || daysLeft < 0 ? 'Keep giving' : daysLeft === 0 ? 'Ends today' : `${daysLeft} days left`}</span>
            </div>
          </div>
        </button>
        <div className="p-3">
          <button type="button" onClick={open} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-gold text-2xs font-extrabold text-ink transition active:scale-[0.99]">
            Take part <Icon name="arrow-right" size={14} />
          </button>
        </div>
      </article>
    )
  }

  // Partner advert → image-forward editorial card. Big title over a cinematic
  // crop, one "Learn more". A sponsor without artwork still looks designed:
  // deep navy tile with the partner's monogram, not a grey placeholder.
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-surface-raised shadow-card" data-advert-id={advert.advert_id || advert.id}>
      <button type="button" onClick={open} className="relative block w-full text-left" aria-label={`Open ${title}`}>
        <div className="relative aspect-[16/10] w-full overflow-hidden">
          {advert.image_url
            ? <img src={advert.image_url} alt={title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            : (
              <div className="grid h-full w-full place-items-center bg-black">
                <span aria-hidden="true" className="text-6xl font-extrabold tracking-tighter text-white/10">{initials}</span>
              </div>
            )}
          <span className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
          <span className="absolute left-3 top-3 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-white backdrop-blur-sm">Sponsored</span>
          <span className="absolute inset-x-3 bottom-3 block">
            <span className="block text-lg font-extrabold leading-tight tracking-tight text-white">{title}</span>
            {body && <span className="mt-1 line-clamp-2 block max-w-[46ch] text-2xs leading-snug text-white/65">{body}</span>}
          </span>
        </div>
      </button>
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-subtle">Harvest partner</span>
        <button type="button" onClick={open} className="flex min-h-9 items-center gap-1 rounded-full bg-ink px-4 text-2xs font-extrabold text-surface">
          Learn more <Icon name="arrow-right" size={13} />
        </button>
      </div>
    </article>
  )
}

/** Inline music state for one post: the channel is the single source of truth,
 *  so autoplay and a manual tap look identical in the UI. */
function useInlineMusic(music?: FeedCardPost['music']) {
  const [liveId, setLiveId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => subscribeInlineMediaAudio(setLiveId), [])
  const id = music?.id ? String(music.id) : null
  const url = music?.url || null
  const playing = Boolean(id) && liveId === id && !failed

  const toggle = async (): Promise<boolean> => {
    if (!id) return false
    if (!url) { setFailed(true); return false }
    if (loading) return false
    if (playing) {
      stopInlineMediaAudio()
      // Tapping the disc is the member's mute: remembered, so scrolling onto the
      // next song post does not start talking again.
      setFeedAutoplayPref(false)
      return false
    }
    setLoading(true)
    setFailed(false)
    // A tap is a real gesture — the browser now lets this post (and later posts) play.
    markAudioUnlocked()
    const ok = await toggleInlineMediaTrack({ id, url }, setLiveId)
    setLoading(false)
    if (ok) setFeedAutoplayPref(true)
    else setFailed(true)
    return ok
  }

  return { visible: Boolean(id), playing, loading, failed, toggle }
}

/** Spinning album-art disc in the corner of the media: the feed's only music
 *  control. Frozen rotation while paused, spinner while loading, alert + retry
 *  tap when the track refuses to play. */
function MusicDisc({ music, playing, loading, failed, onToggle, raised = false }: {
  music?: FeedCardPost['music']
  playing: boolean
  loading: boolean
  failed: boolean
  onToggle: () => void
  raised?: boolean
}) {
  const title = music?.title || 'song'
  const state = failed ? 'failed' : loading ? 'loading' : playing ? 'playing' : 'paused'
  return (
    <button
      type="button"
      onClick={onToggle}
      data-music-disc
      data-state={state}
      aria-label={failed ? `Retry ${title}` : loading ? `Loading ${title}` : playing ? `Pause ${title}` : `Play ${title}`}
      title={music?.artist ? `${title} · ${music.artist}` : title}
      className={`absolute right-3 z-10 h-11 w-11 rounded-full bg-white/25 p-[2px] shadow-lg ring-1 ring-white/20 transition active:scale-95 ${raised ? 'bottom-14' : 'bottom-3'}`}
    >
      <span className="relative block h-full w-full overflow-hidden rounded-full bg-ink">
        <TrackArt src={music?.cover_url} title={music?.title} className="h-full w-full" iconSize={16} spin={{ playing }} />
        <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-white/85 shadow-sm" />
        </span>
        {loading && (
          <span className="absolute inset-0 grid place-items-center bg-ink/55 text-white"><Spinner size={13} /></span>
        )}
        {failed && (
          <span className="absolute inset-0 grid place-items-center bg-ink/65 text-white"><Icon name="alert" size={15} /></span>
        )}
      </span>
    </button>
  )
}

function FeedImagePreview({ src, alt = '' }: { src: string; alt?: string }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  // Full-bleed and cropped, exactly like a feed post: the media spans the whole
  // column so the post reads as one object, never a picture inside a frame.
  const boundedRatio = ratio ? Math.min(Math.max(ratio, 0.8), 1.91) : null
  return (
    <div className="relative w-full max-h-[70vh] overflow-hidden bg-surface-sunken" style={boundedRatio ? { aspectRatio: String(boundedRatio) } : undefined}>
      {failed ? (
        <div className="flex min-h-40 w-full items-center justify-center text-sm text-ink-muted">Photo preview unavailable</div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={event => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight)
          }}
          onError={() => setFailed(true)}
          className="block h-full max-h-[70vh] w-full object-cover"
        />
      )}
    </div>
  )
}

export default function FeedCard({ p, liked, displayLikes, menuOpen, onToggleMenu, onLike, onComment, onShare, saved, onSave, onOpenUser }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [autoPlayVideo, setAutoPlayVideo] = useState(false)
  const ref = useRef<HTMLElement | null>(null)
  const music = useInlineMusic(p.music)

  // IG-style scroll-driven playback via the central feed coordinator. Videos
  // arm the muted-safe stage; posts with an attached track arm the soundtrack.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const musicEligible = Boolean(p.music?.url && p.music?.id)
    if (!p.video && !musicEligible) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (p.video) setAutoPlayVideo(true)
        if (musicEligible) void startFeedPlayback(p).catch(() => {})
      } else {
        // Only this card's own track is paused by its own scroll-out — a
        // video post leaving view must never stop a neighbour's music.
        if (musicEligible) stopFeedPlayback(p)
        setAutoPlayVideo(false)
      }
    }, { threshold: [0, 0.6] })
    io.observe(el)
    return () => { io.disconnect() }
  }, [p.music, p.video])

  const profile = { username: p.username, name: p.user, verified: p.verified, group_name: p.loc }
  const caption = p.caption || ''
  const longCaption = caption.length > 120

  return (
    <article ref={ref} data-post-id={String(p.id ?? p.key)} className="bg-surface">
      {/* header — 32px avatar, one bold line, one meta line, overflow */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button onClick={() => onOpenUser?.(profile)} aria-label={`View ${p.user}'s profile`} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-accent-soft to-gold-soft text-2xs font-extrabold text-accent-strong">
            {p.avatar_url
              ? <img src={p.avatar_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              : String(p.user).split(' ').map((x: string) => x[0]).slice(0, 2).join('')}
          </button>
          <button onClick={() => onOpenUser?.(profile)} aria-label={`View ${p.user}'s profile`} className="min-w-0 text-left">
            <p className="flex min-w-0 items-center gap-1 text-caption font-extrabold leading-tight text-ink">
              <span className="truncate">{p.user}</span>
              {p.verified ? (
                <span role="img" aria-label="Verified account" className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-accent text-white">
                  <Icon name="check" size={9} strokeWidth={3.2} />
                </span>
              ) : null}
            </p>
            <p className="truncate text-2xs text-ink-subtle">{[p.loc, p.time].filter(Boolean).join(' · ')}</p>
          </button>
        </div>
        <button onClick={onToggleMenu} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-surface-sunken" aria-label="More options" aria-expanded={menuOpen}>
          <Icon name="dots" size={20} />
        </button>
      </div>

      {/* media — full bleed, no card frame; the music disc rides in its corner */}
      {p.video || p.img ? (
        <div className="relative">
          {p.video
            ? <FeedMediaPreview src={p.video} poster={p.img} autoPlay={autoPlayVideo} />
            : <FeedImagePreview src={p.img as string} />}
          {music.visible && (
            <MusicDisc
              music={p.music}
              playing={music.playing}
              loading={music.loading}
              failed={music.failed}
              onToggle={() => { void music.toggle() }}
              raised={Boolean(p.video)}
            />
          )}
        </div>
      ) : (
        <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 bg-surface-sunken text-ink-subtle" aria-label="Image pending review">
          <Icon name="camera" size={26} />
          <span className="text-2xs font-semibold">Photo on its way</span>
        </div>
      )}

      {/* actions — icon only, monochrome; colour means "liked" */}
      <div className="flex items-center gap-4 px-3 pt-2.5">
        <button type="button" onClick={onLike} disabled={busy} className="transition active:scale-90" aria-label={liked ? 'Unlike' : 'Appreciate'} aria-pressed={liked}>
          <Icon name="heart" size={24} strokeWidth={liked ? 2.4 : 1.7} className={liked ? 'fill-current text-danger' : 'text-ink'} />
        </button>
        <button type="button" onClick={onComment} className="transition active:scale-90" aria-label="Comments">
          <Icon name="chat" size={24} className="text-ink" />
        </button>
        <button type="button" onClick={() => { setBusy(true); try { onShare() } finally { setTimeout(() => setBusy(false), 600) } }} className="transition active:scale-90" aria-label="Share on WhatsApp" title="Share on WhatsApp" disabled={busy}>
          <Icon name="send" size={24} className="text-ink" />
        </button>
        {onSave && (
          <button type="button" onClick={() => onSave()} className="ml-auto transition active:scale-90" aria-pressed={!!saved} aria-label={saved ? 'Remove from Saved' : 'Save for later'}>
            <Icon name="bookmark" size={24} className={saved ? 'fill-current text-ink' : 'text-ink'} />
          </button>
        )}
      </div>

      {/* text stack — count, caption, comments, timestamp */}
      <div className="px-3 pb-3 pt-1.5">
        {displayLikes > 0 && (
          <p className="text-caption font-extrabold text-ink">{fmtCount(displayLikes)} appreciation{displayLikes === 1 ? '' : 's'}</p>
        )}
        {caption && (
          <p className="mt-1 text-caption leading-5 text-ink">
            <strong className="font-extrabold">{p.user}</strong>{' '}
            {caption.split(/(\s+)/).map((w, i) => /#([\p{L}\p{N}_]+)/u.test(w) ? <span key={i} className="text-accent">{w}</span> : <span key={i}>{w}</span>)}
            {longCaption && (
              <> <button type="button" onClick={() => setExpanded(x => !x)} className="text-ink-subtle" aria-label={expanded ? 'Show less' : 'Show more'}>{expanded ? 'less' : 'more'}</button></>
            )}
          </p>
        )}
        {Number(p.comments) > 0 && (
          <button type="button" onClick={onComment} className="mt-1 block text-caption text-ink-muted">View all {fmtCount(Number(p.comments))} comments</button>
        )}
        {p.time && <p className="mt-1.5 text-2xs uppercase tracking-wide text-ink-subtle">{p.time}</p>}
      </div>
    </article>
  )
}
