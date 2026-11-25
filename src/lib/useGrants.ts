import { useEffect, useState } from 'react'
import { apiGet } from './api'

// Leader powers are granted per account by the system admin. Screens use this
// to show the actions the backend will actually allow, instead of hiding every
// management action behind the admin role.
export function useGrants() {
  const [grants, setGrants] = useState<string[]>([])

  useEffect(() => {
    let live = true
    apiGet<{ grants?: string[] }>('/api/me')
      .then(d => {
        if (!live) return
        setGrants(Array.isArray(d?.grants) ? d.grants : [])
      })
      .catch(() => { /* keep the last known grants */ })
    return () => { live = false }
  }, [])

  return grants
}
