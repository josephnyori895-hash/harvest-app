import React from 'react'

interface Props { children: React.ReactNode }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[harvest] ErrorBoundary', error, info)
  }

  handleReset = () => {
    localStorage.removeItem('harvest_onboarded')
    this.setState({ hasError: false, error: undefined })
    window.location.reload()
  }

  handleClearCache = () => {
    const keys = ['harvest_pending','harvest_approved_posts','harvest_approved_stories','harvest_approved_reels','harvest_users','harvest_onboarded']
    keys.forEach(k => localStorage.removeItem(k))
    this.handleReset()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen bg-surface text-ink flex items-center justify-center p-6">
        <div className="w-full max-w-[390px] text-center">
          <div aria-hidden="true" className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-danger-soft text-2xl font-black text-danger">!</div>
          <h1 className="font-bold text-ink mt-4">Something went wrong</h1>
          <p className="text-sm text-ink-muted mt-2">This screen hit a display error. Your account, posts and media are safe on the church server.</p>
          {this.state.error && (
            <details className="mt-4 rounded-xl border border-line bg-surface-raised p-3 text-left">
              <summary className="cursor-pointer text-xs font-bold text-ink-muted">Technical details</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink-muted">{this.state.error.message}</pre>
            </details>
          )}
          <div className="flex gap-3 mt-6">
            <button onClick={this.handleReset} className="flex-1 min-h-11 py-3 rounded-full bg-accent text-white font-semibold">Reload</button>
            <button onClick={this.handleClearCache} className="flex-1 min-h-11 py-3 rounded-full bg-surface-raised text-ink font-semibold border border-line">Clear cache & reload</button>
          </div>
          <p className="text-xs text-ink-subtle mt-3">If this repeats, update the app or contact the admin.</p>
        </div>
      </div>
    )
  }
}
