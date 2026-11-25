import { useEffect } from 'react'

// Android hardware back is dispatched by App as `harvest:nested-back`. Overlays
// form a stack: the most recently opened surface gets the first chance to close,
// then the event bubbles to older surfaces (and finally App's tab/exit logic).
type Handler = () => void
const stack: Handler[] = []
let listening = false

function onBack(event: Event) {
  const detail = (event as CustomEvent<{ handled?: boolean }>).detail
  if (!detail || detail.handled) return
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const handler = stack[i]
    if (!handler) continue
    handler()
    if (detail.handled) return
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('harvest:nested-back', onBack)
}

export function useAndroidBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return
    ensureListener()
    stack.push(onBack)
    return () => {
      const index = stack.lastIndexOf(onBack)
      if (index >= 0) stack.splice(index, 1)
    }
  }, [active, onBack])
}
