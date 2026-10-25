// Harvest Family community post card.
// Preserve the church's visual identity while keeping media clear and responsive.

import { useEffect, useRef, useState } from 'react'
import { pausePlayer } from '../lib/audioPlayer'
import { toggleInlineMediaTrack, activeInlineMediaTrackId, subscribeInlineMediaAudio } from '../lib/inlineMediaAudio'
import FeedMediaPreview from './FeedMediaPreview'

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

function MusicChip({ p }: { p: FeedCardPost }) {
  const m = p.music
  const [playingId, setPlayingId] = useState<string | null>(activeInlineMediaTrackId())
  useEffect(() => subscribeInlineMediaAudio(setPlayingId), [])
  if (!m?.id || !m.title) return null
  const playing = playingId === m.id
  const start = async () => {
    if (!m.url) return
    pausePlayer()
    await toggleInlineMediaTrack({ id: m.id, url: m.url }, setPlayingId)
  }
  return (
    <button type="button" onClick={() => void start()} className="mt-2 flex items-center gap-2 text-left" aria-label={playing ? `Pause ${m.title}` : `Play ${m.title}`}>
      <span className="flex h-4 w-4 items-end justify-center gap-[2px] shrink-0" aria-hidden="true">
        {playing ? <><span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '55%', animation: 'eqbar 0.9s ease-in-out infinite' }} /><span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '100%', animation: 'eqbar 0.7s ease-in-out infinite reverse' }} /><span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '70%', animation: 'eqbar 1.1s ease-in-out infinite' }} /></> : <span className="text-[13px] leading-none text-[#7C3AED]">▶</span>}
      </span>
      <span className="truncate text-[11px] font-bold text-[#5B21B6]">♫ {m.title}{m.artist ? ` · ${m.artist}` : ''}</span>
    </button>
  )
}

function FeedImagePreview({ src, alt = '' }: { src: string; alt?: string }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const boundedRatio = ratio ? Math.min(Math.max(ratio, 0.5), 1.91) : null
  const style = boundedRatio
    ? { aspectRatio: String(boundedRatio), width: `min(100%, ${Math.round(boundedRatio * 70)}vh)` }
    : { width: '100%' as const }
  return (
    <div className="mx-auto flex max-h-[70vh] justify-center overflow-hidden bg-[#F4E8D0]" style={style}>
      {failed ? (
        <div className="flex min-h-40 w-full items-center justify-center text-sm text-[#766E63]">Photo preview unavailable</div>
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
          className="block h-full max-h-[70vh] w-full object-contain"
        />
      )}
    </div>
  )
}

export default function FeedCard({ p, liked, displayLikes, menuOpen, onToggleMenu, onLike, onComment, onShare, saved, onSave, onOpenUser }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLElement | null>(null)

  const profile = { username: p.username, name: p.user, verified: p.verified, group_name: p.loc }

  return (
    <article ref={ref} data-post-id={String(p.id ?? p.key)} className="rounded-[26px] overflow-hidden bg-white border border-[#E8DEC9] shadow-sm">
      {/* header — one tight row */}
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <button onClick={() => onOpenUser?.(profile)} aria-label={`View ${p.user}'s profile`} className="w-9 h-9 shrink-0 rounded-2xl bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-[11px] font-extrabold text-[#5B21B6]">
            {String(p.user).split(' ').map((x: string) => x[0]).slice(0, 2).join('')}
          </button>
          <button onClick={() => onOpenUser?.(profile)} aria-label={`View ${p.user}'s profile`} className="text-left min-w-0">
            <p className="text-[13px] font-extrabold leading-tight truncate">{p.user}{p.verified ? <span className="ml-1 text-[#0F766E]">✓</span> : null}</p>
            <p className="text-[10px] text-[#8B8175] truncate">{[p.loc, p.time].filter(Boolean).join(' · ')}</p>
          </button>
        </div>
        <button onClick={onToggleMenu} className="w-7 h-7 rounded-lg text-[#766E63] text-xs font-bold" aria-label="More options">•••</button>
      </div>

      {/* media — full-bleed, natural aspect, no baked chrome */}
      {p.video ? (
        <FeedMediaPreview src={p.video} poster={p.img} />
      ) : p.img ? (
        <FeedImagePreview src={p.img} />
      ) : (
        <div className="w-full aspect-[4/3] bg-[#F4E8D0] flex items-center justify-center text-4xl" aria-label="Image pending review">🙏</div>
      )}

      {/* footer — caption, song, actions: IG density */}
      <div className="px-3 pt-2 pb-2.5">
        <p className={`text-[12.5px] leading-5 text-[#4B433A] ${expanded ? '' : 'line-clamp-2'}`}>
          <strong className="text-[#29251F] font-extrabold">{p.user}</strong>{' '}
          {(p.caption || '').split(/(\s+)/).map((w, i) => /#([\p{L}\p{N}_]+)/u.test(w) ? <span key={i} className="text-[#7C3AED]">{w}</span> : <span key={i}>{w}</span>)}
        </p>
        {(p.caption || '').length > 120 && (
          <button type="button" onClick={() => setExpanded(x => !x)} className="text-[11px] font-bold text-[#8B8175] mt-0.5" aria-label={expanded ? 'Show less' : 'Show more'}>
            {expanded ? 'less' : 'more'}
          </button>
        )}

        <MusicChip p={p} />

        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={onLike} disabled={busy} className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#B91C1C]/90 active:opacity-60" aria-label={liked ? 'Unlike' : 'Appreciate'}>
            <span className={liked ? 'text-[13px]' : 'text-[13px] grayscale opacity-60'}>{liked ? '♥' : '♡'}</span>
            {fmtCount(displayLikes) || (liked ? '1' : '')}
          </button>
          <button type="button" onClick={onComment} className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#5B21B6] active:opacity-60" aria-label="Comments">
            <span className="text-[13px]">💬</span>
            {fmtCount(Number(p.comments) || 0)}
          </button>
          <button type="button" onClick={() => { setBusy(true); try { onShare() } finally { setTimeout(() => setBusy(false), 600) } }} className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#128C4A] active:opacity-60" aria-label="Share on WhatsApp" title="Share on WhatsApp" disabled={busy}>
            <span className="text-[13px]">↗</span>
            WhatsApp
          </button>
          {onSave && (
            <button type="button" onClick={() => onSave()} className={`ml-auto flex items-center gap-1.5 text-[11px] font-extrabold active:opacity-60 ${saved ? 'text-[#B45309]' : 'text-[#766E63]'}`} aria-pressed={!!saved} aria-label={saved ? 'Remove from Saved' : 'Save for later'}>
              <span className="text-[13px]">{saved ? '🔖' : '🔖'}</span>
              {saved ? 'Saved' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
