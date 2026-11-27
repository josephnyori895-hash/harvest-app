// The admin sign-in code has to be readable while the browser is asking for it,
// so it cannot be a four-second toast. Android draws no FCM notification while
// the app is in the foreground, which left the code invisible exactly when the
// phone was in use: the sign-in screen said "check the admin phone" and the phone
// showed nothing. This banner keeps the code on screen until it is typed in or
// dismissed, and survives a reload for the ten minutes the code is valid.
import { useEffect, useState } from 'react'
import { showToast } from './Toast'

const KEY = 'harvest_admin_code'
const TTL = 10 * 60 * 1000

type Stored = { code: string; at: number }

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    const code = String(v?.code || '').replace(/\D/g, '').slice(0, 8)
    const at = Number(v?.at || 0)
    if (!code || !at || Date.now() - at > TTL) return null
    return { code, at }
  } catch { return null }
}

function save(code: string): Stored {
  const at = Date.now()
  try { localStorage.setItem(KEY, JSON.stringify({ code, at })) } catch { /* private mode */ }
  return { code, at }
}

function clear() {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}

function codeFromPush(detail: any): string {
  const data = detail?.data || detail?.notification?.data || {}
  if (String(data.kind || '') !== 'admin_login_code') return ''
  return String(data.code || '').replace(/\D/g, '').slice(0, 8)
}

export function AdminCodeBanner() {
  const [state, setState] = useState<Stored | null>(() => load())

  useEffect(() => {
    const onPush = (e: Event) => {
      const code = codeFromPush((e as CustomEvent)?.detail)
      if (code) setState(save(code))
    }
    window.addEventListener('harvest:push-received', onPush)
    // Expire the code on its own clock, even if the app never re-renders.
    const timer = window.setInterval(() => {
      setState(prev => (prev && Date.now() - prev.at > TTL ? null : prev))
    }, 30_000)
    return () => {
      window.removeEventListener('harvest:push-received', onPush)
      window.clearInterval(timer)
    }
  }, [])

  if (!state) return null
  const minutes = Math.max(1, Math.ceil((state.at + TTL - Date.now()) / 60_000))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code)
      showToast('Code copied')
    } catch {
      showToast(`Code: ${state.code}`, 'info', 8000)
    }
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-x-3 bottom-4 z-[60] mx-auto max-w-[420px] rounded-2xl border border-line bg-surface-raised p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Admin sign-in code</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.28em] text-ink">{state.code}</p>
          <p className="mt-1 text-xs text-ink-muted">
            Type it in the browser. Valid for about {minutes} more minute{minutes === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { clear(); setState(null) }}
          aria-label="Dismiss code"
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        onClick={() => { void copy() }}
        className="mt-3 w-full rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
      >
        Copy code
      </button>
    </div>
  )
}
