// Harvest Family design system.
//
// One module, no dependencies: icons, buttons, cards, fields, badges, dialogs,
// empty and loading states. Screens compose these instead of hand-rolling
// Tailwind soup, so a visual decision is made once and enforced by review.
//
// Rules:
//   * colours come from the semantic tokens in src/index.css (surface, ink,
//     line, accent, gold, success, danger) — never raw hex;
//   * no UI text below 12px (text-2xs is the floor);
//   * 44px minimum touch target on interactive elements.
import {
  createPortal,
} from 'react-dom'
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

/* ── Icons ─────────────────────────────────────────────────────────────────
   A curated stroke set on a 24px grid. Emoji are not UI. */
export type IconName =
  | 'home' | 'search' | 'reels' | 'plus' | 'gift' | 'chat' | 'user' | 'bell'
  | 'heart' | 'building' | 'globe' | 'coins' | 'phone' | 'check' | 'clock'
  | 'alert' | 'info' | 'close' | 'copy' | 'retry' | 'chevron-right'
  | 'chevron-down' | 'bank' | 'shield' | 'bookmark' | 'camera' | 'dots'
  | 'arrow-left' | 'send' | 'reply' | 'star' | 'trash' | 'share' | 'users' | 'smile'
  | 'play' | 'pause' | 'music' | 'mic' | 'sparkle' | 'pencil' | 'volume' | 'volume-x'

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: <><path d="M3 10.7 12 3.2l9 7.5" /><path d="M5.4 9.6V20h13.2V9.6" /></>,
  search: <><circle cx="11" cy="11" r="6.6" /><path d="m16 16 4.6 4.6" /></>,
  reels: <><rect x="3.2" y="3.6" width="17.6" height="16.8" rx="4.4" /><path d="m10.4 8.6 5.2 3.4-5.2 3.4z" /></>,
  plus: <><path d="M12 5.2v13.6" /><path d="M5.2 12h13.6" /></>,
  gift: <><rect x="3.4" y="8.6" width="17.2" height="11.8" rx="2.2" /><path d="M3.4 12.8h17.2" /><path d="M12 8.6V20.4" /><path d="M12 8.6c-1.2-3-3.4-4.2-4.9-3.2-1.4 1 .1 3.2 4.9 3.2Zm0 0c1.2-3 3.4-4.2 4.9-3.2 1.4 1-.1 3.2-4.9 3.2Z" /></>,
  chat: <path d="M20.4 11.8a8.1 8.1 0 0 1-11.9 7.1L4 20.2l1.4-4.4a8.1 8.1 0 1 1 15-4Z" />,
  user: <><circle cx="12" cy="8.4" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  bell: <><path d="M18 15.4V10a6 6 0 1 0-12 0v5.4L4.4 18h15.2L18 15.4Z" /><path d="M10.4 20.6a2 2 0 0 0 3.2 0" /></>,
  heart: <path d="M12 20s-7.6-4.4-7.6-9.4A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.6 3C19.6 15.6 12 20 12 20Z" />,
  building: <><path d="M4.4 20.4V5.2l7-2.2v17.4" /><path d="M11.4 20.4h8.2V9.6l-8.2-3" /><path d="M7 8.4h1.4M7 12h1.4M7 15.6h1.4M14.4 11h1.8M14.4 14.6h1.8" /></>,
  globe: <><circle cx="12" cy="12" r="8.4" /><path d="M3.6 12h16.8" /><path d="M12 3.6c2.6 3 2.6 13.8 0 16.8-2.6-3-2.6-13.8 0-16.8Z" /></>,
  coins: <><circle cx="9.2" cy="9.4" r="5" /><path d="M15.6 8.4a4.6 4.6 0 1 1-6.2 6.9" /><path d="M7.6 9.4h3.2" /></>,
  phone: <path d="M7.4 3.8 9.8 9l-2 1.8a11 11 0 0 0 5.4 5.4l1.8-2 5.2 2.4v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 3.4 6a2 2 0 0 1 2-2.2h2Z" />,
  check: <path d="m4.6 12.6 4.8 4.8L19.8 7" />,
  clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.4V12l3.4 2.2" /></>,
  alert: <><path d="M12 3.8 21 20H3l9-16.2Z" /><path d="M12 9.4v4.4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="8.4" /><path d="M12 11v5.4" /><path d="M12 7.8h.01" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: <><rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2.2" /><path d="M15.6 4.4H6.6a2.2 2.2 0 0 0-2.2 2.2v9" /></>,
  retry: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4.6V9h-4.4" /></>,
  'chevron-right': <path d="m9.4 5.6 6.4 6.4-6.4 6.4" />,
  'chevron-down': <path d="m5.6 9.4 6.4 6.4 6.4-6.4" />,
  bank: <><path d="M3.6 9.4 12 4l8.4 5.4" /><path d="M5.6 20V10.2M10 20V10.2M14 20V10.2M18.4 20V10.2" /><path d="M3.4 20.4h17.2" /></>,
  shield: <><path d="M12 3.4 19.4 6v5.4c0 4.4-3 7.6-7.4 9.2-4.4-1.6-7.4-4.8-7.4-9.2V6L12 3.4Z" /><path d="m9 12 2.2 2.2L15.4 10" /></>,
  bookmark: <path d="M6.4 3.8h11.2v16.4L12 16.2l-5.6 4V3.8Z" />,
  camera: <><path d="M4.4 8.6h3l1.6-2.4h6l1.6 2.4h3v10.8H4.4V8.6Z" /><circle cx="12" cy="13.8" r="3.2" /></>,
  dots: <><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>,
  'arrow-left': <><path d="M20.4 12H4.6" /><path d="m10.6 5.4-6.4 6.6 6.4 6.6" /></>,
  send: <><path d="M21 3.4 3.8 10.2l6.6 2.6 2.6 6.6L21 3.4Z" /><path d="m10.4 12.8 4.6-4.6" /></>,
  reply: <><path d="m9.6 5.4-6.6 6.6 6.6 6.6" /><path d="M3.4 12h9.4a7.2 7.2 0 0 1 7.2 7.2v.4" /></>,
  star: <path d="m12 3.6 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 10l6-.9L12 3.6Z" />,
  trash: <><path d="M4.4 6.6h15.2" /><path d="M9.2 6.6V4.2h5.6v2.4" /><path d="m6.4 6.6 1 13.6h9.2l1-13.6" /><path d="M10.2 10.4v6M13.8 10.4v6" /></>,
  share: <><path d="M12 15.8V4.2" /><path d="m7.6 8.6 4.4-4.4 4.4 4.4" /><path d="M5.2 14v4.6a1.8 1.8 0 0 0 1.8 1.8h10a1.8 1.8 0 0 0 1.8-1.8V14" /></>,
  users: <><circle cx="9.4" cy="8.6" r="3.2" /><path d="M3.4 19.8a6 6 0 0 1 12 0" /><path d="M16.2 5.8a3.2 3.2 0 0 1 0 5.6" /><path d="M17.8 14.4a5.6 5.6 0 0 1 2.8 5.4" /></>,
  smile: <><circle cx="12" cy="12" r="8.4" /><path d="M8.6 14a4.2 4.2 0 0 0 6.8 0" /><path d="M9.2 9.6h.01M14.8 9.6h.01" /></>,
  play: <path d="M8.4 5.6 18.6 12 8.4 18.4V5.6Z" />,
  pause: <><path d="M9.4 5.4v13.2" /><path d="M14.6 5.4v13.2" /></>,
  music: <><path d="M9.4 17.6V6.2l9-1.8v11" /><circle cx="6.8" cy="17.8" r="2.6" /><circle cx="15.8" cy="16" r="2.6" /></>,
  mic: <><rect x="9" y="3.2" width="6" height="10.6" rx="3" /><path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0" /><path d="M12 18v2.8" /><path d="M9 20.8h6" /></>,
  sparkle: <><path d="M12 3.6l1.8 4.6 4.6 1.8-4.6 1.8L12 16.4l-1.8-4.6L5.6 10l4.6-1.8L12 3.6Z" /><path d="M18.4 15.4l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2Z" /></>,
  pencil: <><path d="M4.2 19.8h4l10.4-10.4a2.4 2.4 0 0 0-3.4-3.4L4.8 16.4l-.6 3.4Z" /><path d="m13.6 7.4 3.4 3.4" /></>,
  volume: <><path d="M4.2 9.4h3.2L12 5.6v12.8L7.4 14.6H4.2V9.4Z" /><path d="M15.6 9.2a3.8 3.8 0 0 1 0 5.6" /><path d="M18.2 6.6a7.4 7.4 0 0 1 0 10.8" /></>,
  'volume-x': <><path d="M4.2 9.4h3.2L12 5.6v12.8L7.4 14.6H4.2V9.4Z" /><path d="m16 9.6 4.4 4.8M20.4 9.6 16 14.4" /></>,
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className = '',
  title,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {ICON_PATHS[name]}
    </svg>
  )
}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* ── Button ──────────────────────────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold select-none transition-colors ' +
  'disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'bg-surface-raised text-ink border border-line hover:bg-surface-sunken',
  ghost: 'text-accent hover:bg-accent-soft',
  danger: 'bg-danger text-white hover:opacity-90',
  subtle: 'bg-accent-soft text-accent-strong hover:bg-accent-soft/70',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-2xs rounded-lg',
  md: 'min-h-11 px-4 text-sm rounded-xl',
  lg: 'min-h-12 px-6 text-base rounded-2xl',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: IconName
  iconRight?: IconName
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, iconRight, fullWidth, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 15 : 18} /> : null}
    </button>
  )
})

/* ── Card ────────────────────────────────────────────────────────────────── */
type CardTone = 'default' | 'muted' | 'accent'

export function Card({
  tone = 'default',
  padding = 'md',
  className = '',
  children,
  ...rest
}: {
  tone?: CardTone
  padding?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
  children?: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const toneClass = tone === 'muted' ? 'card-muted' : tone === 'accent' ? 'card-accent' : 'card'
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : padding === 'lg' ? 'p-6' : 'p-4'
  return <div className={`${toneClass} ${pad} ${className}`} {...rest}>{children}</div>
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border border-line',
  accent: 'bg-accent-soft text-accent-strong',
  success: 'bg-success-soft text-success',
  warn: 'bg-gold-soft text-gold-strong',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`badge ${BADGE_TONE[tone]} ${className}`}>{children}</span>
}

/* ── Fields ──────────────────────────────────────────────────────────────── */
export function Label({ htmlFor, children, className = '' }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={htmlFor} className={`mb-1.5 block text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted ${className}`}>{children}</label>
}

const FIELD_BASE =
  'w-full rounded-xl border bg-surface-raised px-3.5 text-sm text-ink placeholder:text-ink-subtle ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60'

const fieldBorder = (invalid?: boolean) => (invalid ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line focus:border-accent')

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className = '', ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={`${FIELD_BASE} ${fieldBorder(invalid)} min-h-11 py-2.5 ${className}`} {...rest} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className = '', ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={`${FIELD_BASE} ${fieldBorder(invalid)} py-3 ${className}`} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className = '', children, ...rest }, ref) {
    return <select ref={ref} aria-invalid={invalid || undefined} className={`${FIELD_BASE} ${fieldBorder(invalid)} min-h-11 py-2.5 pr-9 ${className}`} {...rest}>{children}</select>
  },
)

export function FieldHint({ id, children, tone = 'muted' }: { id?: string; children: ReactNode; tone?: 'muted' | 'danger' }) {
  return <p id={id} className={`mt-1.5 text-2xs ${tone === 'danger' ? 'text-danger font-semibold' : 'text-ink-muted'}`}>{children}</p>
}

/** Labelled field wrapper: wires label/hint/error ids so screen readers announce them. */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  children: (ids: { id: string; describedBy?: string; invalid?: boolean }) => ReactNode
  className?: string
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      {error ? <FieldHint id={errorId} tone="danger">{error}</FieldHint> : null}
    </div>
  )
}

/* ── Dialog ──────────────────────────────────────────────────────────────── */
/**
 * Accessible modal: portal, focus trap, Esc to close, scroll lock, and the
 * backdrop click target. Renders nothing when closed.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  labelledBy?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const headingId = labelledBy || titleId

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const first = focusables()[0]
    ;(first || panel)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const maxW = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? `${titleId}-desc` : undefined}
        tabIndex={-1}
        className={`w-full ${maxW} max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface-raised shadow-raised outline-none sm:rounded-3xl`}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-extrabold tracking-tight text-ink">{title}</h2>
            {description ? <p id={`${titleId}-desc`} className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog" className="-mr-1 shrink-0 px-2">
            <Icon name="close" size={18} />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? <footer className="flex gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}

/* ── Empty / error states ────────────────────────────────────────────────── */
export function EmptyState({
  icon = 'info',
  title,
  body,
  action,
  tone = 'muted',
}: {
  icon?: IconName
  title: string
  body?: string
  action?: ReactNode
  tone?: 'muted' | 'danger' | 'success'
}) {
  const iconTone = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'success' ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className={`mb-3 flex h-11 w-11 items-center justify-center rounded-full ${iconTone}`}>
        <Icon name={icon} size={20} />
      </span>
      <p className="text-sm font-bold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/* ── Loading ─────────────────────────────────────────────────────────────── */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

/** Announce async status to screen readers without shifting layout. */
export function LiveRegion({ children }: { children: ReactNode }) {
  return <p role="status" aria-live="polite" className="sr-only">{children}</p>
}
