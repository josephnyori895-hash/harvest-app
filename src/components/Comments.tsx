import { useCallback, useEffect, useRef, useState } from 'react'

import ErrorMessage from './ErrorMessage'
import { timeAgo } from '../lib/time'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type Comment = {
  id: string; username: string; body: string; created_at: string; verified?: boolean
  likes?: number; liked?: boolean; parent_id?: string | null
}

// Inline comments sheet (posts + reels) on post_comments. Members can like
// comments and reply one level deep — parity with the common social pattern,
// rendered in the app's cream style.
export default function Comments({
  scope,
  postId,
  me,
  isAdmin,
  onCountChange,
  onClose,
}: {
  scope: 'post' | 'reel'
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

  // Show parents NEWEST FIRST (IG-style) with each reply nested directly under
  // its parent, replies kept in chronological order under the parent.
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
        // Newest-first list: a fresh comment takes the top slot immediately.
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
      setComments(c => c) /* re-render only */
      void load()
      setRemoveError(e?.message || 'Could not delete comment — try again')
    }
  }

  const startReply = (c: Comment) => {
    const target = c.parent_id ? comments.find(x => x.id === c.parent_id) || c : c
    setReplyTo(target)
    setText(prev => prev) /* keep draft */
    setSendError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const Row = ({ c, nested = false }: { c: Comment; nested?: boolean }) => (
    <div className={`flex gap-2.5 ${nested ? 'ml-8' : ''}`}>
      <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-[#EDE9FE] to-[#FEF3C7] flex items-center justify-center text-[10px] font-extrabold text-[#5B21B6]">
        {String(c.username).charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="font-extrabold text-[#29251F]">{c.username}</span>
          {c.verified && <span className="ml-1 text-[#0F766E]">✓</span>}
          <span className="ml-2 text-[#8B8175]">{timeAgo(c.created_at)}</span>
        </p>
        <p className="text-sm text-[#4B433A] break-words">{c.body}</p>
        <div className="mt-0.5 -ml-1 flex items-center gap-1 text-[11px] text-[#766E63]">
          <button
            type="button"
            onClick={() => void toggleLike(c)}
            disabled={!!busyLike[c.id]}
            className={`min-w-9 min-h-7 px-2 rounded-full font-bold active:scale-95 transition disabled:opacity-50 ${c.liked ? 'text-[#B45309]' : 'text-[#766E63]'}`}
            aria-pressed={!!c.liked}
            aria-label={c.liked ? 'Unlike comment' : 'Like comment'}
          >{c.liked ? '♥' : '♡'}{c.likes ? ` ${c.likes}` : ''}</button>
          <button type="button" onClick={() => startReply(c)} className="min-h-7 px-2 rounded-full font-bold hover:bg-[#F5F1E8]" aria-label={`Reply to ${c.username}`}>Reply</button>
        </div>
      </div>
      {(isAdmin || c.username === me) && (
        <button onClick={() => remove(c.id)} className="shrink-0 self-start min-w-9 min-h-9 text-[11px] text-[#B45309] font-bold px-2 rounded-lg" aria-label="Delete comment">🗑</button>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose} role="dialog" aria-label="Comments">
      <div className="comments-sheet w-full sm:max-w-lg bg-[#FFFBF0] rounded-t-[28px] max-h-[min(75dvh,680px)] min-h-0 flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2 border-b border-[#E8DEC9] flex items-center justify-between shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#E8DEC9] absolute left-1/2 -translate-x-1/2 top-2" />
          <p className="text-sm font-extrabold mx-auto">Comments</p>
          {/* 44px tap target (audit #10) — was 28px, thumbs kept missing it */}
          <button onClick={onClose} className="absolute -right-1 -top-1 w-12 h-12 flex items-center justify-center text-[#766E63]" aria-label="Close comments"><span className="w-9 h-9 rounded-full bg-[#F4E8D0] flex items-center justify-center text-sm font-bold">✕</span></button>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
          {loading && <p className="text-xs text-[#8B8175] text-center py-6">Loading comments…</p>}
          {!loading && !loadError && comments.length === 0 && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm font-bold">No comments yet</p>
              <p className="text-xs text-[#8B8175] mt-1">Be the first to encourage someone.</p>
            </div>
          )}
          {!loading && loadError && <ErrorMessage message={loadError} action={<button type="button" onClick={() => void load()} className="text-xs font-bold underline">Retry</button>} />}
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
          <div className="mx-3 mb-1 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F5F1E8] border border-[#E8DEC9] text-xs">
            <span className="text-[#7C3AED] font-bold shrink-0">↳</span>
            <span className="truncate text-[#4B433A]">Replying to <b>@{replyTo.username}</b> · {replyTo.body.slice(0, 40)}{replyTo.body.length > 40 ? '…' : ''}</span>
            <button onClick={() => setReplyTo(null)} className="ml-auto w-7 h-7 rounded-full bg-white border border-[#E8DEC9] text-[#766E63]" aria-label="Cancel reply">✕</button>
          </div>
        )}
        <div className="p-3 border-t border-[#E8DEC9] flex gap-2 shrink-0 bg-[#FFFBF0] rounded-b-[28px]" style={{ paddingBottom: `calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))` }}>
          <input
            ref={inputRef}
            value={text}
            onChange={e => { setText(e.target.value); setSendError('') }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder={replyTo ? `Reply to @${replyTo.username}…` : 'Add a comment…'}
            maxLength={1000}
            className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl bg-white border border-[#E8DEC9] text-sm focus:outline-none focus:border-[#7C3AED]"
          />
          <button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            className="px-4 py-2.5 rounded-2xl bg-[#7C3AED] text-white text-xs font-extrabold disabled:opacity-40"
          >
            {sending ? '…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
