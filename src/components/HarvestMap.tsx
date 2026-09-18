import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { useAuth } from '../state/auth'

// FIX L icon 404 — use CDN icons explicitly and mergeOptions
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const groupCoords: Record<string, [number, number]> = {
  'Harvest Central': [-0.4197, 36.9475],
  'Harvest Ruringu': [-0.432, 36.95],
  'Harvest Skuta': [-0.41, 36.94],
  'Harvest Majengo': [-0.425, 36.945],
  'Harvest Kamakwa': [-0.415, 36.955],
  'Harvest Nyeri': [-0.4197, 36.9475],
}

// The server decides visibility (mutual follow / admin) and returns approximate
// group-centroid coords for hidden members. We just render what it sends.
export default function HarvestMap({ users }: { users: any[] }) {
  const [filter, setFilter] = useState('all')
  const [joined, setJoined] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const { isAdmin, username: viewerName } = useAuth()

  const groups: Record<string, any[]> = {}
  users.forEach(u => { const g = u.group_name || u.group || 'Harvest Nyeri'; groups[g] = (groups[g] || []).concat(u) })

  const myGroup = users.find(u => u.me)?.group_name || users.find(u => u.me)?.group || null
  const [locating, setLocating] = useState(false)

  // Share/update my real GPS position (used by the map + nearest-group logic).
  const updateMyLocation = () => {
    if (!navigator.geolocation) { alert('This device cannot share location'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async p => {
      try {
        const token = localStorage.getItem('harvest_token') || ''
        const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
        const r = await fetch(`${API}/api/me`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }),
        })
        if (!r.ok) throw new Error()
        window.dispatchEvent(new Event('harvest:verified'))
      } catch { alert('Could not update location — try again') } finally { setLocating(false) }
    }, () => { setLocating(false); alert('Location permission denied — enable it in Settings to appear on the map') }, { enableHighAccuracy: true, timeout: 10000 })
  }

  const joinGroup = async (g: string) => {
    if (joining || g === myGroup) return
    setJoining(true)
    try {
      const token = localStorage.getItem('harvest_token') || ''
      const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${API}/api/me`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ group_name: g }),
      })
      if (!r.ok) throw new Error('failed')
      setJoined(g)
      window.dispatchEvent(new Event('harvest:verified'))
      setTimeout(() => setJoined(null), 2000)
    } catch { /* join failed — button stays as-is */ } finally { setJoining(false) }
  }

  // Server flags: hidden=true means the viewer may not see this member's details.
  const visibleUsers = users.filter(u => u.hidden !== true)
  const hiddenUsers = users.filter(u => u.hidden === true)

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col">
      <div className="p-4 border-b border-zinc-800"><h1 className="font-bold">Harvest Map</h1><p className="text-xs text-zinc-500">Groups & members nearby • Location hidden unless mutual follow (admin sees all) • {visibleUsers.length}/{users.length} visible</p><button onClick={updateMyLocation} disabled={locating} className="mt-2 px-3 py-1.5 rounded-full text-[11px] font-bold bg-[#7C3AED] text-white disabled:opacity-50">{locating ? 'Locating…' : '📍 Update my real location'}</button></div>
      <div className="h-[220px] border-b border-zinc-800">
        <MapContainer center={[-0.4197, 36.9475]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {visibleUsers.map(u => (
            <Marker key={u.username + '_vis'} position={[u.lat || groupCoords[u.group_name || u.group]?.[0] || -0.4197, u.lng || groupCoords[u.group_name || u.group]?.[1] || 36.9475]}>
              <Popup>
                <div className="text-xs"><b>{u.username}</b><br />{u.name}<br />{u.location || 'Nyeri'}<br />{u.group_name || u.group}</div>
              </Popup>
            </Marker>
          ))}
          {hiddenUsers.map(u => {
            const gc = groupCoords[u.group_name || u.group] || [-0.4197, 36.9475]
            // The server already jitters hidden coords; fall back to centroid only if missing.
            const pos = [u.lat || gc[0], u.lng || gc[1]] as [number, number]
            return (
              <Marker key={u.username + '_hid'} position={pos} opacity={0.6}>
                <Popup>
                  <div className="text-xs"><b>{u.username}</b><br />Hidden — mutual follow required<br />{u.group_name || u.group} (approx)</div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
      <div className="flex gap-2 p-3 border-b border-zinc-800 overflow-x-auto">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === 'all' ? 'bg-white text-black' : 'bg-zinc-800'}`}>All groups</button>
        {Object.keys(groups).map(g => (
          <button key={g} onClick={() => setFilter(g)} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${filter === g ? 'bg-white text-black' : 'bg-zinc-800'}`}>{g} ({groups[g].length})</button>
        ))}
      </div>
      <div className="p-4 space-y-3">
        {(filter === 'all' ? Object.entries(groups) : [[filter, groups[filter] || []]] as any).map(([g, members]: any) => {
          const isCurrentGroup = myGroup === g
          return (
          <div key={g} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-sm">{g}</p>
              <button disabled={joining || isCurrentGroup} onClick={() => void joinGroup(g)} className={`px-3 py-1 rounded-full text-xs font-semibold disabled:opacity-70 ${isCurrentGroup || joined===g ? 'bg-green-600 text-white' : 'bg-white text-black'}`}>
                {joined===g ? 'Joined ✓' : isCurrentGroup ? 'Your group ✓' : 'Join'}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {members.map((m: any) => {
                const canSee = !m.hidden && (isAdmin || m.me || Boolean(m.location))
                return (
                <div key={m.username} className="flex justify-between items-center">
                  <div className="flex gap-2 items-center"><div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs">{String(m.username)[0].toUpperCase()}</div><div><p className="text-sm font-semibold">{m.username}{m.me ? ' (you)' : ''}</p><p className="text-xs text-zinc-400">{canSee ? (m.location || 'Nyeri') : '📍 Hidden — mutual follow to see'}</p></div></div>
                  <span className="text-xs text-zinc-500">{canSee ? '✓ Visible' : '🔒 Hidden'}</span>
                </div>
              )})}
            </div>
          </div>
          )
        })}
      </div>
      <p className="text-[11px] text-zinc-600 text-center py-2 border-t border-zinc-800">Precise coords only for mutual follows • Others shown approx per group</p>
    </div>
  )
}

export { groupCoords }
