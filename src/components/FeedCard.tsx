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
import { Icon, Spinner } from '../ui'

export type FeedCardPost = {
  key: string
  id?: string
  user: string
  username?: string
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

// Sponsored advert slot — third-party advert card, cream identity, never
// styled to mimic an organic post (the Sponsored chip is always visible).
export function AdvertCard({ advert }: { advert: { id: string; advert_id?: string; title?: string; caption?: string; body?: string; image_url?: string | null; cta_url?: string | null } }) {
  const title = advert.title || advert.caption || 'Sponsored'
  const body = advert.body || ''
  const href = advert.cta_url || null
  return (
    <article className="relative overflow-hidden rounded-card border border-accent-soft bg-surface-raised shadow-card" data-advert-id={advert.advert_id || advert.id}>
      {advert.image_url && (
        <button type="button" onClick={() => href && window.open(href, '_blank', 'noopener')} className="block w-full text-left" aria-label={href ? `Open advertiser: ${title}` : undefined}>
          <img src={advert.image_url} alt={title} className="max-h-72 w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        </button>
      )}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-2xs font-extrabold uppercase tracking-[0.12em] text-accent-strong">Sponsored</span>
          {href && <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-bold text-accent">Learn more <Icon name="chevron-right" size={13} /></span>}
        </div>
        <h3 className="text-heading font-extrabold leading-5 text-ink">{title}</h3>
        {body && <p className="mt-1 text-sm leading-6 text-ink-muted break-words">{body}</p>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-2xs font-extrabold text-white shadow-card">Visit sponsor</a>
        )}
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
        {music?.cover_url ? (
          <img
            src={music.cover_url}
            alt=""
            decoding="async"
            className="music-disc-spin h-full w-full object-cover"
            style={{ animationPlayState: playing ? 'running' : 'paused' }}
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-white/85"><Icon name="music" size={16} /></span>
        )}
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
          <button onClick={() => onOpenUser?.(profile)} aria-label={`View ${p.user}'s profile`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-gold-soft text-2xs font-extrabold text-accent-strong">
            {String(p.user).split(' ').map((x: string) => x[0]).slice(0, 2).join('')}
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
