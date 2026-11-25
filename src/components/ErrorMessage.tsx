import type { ReactNode } from 'react'
import { Icon } from '../ui'

type ErrorKind = 'network' | 'credentials' | 'server' | 'error' | ''

interface ErrorMessageProps {
  message: string
  title?: string
  kind?: ErrorKind
  action?: ReactNode
}

// One calm voice for every failure. The banner says what happened and what to
// do next; it never repeats the same sentence in the title and the body, and it
// never shows a raw server string. Network, credentials and server problems use
// different tones so a member can tell "my password is wrong" from "my data is
// not reaching the church".
const META: Record<string, { title: string; icon: 'info' | 'alert' | 'clock'; tone: string }> = {
  network: { title: 'No connection', icon: 'info', tone: 'network' },
  credentials: { title: 'Check your details', icon: 'alert', tone: 'credentials' },
  server: { title: 'Please try again', icon: 'clock', tone: 'server' },
  error: { title: 'Something went wrong', icon: 'alert', tone: 'error' },
}

export default function ErrorMessage({ message, title, kind = 'error', action }: ErrorMessageProps) {
  const meta = META[kind || 'error'] || META.error
  const tone = meta.tone

  return (
    <div role="alert" aria-live="polite" className="hf-error-message" data-kind={tone}>
      <span className="hf-error-icon" aria-hidden="true"><Icon name={meta.icon} size={14} /></span>
      <div className="hf-error-copy">
        <p className="hf-error-title">{title || meta.title}</p>
        <p className="hf-error-text">{message}</p>
        {action && <div className="hf-error-action">{action}</div>}
      </div>
    </div>
  )
}
