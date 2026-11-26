import { useEffect, useState } from 'react'

// The landing backdrop is a set of photos, not one. The office drops numbered
// files in the landing folder (background01.jpg … background08.jpg) and they
// rotate on their own; the admin can also paste a comma-separated list of public
// URLs. Files that are absent simply never join the rotation, so one photo
// behaves exactly like the old single-image backdrop.
const ROTATE_MS = 7000
const SLOT_COUNT = 8
const LOCAL_SLOTS = Array.from(
  { length: SLOT_COUNT },
  (_, i) => `/landing/background${String(i + 1).padStart(2, '0')}.jpg`,
)

type Props = { variant: 'landing' | 'auth'; urls?: string }

export default function LandingBackdrop({ variant, urls = '' }: Props) {
  const configured = urls.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  const candidates = configured.length ? configured : LOCAL_SLOTS
  const key = candidates.join('|')
  const [loaded, setLoaded] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let alive = true
    const found: (string | null)[] = candidates.map(() => null)
    setLoaded([])
    setIndex(0)
    candidates.forEach((src, i) => {
      const probe = new Image()
      probe.onload = () => {
        if (!alive) return
        found[i] = src
        setLoaded(found.filter((x): x is string => Boolean(x)))
      }
      probe.onerror = () => { /* missing slot: skip it */ }
      probe.src = src
    })
    return () => { alive = false }
    // candidates is derived from `key`; re-run only when the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    // Changing photos automatically is motion: honour the OS setting and keep
    // the first frame instead of cycling.
    if (reduced || loaded.length < 2) return
    const timer = window.setInterval(() => setIndex(i => (i + 1) % loaded.length), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [loaded.length, reduced])

  const drop = (src: string) => setLoaded(cur => cur.filter(x => x !== src))
  const active = loaded.length ? index % loaded.length : -1

  return (
    <div
      className={variant === 'landing' ? 'landing-page-underlay' : 'auth-underlay'}
      aria-hidden="true"
      data-landing-backdrop={loaded.length}
    >
      {loaded.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          className={`landing-bg-layer${i === active ? ' is-active' : ''}`}
          onError={() => drop(src)}
        />
      ))}
    </div>
  )
}
