import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../ui'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
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
  success: { box: 'bg-success text-white', icon: 'check' },
  error: { box: 'bg-danger text-white', icon: 'alert' },
  info: { box: 'bg-ink text-white', icon: 'info' },
  warning: { box: 'bg-gold-strong text-ink', icon: 'alert' },
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const unsubscribe = (toast: Toast) => {
      setToasts(prev => [...prev, toast])
      if (toast.duration) {
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id))
        }, toast.duration)
      }
    }
    toastSubscribers.add(unsubscribe)
    return () => { toastSubscribers.delete(unsubscribe) }
  }, [])

  return (
    <div className="pointer-events-none fixed left-3 right-3 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+12px)] z-50 space-y-2 sm:left-auto sm:right-4 sm:w-auto">
      {toasts.map(toast => {
        const tone = TONE[toast.type]
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`${tone.box} animate-slide-up pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold shadow-raised`}
          >
            <Icon name={tone.icon} size={17} className="shrink-0" />
            <span className="min-w-0 flex-1">{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
