// One source of truth for the Android WebView viewport.
//
// `100dvh` is not reliable while the IME is open in a Capacitor WebView: some
// devices resize the layout viewport, others only the visual viewport. We track
// both and expose:
//   --app-viewport-height  usable height (px)
//   --keyboard-adjust      space the keyboard still covers (px)
//   data-keyboard="open"   when the IME is actually up
//
// MainActivity also publishes --keyboard-inset-bottom. We use it only when the
// visual viewport did not resize, so a device that resizes is never shrunk twice.

let installed = false

export function installMobileViewport() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const root = document.documentElement

  const update = () => {
    const vv = window.visualViewport
    const layoutHeight = Math.max(0, window.innerHeight)
    const visualHeight = Math.max(0, Math.round(vv?.height || layoutHeight))
    const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0))
    const visualKeyboard = Math.max(0, layoutHeight - visualHeight - offsetTop)
    // The native inset is useful when the WebView kept its full height. When
    // the visual viewport already shrank, using both would leave a dead band.
    const nativeInset = Number.parseFloat(
      getComputedStyle(root).getPropertyValue('--keyboard-inset-bottom') || '0',
    ) || 0
    const resizedByIme = visualKeyboard > 80
    const keyboard = resizedByIme ? visualKeyboard : Math.round(nativeInset)
    const height = resizedByIme
      ? visualHeight
      : Math.max(320, layoutHeight - keyboard)
    root.style.setProperty('--app-viewport-height', `${height}px`)
    root.style.setProperty('--keyboard-adjust', `${Math.max(0, keyboard)}px`)
    root.dataset.keyboard = keyboard > 80 ? 'open' : 'closed'
  }

  update()
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  // MainActivity dispatches this after it writes the native insets.
  document.addEventListener('safe-area-change', update)
}
