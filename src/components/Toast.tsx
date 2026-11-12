import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../ui'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

interface LiveToast extends Toast {
  expiresAt: number
  leavingAt?: number
}

let toastId = 0
const toastSubscribers: Set<(toast: Toast) => void> = new Set()

export function showToast(message: string, type: ToastType = 'info', duration?: number) {
  const id = `toast-${++toastId}`
  // Errors carry more text the member must read than confirmations do —
  // give failures the longer screen time (audit #16).
  const dur = duration ?? ((type === 'error' || type === 'warning') ? 4500 : 3000)
  const toast: Toast = { id, message, type, duration: dur }
  toastSubscribers.forEach(sub => sub(toast))
}

// Semantic tokens, not hand-picked gradients: a toast must look like the rest
// of the app on every screen, light or dark.
const TONE: Record<ToastType, { box: string; icon: IconName }> = {
  // --surface is the one token guaranteed to contrast with every tone in both
  // themes: the tones are dark in light mode and light in dark mode.
  success: { box: 'bg-success text-surface', icon: 'check' },
  error: { box: 'bg-danger text-surface', icon: 'alert' },
  info: { box: 'bg-ink text-surface', icon: 'info' },
  warning: { box: 'bg-gold-strong text-surface', icon: 'alert' },
}

const MAX_VISIBLE = 3
const EXIT_MS = 200

export function ToastContainer() {
  const [toasts, setToasts] = useState<LiveToast[]>([])

  useEffect(() => {
    const unsubscribe = (toast: Toast) => {
      setToasts(prev => {
        const existing = prev.find(t => t.message === toast.message && t.type === toast.type)
        // Repeating the same sentence (double tap, retry) should not stack
        // identical bars — extend the one on screen instead.
        if (existing) {
          return prev.map(t => t.id === existing.id
            ? { ...t, expiresAt: Date.now() + (toast.duration || 3000), leavingAt: undefined }
            : t)
        }
        const next = [...prev, { ...toast, expiresAt: Date.now() + (toast.duration || 3000) }]
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
      })
    }
    toastSubscribers.add(unsubscribe)
    return () => { toastSubscribers.delete(unsubscribe) }
  }, [])

  // One ticker drives both the exit animation and the removal, so a toast can
  // never disappear abruptly (the old behaviour) or linger after unmount ticks.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now()
      setToasts(prev => {
        let changed = false
        const next: LiveToast[] = []
        for (const t of prev) {
          if (t.leavingAt === undefined && now >= t.expiresAt) {
            changed = true
            next.push({ ...t, leavingAt: now })
          } else if (t.leavingAt !== undefined && now - t.leavingAt >= EXIT_MS) {
            changed = true
          } else {
            next.push(t)
          }
        }
        return changed ? next : prev
      })
    }, 100)
    return () => clearInterval(tick)
  }, [])

  const dismiss = (id: string) => {
    setToasts(prev => prev.map(t => t.id === id && t.leavingAt === undefined ? { ...t, leavingAt: Date.now() } : t))
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--safe-area-inset-bottom,0px)+84px)] z-50 flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-4 sm:w-[380px]">
      {toasts.map(toast => {
        const tone = TONE[toast.type]
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            data-leaving={toast.leavingAt !== undefined ? 'true' : 'false'}
            className={`hf-toast ${tone.box} pointer-events-auto flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold shadow-raised`}
            onClick={() => dismiss(toast.id)}
          >
            <Icon name={tone.icon} size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); dismiss(toast.id) }}
              aria-label="Dismiss message"
              className="-my-1.5 -mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-70 active:opacity-100"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
