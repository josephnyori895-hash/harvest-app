import { useMemo } from 'react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'groups', label: 'Groups' },
  { id: 'departments', label: 'Departments' },
]

function categoryOf(n) {
  if (n?.category) return n.category
  if (n?.type === 'chat') return 'messages'
  if (n?.type === 'group_chat') return 'groups'
  if (n?.type === 'department_chat') return 'departments'
  return 'all'
}

function timeLabel(value) {
  const d = new Date(value || 0)
  if (!Number.isFinite(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`
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

function groupByDate(items) {
  const groups = new Map()
  for (const item of [...items].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))) {
    const label = groupLabel(item.created_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(item)
  }
  return [...groups].map(([label, notifications]) => ({ label, notifications }))
}

function iconFor(type) {
  if (type === 'group_chat') return '👥'
  if (type === 'department_chat') return '🏛'
  if (type === 'post_like') return '♡'
  if (type === 'post_comment') return '💬'
  if (type === 'sermon' || type === 'reel') return '▶'
  return '💬'
}

function Skeleton() {
  return <div role="status" aria-label="Loading notifications" className="space-y-1 py-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="mx-4 flex min-w-0 animate-pulse items-center gap-3 rounded-xl px-3 py-3" aria-hidden="true">
        <div className="h-11 w-11 shrink-0 rounded-full bg-black/10" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-2/5 rounded bg-black/10" />
          <div className="h-3 w-4/5 rounded bg-black/10" />
          <div className="h-3 w-3/5 rounded bg-black/10" />
        </div>
      </div>
    ))}
    <span className="sr-only">Loading notifications…</span>
  </div>
}

function ActionError({ message, onDismiss }) {
  if (!message) return null
  return <div role="alert" aria-live="assertive" className="mx-4 mb-3 flex min-w-0 items-center gap-3 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2.5">
    <span aria-hidden="true" className="shrink-0">⚠</span>
    <p className="min-w-0 flex-1 text-xs font-medium text-black/70">{message}</p>
    <button type="button" onClick={onDismiss} aria-label="Dismiss notification error" className="h-7 w-7 shrink-0 rounded-full text-black/50">×</button>
  </div>
}

function Item({ notification, pending, onPress }) {
  const unread = !notification?.read_at
  const title = notification?.title || notification?.actor?.name || 'Harvest Family'
  const body = notification?.body || notification?.message || 'You have a new notification.'
  const preview = notification?.preview
  const time = timeLabel(notification?.created_at)
  const label = [unread ? 'Unread.' : 'Read.', pending ? 'Saving read status.' : '', title, body, preview, time ? `Received ${time}.` : ''].filter(Boolean).join(' ')
  return <button type="button" onClick={() => onPress(notification)} aria-label={label} aria-busy={pending}
    className={`flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${unread ? 'bg-black/[0.035]' : ''}`}>
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-black/5">
      {notification?.actor?.avatar_url
        ? <img src={notification.actor.avatar_url} alt="" className="block h-full w-full object-cover" loading="lazy" />
        : <span className="flex h-full w-full items-center justify-center text-lg" aria-hidden="true">{iconFor(notification?.type)}</span>}
      {unread && !pending && <span aria-hidden="true" className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />}
    </div>
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 items-start gap-2">
        <p className={`min-w-0 flex-1 truncate text-sm leading-5 ${unread ? 'font-semibold text-black' : 'font-medium text-black/75'}`}>{title}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {pending && <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-black/15 border-t-black/60" />}
          {time && <time dateTime={notification?.created_at} className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-black/45">{time}</time>}
        </div>
      </div>
      <p className={`mt-0.5 min-w-0 truncate text-sm leading-5 ${unread ? 'text-black/75' : 'text-black/60'}`}>{body}</p>
      {preview && <p className="mt-0.5 min-w-0 truncate text-xs leading-4 text-black/45">{preview}</p>}
    </div>
  </button>
}

export default function NotificationsScreen({
  notifications = [], filter = 'all', loading = false, refreshing = false,
  error = null, actionError = null, unreadCount = 0,
  pendingNotificationIds = new Set(), markAllPending = false,
  onFilterChange, onNotificationPress, onRetry, onMarkAllRead,
  onDismissActionError, onBack,
}) {
  const filtered = useMemo(() => filter === 'all' ? notifications : notifications.filter(n => categoryOf(n) === filter), [notifications, filter])
  const groups = useMemo(() => groupByDate(filtered), [filtered])
  const initialLoading = loading && notifications.length === 0
  const initialError = Boolean(error) && notifications.length === 0 && !loading
  const empty = !loading && !error && filtered.length === 0
  const filterLabel = FILTERS.find(f => f.id === filter)?.label || 'All'

  return <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-white" aria-label="Notifications">
    <header className="flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-black/5 px-3">
      <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl focus:outline-none focus-visible:ring-2">←</button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">Notifications</h1>
      {unreadCount > 0 && <button type="button" onClick={onMarkAllRead} disabled={markAllPending} aria-label="Mark all notifications as read" aria-busy={markAllPending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold disabled:opacity-40">{markAllPending ? <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-black/15 border-t-black/60" /> : '✓'}</button>}
    </header>

    <div className="w-full min-w-0 shrink-0 border-b border-black/5" role="tablist" aria-label="Notification filters">
      <div className="flex w-full min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden px-4 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(item => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} aria-controls={`notifications-panel-${item.id}`} onClick={() => onFilterChange?.(item.id)} className={`inline-flex h-10 shrink-0 grow-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium ${filter === item.id ? 'bg-black text-white' : 'bg-black/5 text-black/70'}`}>{item.label}</button>)}
      </div>
    </div>

    <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto">
      {initialLoading && <Skeleton />}
      {initialError && <div role="alert" className="mx-4 my-6 rounded-xl border border-red-500/15 bg-red-500/5 p-4"><p className="text-sm font-semibold">Couldn’t load notifications</p><p className="mt-1 text-sm text-black/60">Check your connection and try again.</p><button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white">Retry</button></div>}
      {error && notifications.length > 0 && <div role="alert" className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2.5"><span aria-hidden="true">⚠</span><p className="min-w-0 flex-1 text-xs font-medium text-black/70">Couldn’t refresh notifications.</p><button type="button" onClick={onRetry} disabled={refreshing} className="shrink-0 text-xs font-semibold underline">{refreshing ? 'Retrying…' : 'Retry'}</button></div>}
      {actionError && <ActionError message={actionError} onDismiss={onDismissActionError} />}

      {!initialLoading && !initialError && empty && <div id={`notifications-panel-${filter}`} role="tabpanel" className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><div aria-hidden="true" className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-2xl">🔔</div><h2 className="text-base font-semibold">{notifications.length ? `No ${filterLabel.toLowerCase()} notifications` : 'You’re all caught up'}</h2><p className="mt-1 max-w-sm text-sm text-black/55">{notifications.length ? 'Activity for this filter will appear here.' : 'New notifications will appear here when there’s something to show.'}</p></div>}

      {!initialLoading && !initialError && filtered.length > 0 && <div id={`notifications-panel-${filter}`} role="tabpanel" aria-label={`${filterLabel} notifications`}>
        {refreshing && <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-black/45"><span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/15 border-t-black/60" />Refreshing notifications…</div>}
        {groups.map(group => <section key={group.label} aria-labelledby={`notification-group-${group.label}`} className="w-full min-w-0 max-w-full overflow-hidden">
          <div className="sticky top-0 z-10 bg-white/95 px-4 py-2 backdrop-blur"><h2 id={`notification-group-${group.label}`} className="truncate text-[11px] font-semibold tracking-wide text-black/45">{group.label}</h2></div>
          {group.notifications.map(n => <Item key={n.id} notification={n} pending={pendingNotificationIds.has(n.id)} onPress={onNotificationPress} />)}
        </section>)}
      </div>}
    </div>
  </main>
}
