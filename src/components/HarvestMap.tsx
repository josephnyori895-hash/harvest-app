import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useAuth } from '../state/auth'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const fallbackGroupCoords: Record<string, [number, number]> = {
  'Harvest Central': [-0.4197, 36.9475],
  'Harvest Ruringu': [-0.432, 36.95],
  'Harvest Skuta': [-0.41, 36.94],
  'Harvest Majengo': [-0.425, 36.945],
  'Harvest Kamakwa': [-0.415, 36.955],
  'Harvest Nyeri': [-0.4197, 36.9475],
}

function FitMarkers({ users }: { users: any[] }) {
  const map = useMap()
  const points = users
    .filter(u => Number.isFinite(Number(u.lat)) && Number.isFinite(Number(u.lng)))
    .map(u => [Number(u.lat), Number(u.lng)] as [number, number])
  if (points.length > 1) map.fitBounds(points, { padding: [24, 24], maxZoom: 14 })
  else if (points.length === 1) map.setView(points[0], 14)
  return null
}

function formatLocationAge(value: string | null | undefined) {
  if (!value) return 'Location not shared'
  const ms = Date.now() - Date.parse(value)
  if (!Number.isFinite(ms) || ms < 0) return 'Location recently shared'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 2) return 'Location updated just now'
  if (minutes < 60) return `Location updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Location updated ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Location updated ${days}d ago`
}

export default function HarvestMap({ users, onOpenUser }: { users: any[], onOpenUser?: (user: any) => void }) {
  const [filter, setFilter] = useState('all')
  const [joined, setJoined] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const { isAdmin } = useAuth()

  const groups: Record<string, any[]> = {}
  users.forEach(u => {
    const g = u.group_name || u.group || 'Harvest Nyeri'
    groups[g] = (groups[g] || []).concat(u)
  })

  const myGroup = users.find(u => u.me)?.group_name || users.find(u => u.me)?.group || null
  const visibleUsers = useMemo(() => users.filter(u => u.hidden !== true), [users])
  const hiddenUsers = useMemo(() => users.filter(u => u.hidden === true), [users])
  const mapUsers = filter === 'all'
    ? [...visibleUsers, ...hiddenUsers]
    : users.filter(u => (u.group_name || u.group || 'Harvest Nyeri') === filter)

  const updateMyLocation = () => {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('Location is not available on this device.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async p => {
      try {
        const token = localStorage.getItem('harvest_token') || ''
        const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
        const r = await fetch(`${API}/api/me`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }),
        })
        if (!r.ok) throw new Error()
        window.dispatchEvent(new Event('harvest:verified'))
      } catch {
        setLocationError('Could not save your location. Check your connection and try again.')
      } finally {
        setLocating(false)
      }
    }, err => {
      setLocating(false)
      if (err.code === 1) setLocationError('Location permission is off. Enable it in device Settings to share your location.')
      else if (err.code === 3) setLocationError('Location took too long. Try again somewhere with a clearer GPS signal.')
      else setLocationError('We could not get your location. Try again.')
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 })
  }

  const joinGroup = async (g: string) => {
    if (joining || g === myGroup) return
    setJoining(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${API}/api/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ group_name: g }),
      })
      if (!r.ok) throw new Error('failed')
      setJoined(g)
      window.dispatchEvent(new Event('harvest:verified'))
      setTimeout(() => setJoined(null), 2000)
    } catch {
      setLocationError('Could not change your group. Check your connection and try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="bg-[#141210] text-white min-h-[70vh] flex flex-col min-w-0 overflow-x-hidden">
      <div className="p-4 border-b border-stone-800">
        <h1 className="font-bold">Harvest Map</h1>
        <p className="text-xs text-stone-500 mt-1">Find Harvest members and congregations nearby. Precise member locations are only shared with mutual follows and admins.</p>
        <button onClick={updateMyLocation} disabled={locating} className="mt-3 px-3 py-2 rounded-full text-[11px] font-bold bg-[#7C3AED] text-white disabled:opacity-50">
          {locating ? 'Getting your location…' : '📍 Share my location'}
        </button>
        {locationError && (
          <div role="alert" className="mt-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] text-red-200 flex items-center gap-2">
            <span className="min-w-0 flex-1">{locationError}</span>
            <button onClick={() => setLocationError('')} className="shrink-0 px-2 py-1 rounded-md bg-white/10" aria-label="Dismiss location error">Dismiss</button>
          </div>
        )}
      </div>

      <div className="h-[280px] border-b border-stone-800">
        <MapContainer center={[-0.4197, 36.9475]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          <FitMarkers users={mapUsers} />
          {visibleUsers.filter(u => filter === 'all' || (u.group_name || u.group) === filter).map(u => {
            const fallback = fallbackGroupCoords[u.group_name || u.group] || [-0.4197, 36.9475]
            const lat = Number.isFinite(Number(u.lat)) ? Number(u.lat) : fallback[0]
            const lng = Number.isFinite(Number(u.lng)) ? Number(u.lng) : fallback[1]
            return (
              <Marker key={u.id || u.username + '_vis'} position={[lat, lng]}>
                <Popup>
                  <div className="text-xs min-w-[150px]">
                    <b>{u.name || u.username}</b>
                    <div className="text-stone-500">@{u.username}</div>
                    <div>{u.location || u.location_label || u.group_name || 'Harvest'}</div>
                    <div className="mt-1 text-stone-500">{formatLocationAge(u.location_updated_at)}</div>
                    {onOpenUser && !u.me && <button className="mt-2 w-full rounded-md bg-black px-2 py-1.5 text-white" onClick={() => onOpenUser(u)}>View profile</button>}
                  </div>
                </Popup>
              </Marker>
            )
          })}
          {hiddenUsers.filter(u => filter === 'all' || (u.group_name || u.group) === filter).map(u => {
            const gc = fallbackGroupCoords[u.group_name || u.group] || [-0.4197, 36.9475]
            const pos = [Number(u.lat) || gc[0], Number(u.lng) || gc[1]] as [number, number]
            return (
              <Marker key={u.id || u.username + '_hid'} position={pos} opacity={0.55}>
                <Popup>
                  <div className="text-xs">
                    <b>{u.name || u.username}</b>
                    <div className="mt-1">Approximate area only</div>
                    <div className="text-stone-500">{u.group_name || 'Harvest'}</div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      <div className="flex gap-2 p-3 border-b border-stone-800 overflow-x-auto">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === 'all' ? 'bg-white text-black' : 'bg-stone-800'}`}>All groups</button>
        {Object.keys(groups).map(g => (
          <button key={g} onClick={() => setFilter(g)} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === g ? 'bg-white text-black' : 'bg-stone-800'}`}>{g} ({groups[g].length})</button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {(filter === 'all' ? Object.entries(groups) : [[filter, groups[filter] || []]] as any).map(([g, members]: any) => (
          <div key={g} className="bg-stone-900 border border-stone-800 rounded-xl p-3">
            <div className="flex justify-between items-center gap-2">
              <p className="font-semibold text-sm min-w-0 truncate">{g}</p>
              <button disabled={joining || myGroup === g} onClick={() => void joinGroup(g)} className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold disabled:opacity-70 ${myGroup === g || joined === g ? 'bg-green-600 text-white' : 'bg-white text-black'}`}>
                {joined === g ? 'Joined ✓' : myGroup === g ? 'Your group ✓' : 'Join'}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {members.map((m: any) => {
                const canSee = !m.hidden && (isAdmin || m.me || Boolean(m.location))
                return (
                  <button key={m.id || m.username} type="button" onClick={() => onOpenUser && !m.me && onOpenUser(m)} className="w-full flex justify-between items-center gap-2 text-left rounded-lg p-1 -m-1 hover:bg-white/5">
                    <span className="flex gap-2 items-center min-w-0">
                      <span className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-xs shrink-0">{String(m.username)[0].toUpperCase()}</span>
                      <span className="min-w-0"><span className="block text-sm font-semibold truncate">{m.username}{m.me ? ' (you)' : ''}</span><span className="block text-xs text-stone-400 truncate">{canSee ? (m.location || m.location_label || 'Location shared') : '📍 Approximate area — follow mutually to see exact location'}</span></span>
                    </span>
                    <span className="text-xs text-stone-500 shrink-0">{m.hidden ? 'Approx.' : formatLocationAge(m.location_updated_at)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-stone-600 text-center px-4 py-2 border-t border-stone-800">Your exact GPS location is never shown to non-mutual members.</p>
    </div>
  )
}

export { fallbackGroupCoords as groupCoords }
