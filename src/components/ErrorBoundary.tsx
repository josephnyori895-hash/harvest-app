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
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="w-full max-w-[390px] text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-2xl mx-auto">!</div>
          <h1 className="font-bold text-stone-900 mt-4">Something went wrong</h1>
          <p className="text-sm text-stone-500 mt-2">Harvest hit an error — your data is safe in local storage.</p>
          {this.state.error && <pre className="text-xs text-left bg-stone-50 border border-stone-200 rounded-xl p-3 mt-4 overflow-auto">{this.state.error.message}</pre>}
          <div className="flex gap-3 mt-6">
            <button onClick={this.handleReset} className="flex-1 py-3 rounded-full bg-[#7C3AED] text-white font-semibold">Reload</button>
            <button onClick={this.handleClearCache} className="flex-1 py-3 rounded-full bg-stone-100 text-stone-700 font-semibold border border-stone-200">Clear cache & reload</button>
          </div>
          <p className="text-xs text-stone-400 mt-3">If this repeats, update the app or contact the admin.</p>
        </div>
      </div>
    )
  }
}
