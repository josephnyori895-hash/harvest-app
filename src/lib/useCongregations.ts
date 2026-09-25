// src/lib/useCongregations.ts — live congregation list for pickers.
// Groups are admin-editable/deletable, so every group picker (sign-up,
// admin studio, edit profile, account switcher, user view) must read the
// real groups table instead of a hardcoded list that can resurrect
// deleted congregations as profile ghosts.
import { useEffect, useState } from 'react'

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// The five founding congregations — the seed/fallback order when the
// groups table is empty or unreachable.
export const DEFAULT_CONGREGATIONS = ['Harvest Central', 'Harvest Ruringu', 'Harvest Skuta', 'Harvest Majengo', 'Harvest Kamakwa']

export function useCongregations(enabled = true): { congregations: string[]; live: boolean } {
  const [congregations, setCongregations] = useState<string[]>(DEFAULT_CONGREGATIONS)
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      const t = localStorage.getItem('harvest_token') || ''
      fetch(`${BASE}/api/groups`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(d => {
          if (cancelled) return
          const rows: any[] = Array.isArray(d?.groups) ? d.groups : []
          const names = [...new Set<string>(rows.map((g: any) => String(g.name || '')).filter(Boolean))]
          if (names.length) { setCongregations(names); setLive(true) }
        })
        .catch(() => { /* keep defaults — offline tolerance */ })
    }
    load()
    // Refresh when groups change anywhere in the app (create/delete/settings).
    window.addEventListener('harvest:groups-changed', load)
    return () => { cancelled = true; window.removeEventListener('harvest:groups-changed', load) }
  }, [enabled])
  return { congregations, live }
}
