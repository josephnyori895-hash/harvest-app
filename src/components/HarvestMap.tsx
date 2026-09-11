import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { isMutual } from '../state/auth'

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

function jitter(coord: [number, number]): [number, number] {
  // obfuscate exact location ~ 300-500m
  return [coord[0] + (Math.random() - 0.5) * 0.008, coord[1] + (Math.random() - 0.5) * 0.008]
}

export default function HarvestMap({ users, setUsers }: { users: any[]; setUsers?: (u: any[]) => void }) {
  const [filter, setFilter] = useState('all')
  const [joined, setJoined] = useState<string | null>(null)
  const groups: Record<string, any[]> = {}
  users.forEach(u => { const g = u.group || 'Harvest Nyeri'; groups[g] = (groups[g] || []).concat(u) })
  const currentUser = (()=>{ try{ return JSON.parse(localStorage.getItem('harvest_users')||'[]')[0] }catch{return null}})()
  const joinGroup = (g: string) => {
    try {
      const raw = localStorage.getItem('harvest_users')
      if(!raw) return
      let arr = JSON.parse(raw)
      arr = arr.map((u:any, idx:number)=> idx===0 ? {...u, group:g, lat: groupCoords[g]?.[0]||u.lat, lng: groupCoords[g]?.[1]||u.lng} : u)
      localStorage.setItem('harvest_users', JSON.stringify(arr))
      if(setUsers) setUsers(arr)
      else localStorage.setItem('harvest_users', JSON.stringify(arr))
      setJoined(g)
      setTimeout(()=> setJoined(null), 2000)
    } catch {}
  }

  const viewer = (() => {
    try { return JSON.parse(localStorage.getItem('harvest_users') || '[]')[0]?.username || localStorage.getItem('harvest_username') || '' } catch { return '' }
  })()
  const isAdmin = (() => {
    try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false }
  })() || viewer === 'allan'

  const canSee = (u: any) => {
    if (isAdmin) return true
    if (!viewer) return false
    return isMutual(viewer, u.username)
  }

  // FIX coords leak 723: only render precise marker if canSee; else render at group centroid with label "Hidden"
  const visibleUsers = users.filter(u => canSee(u))
  const hiddenUsers = users.filter(u => !canSee(u))

  return (
    <div className="bg-black text-white min-h-[70vh] flex flex-col">
      <div className="p-4 border-b border-zinc-800"><h1 className="font-bold">Harvest Map</h1><p className="text-xs text-zinc-500">Groups & members nearby • Location hidden unless mutual follow (admin sees all) • {visibleUsers.length}/{users.length} visible</p></div>
      <div className="h-[220px] border-b border-zinc-800">
        <MapContainer center={[-0.4197, 36.9475]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {visibleUsers.map(u => (
            <Marker key={u.username + '_vis'} position={[u.lat || groupCoords[u.group]?.[0] || -0.4197, u.lng || groupCoords[u.group]?.[1] || 36.9475]}>
              <Popup>
                <div className="text-xs"><b>{u.username}</b><br />{u.name}<br />{u.location}<br />{u.group}</div>
              </Popup>
            </Marker>
          ))}
          {hiddenUsers.map(u => {
            const gc = groupCoords[u.group] || [-0.4197, 36.9475]
            const approx = jitter(gc)
            return (
              <Marker key={u.username + '_hid'} position={approx} opacity={0.6}>
                <Popup>
                  <div className="text-xs"><b>{u.username}</b><br />Hidden — mutual follow required<br />{u.group} (approx)</div>
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
          const isCurrentGroup = currentUser?.group === g
          return (
          <div key={g} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
            <div className="flex justify-between items-center">
              <p className="font-semibold text-sm">{g}</p>
              <button onClick={()=> joinGroup(g)} className={`px-3 py-1 rounded-full text-xs font-semibold ${isCurrentGroup?'bg-green-600 text-white':'bg-white text-black'} ${joined===g?'bg-green-600 text-white':''}`}>
                {joined===g ? 'Joined ✓' : isCurrentGroup ? 'Joined ✓' : 'Join'}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {members.map((m: any) => (
                <div key={m.username} className="flex justify-between items-center">
                  <div className="flex gap-2 items-center"><div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs">{m.username[0].toUpperCase()}</div><div><p className="text-sm font-semibold">{m.username}</p><p className="text-xs text-zinc-400">{canSee(m) ? m.location : '📍 Hidden — mutual follow to see'}</p></div></div>
                  <span className="text-xs text-zinc-500">{canSee(m) ? '✓ Visible' : '🔒 Hidden'}</span>
                </div>
              ))}
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
