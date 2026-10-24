// src/components/FeedCard.tsx — IG-style community post card.
// Full-bleed media, tight header, compact icon action row, and a song chip
// that actually plays the attached worship track (tap, or auto like IG once
// the member has interacted with audio this session).

import { useEffect, useRef, useState } from 'react'
import { playTrack, pausePlayer, subscribePlayer, isPlayingId, audioAutoplayReady } from '../lib/audioPlayer'
import FeedMediaPreview from './FeedMediaPreview'
import MediaThumbnail from './MediaThumbnail'

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
  const [, tick] = useState(0)
  useEffect(() => subscribePlayer(() => tick(x => x + 1)), [])
  if (!m?.id || !m.title) return null
  const playing = isPlayingId(m.id)
  const start = async () => {
    if (playing) { pausePlayer(); return }
    if (!m.url) return
    await playTrack({ id: m.id, title: m.title, artist: m.artist || 'Harvest Family Church', url: m.url, artwork: m.cover_url || null, origin: 'feed' })
  }
  return (
    <button type="button" onClick={() => void start()} className="mt-2 flex items-center gap-2 text-left" aria-label={playing ? `Pause ${m.title}` : `Play ${m.title}`}>
      <span className="flex h-4 w-4 items-end justify-center gap-[2px] shrink-0" aria-hidden="true">
        {playing ? (
          <>
            <span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '55%', animation: 'eqbar 0.9s ease-in-out infinite' }} />
            <span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '100%', animation: 'eqbar 0.7s ease-in-out infinite reverse' }} />
            <span className="w-[3px] rounded-sm bg-[#7C3AED]" style={{ height: '70%', animation: 'eqbar 1.1s ease-in-out infinite' }} />
          </>
        ) : <span className="text-[13px] leading-none text-[#7C3AED]">▶</span>}
      </span>
      <span className="truncate text-[11px] font-bold text-[#5B21B6]">{m.title}{m.artist ? ` · ${m.artist}` : ''}</span>
    </button>
  )
}

export default function FeedCard({ p, liked, displayLikes, menuOpen, onToggleMenu, onLike, onComment, onShare, saved, onSave, onOpenUser }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLElement | null>(null)
  const autoPlaying = useRef(false)
  const scope = p.kind === 'Video' || p.kind === 'reel' ? 'reel' : 'post'

  // IG-style: once the member has interacted with audio at least once, a post
  // with a song track plays as it comes into view and pauses on the way out.
  useEffect(() => {
    const m = p.music
    if (!m?.url || !m.id) return
    if (p.video) return // a reel's own video owns the audio path
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (audioAutoplayReady() && !isPlayingId(m.id) && !autoPlaying.current) {
          autoPlaying.current = true
          void playTrack({ id: m.id, title: m.title, artist: m.artist || 'Harvest Family Church', url: m.url, artwork: m.cover_url || null, origin: 'feed' })
            .catch(() => {})
        }
      } else if (autoPlaying.current) {
        autoPlaying.current = false
        if (isPlayingId(m.id)) pausePlayer()
      }
    }, { threshold: [0, 0.6] })
    io.observe(el)
    return () => { io.disconnect() }
  }, [p.music, p.video])

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
        <MediaThumbnail alt="" className="block w-full h-auto max-h-[70vh] object-contain mx-auto" src={p.img} fallbackIcon="🖼️" />
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
