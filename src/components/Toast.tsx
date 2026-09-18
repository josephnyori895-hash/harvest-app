import { useEffect, useState } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

let toastId = 0
const toastSubscribers: Set<(toast: Toast) => void> = new Set()

export function showToast(message: string, type: ToastType = 'info', duration = 3000) {
  const id = `toast-${++toastId}`
  const toast: Toast = { id, message, type, duration }
  toastSubscribers.forEach(sub => sub(toast))
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

  const bgColors = {
    success: 'bg-gradient-to-r from-green-600 to-emerald-600 shadow-lg shadow-green-500/50',
    error: 'bg-gradient-to-r from-red-600 to-rose-600 shadow-lg shadow-red-500/50',
    info: 'bg-gradient-to-r from-blue-600 to-cyan-600 shadow-lg shadow-blue-500/50',
    warning: 'bg-gradient-to-r from-amber-600 to-orange-600 shadow-lg shadow-amber-500/50'
  }

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${bgColors[toast.type]} text-white px-5 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 animate-slide-up pointer-events-auto shadow-xl`}
        >
          <span className="text-lg">{icons[toast.type]}</span>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
