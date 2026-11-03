import { useCallback, useEffect, useRef, useState } from 'react'

import ErrorMessage from './ErrorMessage'
import { timeAgo } from '../lib/time'
import { Icon } from '../ui'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type Comment = {
  id: string; username: string; body: string; created_at: string; verified?: boolean
  likes?: number; liked?: boolean; parent_id?: string | null
}

const initials = (name: string) => {
  const parts = String(name || '?').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean)
  const out = parts.map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return out || '?'
}

// Comments sheet for posts and reels, on post_comments.
//
// Row grammar follows a feed comment: avatar, "username body", a quiet meta
// line (time · likes · Reply), and the reaction on the right edge. One level of
// replies nests under its parent. Members can react and reply; authors and
// admins can delete. The composer is pinned above the safe area.
export default function Comments({
  scope,
  postId,
  me,
  isAdmin,
  onCountChange,
  onClose,
}: {
  scope: 'post' | 'reel' | 'sermon'
  postId: string | number
  me: string
  isAdmin: boolean
  onCountChange?: (delta: number) => void
  onClose: () => void
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loadError, setLoadError] = useState('')
  const [sendError, setSendError] = useState('')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [busyLike, setBusyLike] = useState<Record<string, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const token = useCallback(() => localStorage.getItem('harvest_token') || '', [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(`${API}/api/comments?scope=${scope}&id=${encodeURIComponent(String(postId))}`, {
        headers: token() ? { Authorization: `Bearer ${token()}` } : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Could not load comments (${res.status})`)
      setComments(Array.isArray(data?.comments) ? data.comments : [])
      setLoadError('')
    } catch (e: any) {
      setComments([])
      setLoadError(e?.message || 'Could not load comments — check your connection')
    } finally {
      setLoading(false)
    }
  }, [scope, postId, token])

  useEffect(() => { void load() }, [load])

  // Show parents NEWEST FIRST with each reply nested directly under its parent,
  // replies kept in chronological order under the parent.
  const grouped = (() => {
    const parents: Comment[] = comments.filter(c => !c.parent_id)
    const byParent: Record<string, Comment[]> = {}
    for (const r of comments.filter(x => x.parent_id)) (byParent[r.parent_id as string] ||= []).push(r)
    return parents.map(p => ({ parent: p, replies: (byParent[p.id] || []).slice().reverse() }))
  })()

  // Keep the newest comment in view as the list grows (newest sits at top).
  useEffect(() => {
    if (comments.length) listRef.current?.scrollTo({ top: 0 })
  }, [comments.length])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const res = await fetch(`${API}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: JSON.stringify({ scope, id: String(postId), body, parent_id: replyTo ? replyTo.parent_id || replyTo.id : undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.comment) {
        setComments(prev => [data.comment as Comment, ...prev])
        setText('')
        setReplyTo(null)
        onCountChange?.(1)
      } else {
        setSendError(data?.error || (res.status === 401 ? 'Session expired — sign in again to comment' : `Could not post (${res.status})`))
        window.dispatchEvent(new CustomEvent('harvest:comment-error', { detail: res.status }))
      }
    } catch {
      setSendError('Network problem — your draft is kept, try again')
      /* keep the draft so nothing is lost */
    } finally {
      setSending(false)
    }
  }

  const toggleLike = async (c: Comment) => {
    if (busyLike[c.id]) return
    setBusyLike(b => ({ ...b, [c.id]: true }))
    try {
      const res = await fetch(`${API}/api/comments/${encodeURIComponent(c.id)}/like`, {
        method: 'POST',
        headers: token() ? { Authorization: `Bearer ${token()}` } : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error()
      setComments(prev => prev.map(x => String(x.id) === String(c.id) ? { ...x, likes: Number(data.likes) || 0, liked: !!data.liked } : x))
    } catch {
      setSendError('Could not save that reaction — try again')
    } finally {
      setBusyLike(b => ({ ...b, [c.id]: false }))
    }
  }

  const remove = async (id: string) => {
    setRemoveError('')
    try {
      setComments(c => {
        const gone = c.find(x => x.id === id)
        const removed = 1 + (gone && !gone.parent_id ? c.filter(x => x.parent_id === id).length : 0)
        onCountChange?.(-removed)
        return c.filter(x => x.id !== id && x.parent_id !== id)
      })
      const res = await fetch(`${API}/api/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token() ? { Authorization: `Bearer ${token()}` } : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Could not delete comment (${res.status})`)
    } catch (e: any) {
      void load()
      setRemoveError(e?.message || 'Could not delete comment — try again')
    }
  }

  const startReply = (c: Comment) => {
    const target = c.parent_id ? comments.find(x => x.id === c.parent_id) || c : c
    setReplyTo(target)
    setSendError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const Row = ({ c, nested = false }: { c: Comment; nested?: boolean }) => {
    const mine = c.username === me
    return (
      <div className={`flex items-start gap-2.5 ${nested ? 'ml-9' : ''}`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-gold-soft text-2xs font-extrabold text-accent-strong">
          {initials(c.username)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5 text-ink">
            <span className="font-extrabold">{c.username}</span>
            {c.verified && (
              <span role="img" aria-label="Verified account" className="ml-1 inline-grid h-[13px] w-[13px] translate-y-[-1px] place-items-center rounded-full bg-accent text-white">
                <Icon name="check" size={8} strokeWidth={3.2} />
              </span>
            )}
            <span className="ml-1.5 break-words text-ink-muted">{c.body}</span>
          </p>
          <div className="mt-1 flex items-center gap-3 text-2xs text-ink-subtle">
            <span>{timeAgo(c.created_at)}</span>
            {Number(c.likes) > 0 && <span>{Number(c.likes)} like{Number(c.likes) === 1 ? '' : 's'}</span>}
            <button type="button" onClick={() => startReply(c)} className="min-h-7 font-extrabold text-ink-muted" aria-label={`Reply to ${c.username}`}>Reply</button>
            {(isAdmin || mine) && (
              <button type="button" onClick={() => void remove(c.id)} className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-subtle transition hover:text-danger" aria-label="Delete comment">
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleLike(c)}
          disabled={!!busyLike[c.id]}
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-90 disabled:opacity-50"
          aria-pressed={!!c.liked}
          aria-label={c.liked ? `Unlike comment by ${c.username}` : `Like comment by ${c.username}`}
        >
          <Icon name="heart" size={15} strokeWidth={c.liked ? 2.4 : 1.7} className={c.liked ? 'fill-current text-danger' : 'text-ink-subtle'} />
        </button>
      </div>
    )
  }

  const total = comments.length

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-label="Comments">
      <div
        className="comments-sheet flex max-h-[min(82dvh,720px)] w-full min-h-0 flex-col overflow-hidden rounded-t-3xl border border-line bg-surface-raised sm:max-w-lg sm:rounded-3xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-line px-3 pb-2 pt-2">
          <span className="mx-auto mb-1.5 block h-1 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-center gap-2">
            <p className="flex-1 text-center text-sm font-extrabold text-ink">
              Comments{total > 0 && <span className="ml-1.5 text-2xs font-bold text-ink-subtle">{total}</span>}
            </p>
            <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-muted transition hover:bg-surface-sunken" aria-label="Close comments">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3">
          {loading && (
            <div className="space-y-4" aria-label="Loading comments">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-2.5 w-1/3 rounded-full" />
                    <div className="skeleton h-2.5 w-4/5 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && loadError && (
            <ErrorMessage message={loadError} action={<button type="button" onClick={() => void load()} className="text-2xs font-extrabold underline">Retry</button>} />
          )}
          {!loadError && comments.length === 0 && !loading && (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="mb-2 grid h-11 w-11 place-items-center rounded-full bg-surface-sunken text-ink-muted">
                <Icon name="chat" size={20} />
              </span>
              <p className="text-sm font-bold text-ink">No comments yet</p>
              <p className="mt-1 text-2xs text-ink-muted">Be the first to encourage someone.</p>
            </div>
          )}
          {grouped.map(({ parent, replies }) => (
            <div key={parent.id} className="space-y-3">
              <Row c={parent} />
              {replies.map(r => <Row key={r.id} c={r} nested />)}
            </div>
          ))}
        </div>

        {removeError && <div className="mx-3 mb-1 shrink-0"><ErrorMessage message={removeError} /></div>}
        {sendError && <div className="mx-3 mb-1 shrink-0"><ErrorMessage message={sendError} /></div>}

        {replyTo && (
          <div className="mx-3 mb-1 flex shrink-0 items-center gap-2 rounded-xl border border-line bg-surface-sunken px-2.5 py-1.5 text-2xs">
            <Icon name="reply" size={13} className="shrink-0 text-accent" />
            <span className="truncate text-ink-muted">Replying to <b>@{replyTo.username}</b></span>
            <button onClick={() => setReplyTo(null)} className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-muted" aria-label="Cancel reply">
              <Icon name="close" size={13} />
            </button>
          </div>
        )}

        <div
          className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-raised px-3 pt-2"
          style={{ paddingBottom: 'calc(0.5rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))' }}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-gold-soft text-2xs font-extrabold text-accent-strong">
            {initials(me)}
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={e => { setText(e.target.value); setSendError('') }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder={replyTo ? `Reply to @${replyTo.username}…` : 'Add a comment…'}
            maxLength={1000}
            aria-label={replyTo ? `Reply to ${replyTo.username}` : 'Add a comment'}
            className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            className="min-h-11 shrink-0 px-2 text-2xs font-extrabold text-accent disabled:opacity-40"
          >
            {sending ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
