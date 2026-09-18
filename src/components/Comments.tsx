import { useCallback, useEffect, useRef, useState } from 'react'

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function timeAgo(iso?: string) {
  if (!iso) return 'Just now'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

type Comment = { id: string; username: string; body: string; created_at: string; verified?: boolean }

// Instagram-style inline comments sheet — used by Home (posts) and Reels.
// Comments live on the server (post_comments table); no chat involvement.
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
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const res = await fetch(`${API}/api/comments?scope=${scope}&id=${encodeURIComponent(String(postId))}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json().catch(() => ({}))
      setComments(Array.isArray(data?.comments) ? data.comments : [])
    } catch {
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [scope, postId])

  useEffect(() => { void load() }, [load])

  // Keep the newest comment in view as the list grows.
  useEffect(() => {
    if (comments.length) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [comments.length])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const res = await fetch(`${API}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ scope, id: String(postId), body }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.comment) {
        setComments(c => [...c, data.comment])
        setText('')
        onCountChange?.(1)
      }
    } catch {
      /* network error — keep the draft so nothing is lost */
    } finally {
      setSending(false)
    }
  }

  const remove = async (id: string) => {
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const res = await fetch(`${API}/api/comments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (res.ok) {
        setComments(c => c.filter(x => x.id !== id))
        onCountChange?.(-1)
      }
    } catch { /* leave the comment visible; server count unchanged */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose} role="dialog" aria-label="Comments">
      <div className="w-full sm:max-w-lg bg-[#FFFBF0] rounded-t-[28px] max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2 border-b border-[#E8DEC9] flex items-center justify-between shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#E8DEC9] absolute left-1/2 -translate-x-1/2 top-2" />
          <p className="text-sm font-extrabold mx-auto">Comments</p>
          <button onClick={onClose} className="absolute right-4 top-3 w-7 h-7 rounded-full bg-[#F4E8D0] text-[#766E63] text-xs font-bold" aria-label="Close comments">✕</button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && <p className="text-xs text-[#8B8175] text-center py-6">Loading comments…</p>}
          {!loading && comments.length === 0 && (
            <div className="text-center py-10">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm font-bold">No comments yet</p>
              <p className="text-xs text-[#8B8175] mt-1">Be the first to encourage someone.</p>
            </div>
          )}
          {comments.map(c => (
            <div key={c.id} className="flex gap-2.5">
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
              </div>
              {(isAdmin || c.username === me) && (
                <button onClick={() => remove(c.id)} className="shrink-0 self-start text-[11px] text-[#B45309] font-bold px-1.5 py-1 rounded-lg" aria-label="Delete comment">🗑</button>
              )}
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#E8DEC9] flex gap-2 shrink-0 bg-[#FFFBF0] rounded-b-[28px]">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder="Add a comment…"
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
