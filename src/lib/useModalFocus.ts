import { useEffect, useRef } from 'react'

// Every dialog in this app behaves the same way: focus moves inside on open, Tab
// is trapped, Escape closes (only the topmost dialog answers it), focus goes back
// to whatever opened it, and the feed underneath stops scrolling while it is up.
// The notification drawer, the DM card, the comment sheet and the post options
// sheet all use this hook so none of them can drift.

// An open dialog freezes the feed underneath it, like a native dialog: otherwise
// the page keeps drifting behind the scrim when the member swipes over it. The
// app scrolls inside `.app-content.app-scroll`, which is a *sibling* of the
// floating cards (they are absolutely positioned in the shell), so the lock
// cannot walk up from the panel and body overflow alone would leave the feed
// live. A depth counter keeps stacked dialogs from restoring the feed early.
let scrollLockDepth = 0
let scrollLockRestore = () => {}

function lockScroll(panel: HTMLElement | null) {
  const shell: ParentNode = panel?.closest('.app-shell') || document
  const scroller = (shell.querySelector('.app-content.app-scroll')
    || document.querySelector('.app-content.app-scroll')) as HTMLElement | null
  const targets: HTMLElement[] = scroller
    ? [scroller, document.documentElement, document.body]
    : [document.documentElement, document.body]
  if (scrollLockDepth === 0) {
    const previous = targets.map(node => ({ overflow: node.style.overflow, overscroll: node.style.overscrollBehavior }))
    targets.forEach(node => { node.style.overflow = 'hidden'; node.style.overscrollBehavior = 'contain' })
    scrollLockRestore = () => targets.forEach((node, i) => {
      node.style.overflow = previous[i].overflow
      node.style.overscrollBehavior = previous[i].overscroll
    })
  }
  scrollLockDepth += 1
  return () => {
    scrollLockDepth = Math.max(0, scrollLockDepth - 1)
    if (scrollLockDepth === 0) scrollLockRestore()
  }
}

type PanelRef = { readonly current: HTMLElement | null }

export function useModalFocus(
  open: boolean,
  panelRef: PanelRef,
  onClose: () => void,
  getReturnFocus?: () => HTMLElement | null | undefined,
) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const releaseScroll = lockScroll(panel)
    const opener = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter(el => el.offsetParent !== null || el === document.activeElement)
    ;(focusables()[0] || panel).focus()
    const ownsEscape = () => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(el => el.getClientRects().length > 0)
      return dialogs.length === 0 || dialogs[dialogs.length - 1] === panel
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!ownsEscape()) return
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      releaseScroll()
      // Hand focus back only when the dialog owned it: if it closed because a
      // nav tab was tapped, that tab keeps focus.
      const active = document.activeElement
      if (active && active !== document.body && !panel.contains(active)) return
      if (opener && opener !== document.body && opener.isConnected) { opener.focus?.(); return }
      // The chat card's opener unmounts in the same commit that opens it — the
      // browser then parks focus on <body>, so the captured opener *is* the body
      // — and a sheet's host can unmount with the sheet. Resolve the opener by
      // selector on the next frame instead, once it is back in the DOM.
      if (getReturnFocus) requestAnimationFrame(() => { getReturnFocus()?.focus?.() })
    }
  }, [open, panelRef])
}
