import { useEffect, useState } from 'react'

// True while a horizontal rail has content still to reach to its right.
// The chip rails use it to fade their trailing edge only when that fade is
// telling the truth — a rail that already fits must not dim its last chip.
export function useOverflowX(ref: { current: HTMLElement | null }): boolean {
  const [more, setMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft
      setMore(el.scrollWidth > el.clientWidth + 4 && remaining > 4)
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    // Children arrive later (stories, filters, search hits): watch the subtree,
    // not just the box, or the first measurement is the only one taken.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })

    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref])

  return more
}
