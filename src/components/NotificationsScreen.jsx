import { useMemo, useState } from 'react'
import { Icon } from '../ui'
import { showToast } from './Toast'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'groups', label: 'Groups' },
  { id: 'departments', label: 'Departments' },
  { id: 'family', label: 'Family' },
]

function categoryOf(n) {
  if (n?.category) return n.category
  if (n?.type === 'chat') return 'messages'
  if (n?.type === 'group_chat') return 'groups'
  if (n?.type === 'department_chat') return 'departments'
  if (n?.type === 'member_joined' || n?.type === 'followed_you' || n?.type === 'you_followed') return 'family'
  return 'all'
}

function timeLabel(value) {
  const d = new Date(value || 0)
  if (!Number.isFinite(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function groupLabel(value) {
  const d = new Date(value || 0)
  if (!Number.isFinite(d.getTime())) return 'OLDER'
  const now = new Date()
  const a = new Date(now); a.setHours(0, 0, 0, 0)
  const b = new Date(d); b.setHours(0, 0, 0, 0)
  const days = Math.round((a - b) / 86400000)
  if (days === 0) return 'TODAY'
  if (days === 1) return 'YESTERDAY'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Instagram grammar: several people appreciating the same post is one row
// ("Joy and 3 others liked your post"), not four near-identical rows. Comments,
// follows and joins stay separate — each one has its own actor to act on.
const MERGED_LIKES = new Set(['post_like', 'like'])

function mergeLikes(items) {
  const out = []
  const byTarget = new Map()
  for (const n of items) {
    if (!MERGED_LIKES.has(n?.type)) { out.push({ ...n, others: [] }); continue }
    const key = `${n?.target?.type || ''}|${n?.target?.id || ''}`
    const existing = byTarget.get(key)
    if (existing) existing.others.push(n)
    else {
      const row = { ...n, others: [] }
      byTarget.set(key, row)
      out.push(row)
    }
  }
  return out
}

function groupByDate(items) {
  const groups = new Map()
  const sorted = [...items].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  for (const item of mergeLikes(sorted)) {
    const label = groupLabel(item.created_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(item)
  }
  return [...groups].map(([label, notifications]) => ({ label, notifications }))
}

// A notification type is UI, so it gets a stroke icon from the design system
// rather than an emoji glyph that renders differently on every device.
function iconFor(type) {
  if (type === 'group_chat') return 'users'
  if (type === 'department_chat') return 'building'
  if (type === 'member_joined') return 'smile'
  if (type === 'followed_you') return 'heart'
  if (type === 'you_followed') return 'heart'
  if (type === 'post_like') return 'heart'
  if (type === 'post_comment') return 'chat'
  if (type === 'sermon' || type === 'reel') return 'play'
  return 'chat'
}

function Skeleton() {
  return <div role="status" aria-label="Loading notifications" className="space-y-1 py-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="mx-3 flex min-w-0 animate-pulse items-center gap-3 rounded-xl px-3 py-3" aria-hidden="true">
        <div className="h-11 w-11 shrink-0 rounded-full bg-ink/10" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-2/5 rounded bg-ink/10" />
          <div className="h-3 w-4/5 rounded bg-ink/10" />
          <div className="h-3 w-3/5 rounded bg-ink/10" />
        </div>
      </div>
    ))}
    <span className="sr-only">Loading notifications…</span>
  </div>
}

function ActionError({ message, onDismiss }) {
  if (!message) return null
  return <div role="alert" aria-live="assertive" className="mx-3 mb-3 flex min-w-0 items-center gap-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5">
    <Icon name="alert" size={15} className="shrink-0 text-danger" />
    <p className="min-w-0 flex-1 text-xs font-medium text-danger">{message}</p>
    <button type="button" onClick={onDismiss} aria-label="Dismiss notification error" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted active:bg-surface-sunken"><Icon name="close" size={14} /></button>
  </div>
}

function Item({ notification, others = [], pending, onPress, canFollow, following, followPending, onFollow }) {
  const unread = !notification?.read_at
  const baseTitle = notification?.title || notification?.actor?.name || 'Harvest Family'
  const more = others.length
  const title = more ? `${baseTitle} and ${more} other${more === 1 ? '' : 's'}` : baseTitle
  const body = notification?.body || notification?.message || 'You have a new notification.'
  const preview = notification?.preview
  const time = timeLabel(notification?.created_at)
  const label = [unread ? 'Unread.' : 'Read.', pending ? 'Saving read status.' : '', title, body, preview, time ? `Received ${time}.` : ''].filter(Boolean).join(' ')
  const press = () => onPress(notification, others.map(o => o.id))

  return <div className={`flex min-w-0 max-w-full items-center gap-1 pl-4 pr-2 transition-colors ${unread ? 'bg-accent-soft/70' : ''}`}>
    <button type="button" onClick={press} aria-label={label} aria-busy={pending}
      className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent active:opacity-80">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
        {notification?.actor?.avatar_url
          ? <img src={notification.actor.avatar_url} alt="" className="block h-full w-full object-cover" loading="lazy" />
          : <span className="flex h-full w-full items-center justify-center text-ink-muted" aria-hidden="true"><Icon name={iconFor(notification?.type)} size={18} /></span>}
        {unread && !pending && <span aria-hidden="true" className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-danger" />}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-start gap-2">
          <p className={`min-w-0 flex-1 truncate text-sm leading-5 ${unread ? 'font-bold text-ink' : 'font-medium text-ink'}`}>{title}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            {pending && <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-ink/15 border-t-ink/60" />}
            {time && <time dateTime={notification?.created_at} className="shrink-0 whitespace-nowrap text-[11px] font-medium leading-4 tabular-nums text-ink-subtle">{time}</time>}
          </div>
        </div>
        <p className={`mt-0.5 min-w-0 truncate text-sm leading-5 ${unread ? 'text-ink-muted' : 'text-ink-muted/85'}`}>{body}</p>
        {preview && <p className="mt-0.5 min-w-0 truncate text-xs leading-4 text-ink-subtle">{preview}</p>}
      </div>
    </button>
    {canFollow && (
      <button
        type="button"
        onClick={() => onFollow(notification.actor.username)}
        disabled={followPending || following}
        aria-label={following ? `Following ${notification.actor.username}` : `Follow back ${notification.actor.username}`}
        className={`shrink-0 rounded-full border px-3 text-xs font-bold transition-colors ${following ? 'border-line bg-surface-sunken text-ink-muted' : 'border-accent/40 bg-accent-soft text-accent-strong active:bg-accent-soft/70'} min-h-10 disabled:opacity-60`}
      >
        {following ? 'Following' : followPending ? '…' : 'Follow back'}
      </button>
    )}
  </div>
}

export default function NotificationsScreen({
  notifications = [], filter = 'all', loading = false, refreshing = false,
  error = null, actionError = null, unreadCount = 0,
  pendingNotificationIds = new Set(), markAllPending = false,
  hasMore = false, loadingMore = false,
  onFilterChange, onNotificationPress, onRetry, onMarkAllRead,
  onDismissActionError, onBack, onLoadMore,
}) {
  const filtered = useMemo(() => filter === 'all' ? notifications : notifications.filter(n => categoryOf(n) === filter), [notifications, filter])
  const groups = useMemo(() => groupByDate(filtered), [filtered])
  const initialLoading = loading && notifications.length === 0
  const initialError = Boolean(error) && notifications.length === 0 && !loading
  const empty = !loading && !error && filtered.length === 0
  const filterLabel = FILTERS.find(f => f.id === filter)?.label || 'All'

  const me = (() => { try { return String(localStorage.getItem('harvest_username') || '').toLowerCase() } catch { return '' } })()
  const [followed, setFollowed] = useState(() => new Set())
  const [followBusy, setFollowBusy] = useState(() => new Set())
  const [followError, setFollowError] = useState('')

  // POST /api/users/:username/follow toggles, so a member who already follows
  // back would be unfollowed by pressing the button. The row exists because
  // they followed us; the intent here is always "follow", so a toggle-off is
  // immediately restored.
  const followBack = async (username) => {
    const uname = String(username || '').toLowerCase()
    if (!uname || followed.has(uname) || followBusy.has(uname)) return
    setFollowBusy(prev => new Set(prev).add(uname))
    setFollowError('')
    const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    const token = localStorage.getItem('harvest_token') || ''
    const post = async () => {
      const r = await fetch(`${base}/api/users/${encodeURIComponent(uname)}/follow`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not follow (${r.status})`)
      return d
    }
    try {
      let d = await post()
      if (d?.following === false) d = await post()
      setFollowed(prev => new Set(prev).add(uname))
      showToast('Following — you will see their updates', 'success', 1800)
    } catch (e) {
      setFollowError(e?.message || 'Could not follow. Check your connection and try again.')
    } finally {
      setFollowBusy(prev => { const next = new Set(prev); next.delete(uname); return next })
    }
  }

  const handleScroll = (e) => {
    if (!hasMore || loadingMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) onLoadMore?.()
  }

  return <main className="flex h-full min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-surface" aria-label="Notifications">
    <header className="flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-line px-2.5">
      <button type="button" onClick={onBack} aria-label="Back" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-surface-sunken"><Icon name="arrow-left" size={20} /></button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold text-ink">Notifications</h1>
      {unreadCount > 0 && <button type="button" onClick={onMarkAllRead} disabled={markAllPending} aria-label="Mark all notifications as read" aria-busy={markAllPending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-surface-sunken disabled:opacity-40">{markAllPending ? <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/15 border-t-ink/60" /> : <Icon name="check" size={18} />}</button>}
    </header>

    <div className="w-full min-w-0 max-w-full shrink-0 border-b border-line" role="group" aria-label="Filter notifications">
      <div className="flex w-full min-w-0 max-w-full flex-nowrap gap-2 overflow-x-auto overflow-y-hidden px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => onFilterChange?.(item.id)} className={`inline-flex h-10 max-w-full shrink-0 grow-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors active:scale-[.98] ${filter === item.id ? 'bg-ink text-surface' : 'bg-surface-sunken text-ink-muted'}`}>{item.label}</button>)}
      </div>
    </div>

    <div onScroll={handleScroll} className="pane-scroll min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
      {initialLoading && <Skeleton />}
      {initialError && <div role="alert" className="mx-3 my-5 rounded-xl border border-danger/25 bg-danger-soft p-4"><p className="text-sm font-bold text-danger">Couldn’t load notifications</p><p className="mt-1 text-sm text-ink-muted">Check your connection and try again.</p><button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-surface">Retry</button></div>}
      {error && notifications.length > 0 && <div role="alert" className="mx-3 my-3 flex items-center gap-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5"><Icon name="alert" size={16} className="shrink-0 text-danger" /><p className="min-w-0 flex-1 text-xs font-medium text-danger">Couldn’t refresh notifications.</p><button type="button" onClick={onRetry} disabled={refreshing} className="shrink-0 text-xs font-bold text-danger underline">{refreshing ? 'Retrying…' : 'Retry'}</button></div>}
      {actionError && <ActionError message={actionError} onDismiss={onDismissActionError} />}
      {followError && <ActionError message={followError} onDismiss={() => setFollowError('')} />}

      {!initialLoading && !initialError && empty && <div role="region" aria-label={`${filterLabel} notifications`} className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><div aria-hidden="true" className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface-sunken text-ink-subtle"><Icon name="bell" size={22} /></div><h2 className="text-base font-extrabold text-ink">{notifications.length ? `No ${filterLabel.toLowerCase()} notifications` : 'You’re all caught up'}</h2><p className="mt-1 max-w-sm text-sm text-ink-muted">{notifications.length ? 'Activity for this filter will appear here.' : 'New notifications will appear here when there’s something to show.'}</p></div>}

      {!initialLoading && !initialError && filtered.length > 0 && <div role="region" aria-label={`${filterLabel} notifications`} className="min-w-0 max-w-full">
        {refreshing && <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-ink-subtle"><span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/15 border-t-ink/60" />Refreshing notifications…</div>}
        {groups.map(group => <section key={group.label} aria-labelledby={`notification-group-${group.label}`} className="w-full min-w-0 max-w-full overflow-hidden">
          <div className="sticky top-0 z-10 bg-surface/95 px-4 py-2 backdrop-blur"><h2 id={`notification-group-${group.label}`} className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle">{group.label}</h2></div>
          {group.notifications.map(n => <Item
            key={n.id}
            notification={n}
            others={n.others}
            pending={pendingNotificationIds.has(n.id)}
            onPress={onNotificationPress}
            canFollow={(n.type === 'follow' || n.type === 'followed_you') && Boolean(n.actor?.username) && String(n.actor.username).toLowerCase() !== me}
            following={followed.has(String(n.actor?.username || '').toLowerCase())}
            followPending={followBusy.has(String(n.actor?.username || '').toLowerCase())}
            onFollow={followBack}
          />)}
        </section>)}
        {hasMore && <div className="px-3 py-4">
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface-raised text-xs font-extrabold text-accent-strong transition-colors active:bg-surface-sunken disabled:opacity-50">
            {loadingMore ? <><span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/15 border-t-ink/60" />Loading older…</> : 'Load older notifications'}
          </button>
        </div>}
        {!hasMore && notifications.length >= 40 && <p className="px-4 py-4 text-center text-xs text-ink-subtle">You’re all caught up</p>}
      </div>}
    </div>
  </main>
}
