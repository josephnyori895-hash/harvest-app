// src/lib/useCongregations.ts — live congregation list for pickers.
// Groups are admin-editable/deletable, so every group picker (sign-up,
// admin studio, edit profile, account switcher, user view) must read the
// real groups table instead of a hardcoded list that can resurrect
// deleted congregations as profile ghosts.
import { useCallback, useEffect, useState } from 'react'
import { apiGet } from './api'

export function useCongregations(enabled = true): {
  congregations: string[]
  live: boolean
  loading: boolean
  retry: () => void
} {
  const [congregations, setCongregations] = useState<string[]>([])
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(enabled)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      if (!cancelled) setLoading(true)
      apiGet<any>('/api/groups')
        .then(d => {
          if (cancelled) return
          const rows: any[] = Array.isArray(d?.groups) ? d.groups : []
          const names = [...new Set<string>(rows.map((g: any) => String(g.name || '')).filter(Boolean))]
          setCongregations(names); setLive(true); setLoading(false)
        })
        .catch(() => { if (!cancelled) { setCongregations([]); setLive(false); setLoading(false) } })
    }
    load()
    // Refresh when groups change anywhere in the app (create/delete/settings).
    window.addEventListener('harvest:groups-changed', load)
    return () => { cancelled = true; window.removeEventListener('harvest:groups-changed', load) }
  }, [enabled, attempt])
  // Manual retry for pickers that block a required action (sign-up) when
  // the list failed to load. Callers that ignore it are unaffected.
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  return { congregations, live, loading, retry }
}
