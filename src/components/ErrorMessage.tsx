import type { ReactNode } from 'react'

type ErrorKind = 'network' | 'credentials' | 'server' | 'error' | ''

interface ErrorMessageProps {
  message: string
  title?: string
  kind?: ErrorKind
  action?: ReactNode
}

export default function ErrorMessage({ message, title, kind = 'error', action }: ErrorMessageProps) {
  const network = kind === 'network'
  const heading = title || (network ? 'Connection problem' : 'Something went wrong')
  const icon = network ? '↯' : '!'
  
  return (
    <div role="alert" className="hf-error-message" data-kind={network ? 'network' : 'error'}>
      <span className="hf-error-icon" aria-hidden="true">{icon}</span>
      <div className="hf-error-copy">
        <p className="hf-error-title">{heading}</p>
        <p className="hf-error-text">{message}</p>
        {action && <div className="hf-error-action">{action}</div>}
      </div>
    </div>
  )
}
