import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useAuth } from '../state/auth'
import { VerifiedBadge } from './VerifiedBadge'
import { Icon } from '../ui'

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

const groupOf = (u: any) => u.group_name || u.group || 'Harvest Nyeri'
const hasCoords = (u: any) => Number.isFinite(Number(u.lat)) && Number.isFinite(Number(u.lng))

/**
 * Where a member's pin sits.
 *
 * An admin must be able to see every account on this map. Members who have
 * shared coordinates get their exact pin. Members who never shared one are
 * placed in a small deterministic ring around their congregation's centre —
 * not stacked on one dot — so each of them is still individually visible and
 * tappable, and the popup says the location was not shared.
 */
function pinPosition(u: any, i = 0): [number, number] {
  if (hasCoords(u)) return [Number(u.lat), Number(u.lng)]
  const gc = fallbackGroupCoords[groupOf(u)] || [-0.4197, 36.9475]
  const angle = ((i * 47) % 360) * (Math.PI / 180)
  const radius = 0.0045 + 0.0015 * ((i * 7) % 4)
  return [gc[0] + Math.sin(angle) * radius, gc[1] + Math.cos(angle) * radius]
}

function FitMarkers({ users }: { users: any[] }) {
  const map = useMap()
  const signature = users.map(u => `${u.id || u.username}:${u.lat}:${u.lng}`).join('|')
  useEffect(() => {
    const points = users.map((u, i) => pinPosition(u, i))
    if (points.length > 1) map.fitBounds(points, { padding: [28, 28], maxZoom: 14 })
    else if (points.length === 1) map.setView(points[0], 14)
    // Signature (not the array identity) drives fitting: the directory refresh
    // every 15s creates a new array, and re-fitting on each poll would fight
    // the admin while they pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature])
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

function formatPresence(u: any) {
  if (u.online) return 'Active now'
  if (!u.last_seen) return 'Not seen yet'
  const ms = Date.now() - Date.parse(u.last_seen)
  if (!Number.isFinite(ms) || ms < 0) return 'Recently active'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `Last seen ${Math.max(1, minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last seen ${hours}h ago`
  return `Last seen ${Math.floor(hours / 24)}d ago`
}

// A member pin is an initial disc with a presence ring, not the default blue
// teardrop: an admin scanning the map needs to see at a glance who is active
// and who is only shown an approximate group area.
function memberPin(u: any) {
  const online = !!u.online
  // divIcon HTML is injected as a string — take one alphanumeric character so
  // a display name can never inject markup into the map layer.
  const label = (String(u.name || u.username || '').match(/[a-zA-Z0-9]/)?.[0] || '?').toUpperCase()
  const ring = u.hidden ? '#A8A29E' : online ? '#059669' : u.verified ? '#7C3AED' : '#FFFFFF'
  const dot = online
    ? '<span style="position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:9999px;background:#10B981;border:2px solid #FFFBF0;"></span>'
    : ''
  const html = `<div style="position:relative;width:34px;height:34px;border-radius:9999px;background:#29251F;color:#FFFBF0;border:2.5px solid ${ring};box-shadow:0 2px 6px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;font:800 13px/1 Outfit,system-ui,sans-serif;${u.hidden ? 'opacity:.65;' : ''}">${label}${dot}</div>`
  return L.divIcon({
    className: 'harvest-map-pin',
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })
}

export default function HarvestMap({
  users,
  onOpenUser,
  onRefresh,
}: {
  users: any[]
  onOpenUser?: (user: any) => void
  onRefresh?: () => void
}) {
  const [filter, setFilter] = useState('all')
  const [joined, setJoined] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const { isAdmin } = useAuth()

  const groups: Record<string, any[]> = {}
  users.forEach(u => {
    const g = groupOf(u)
    groups[g] = (groups[g] || []).concat(u)
  })

  const myGroup = users.find(u => u.me)?.['group_name'] || users.find(u => u.me)?.group || null
  const visibleUsers = useMemo(() => users.filter(u => u.hidden !== true), [users])
  const hiddenUsers = useMemo(() => users.filter(u => u.hidden === true), [users])
  const inFilter = (u: any) => filter === 'all' || groupOf(u) === filter
  const mapUsers = useMemo(
    () => users.filter(inFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, filter],
  )

  // Admin summary: how many members the map is usefully showing, and how many
  // of those are live right now. Members never receive this roll-up.
  const activeNow = users.filter(u => u.online).length
  const sharingCount = users.filter(u => !u.hidden && u.location_updated_at && hasCoords(u)).length
  const liveMembers = users.filter(u => u.online && !u.hidden && hasCoords(u)).length
  // How many accounts the admin cannot place precisely — shown in the header
  // so a blank area on the map is explained instead of looking broken.
  const notSharing = users.filter(u => !hasCoords(u)).length

  const visibleList = (list: any[]) => {
    if (!isAdmin) return list
    // Active members first: the admin's job on this screen is live location.
    return [...list].sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)))
  }

  const refresh = async () => {
    if (refreshing || !onRefresh) return
    setRefreshing(true)
    try { await Promise.resolve(onRefresh()) } finally { setRefreshing(false) }
  }

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
        window.dispatchEvent(new Event('harvest:profile-updated'))
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
      window.dispatchEvent(new Event('harvest:profile-updated'))
      setTimeout(() => setJoined(null), 2000)
    } catch {
      setLocationError('Could not change your group. Check your connection and try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-[70vh] min-w-0 overflow-x-hidden bg-surface text-ink">
      <div className="border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-accent">
              {isAdmin ? 'Live member map' : 'Harvest map'}
            </p>
            <h1 className="mt-0.5 text-xl font-extrabold tracking-tight">Who is where</h1>
            <p className="mt-1 text-xs text-ink-muted">
              {isAdmin
                ? `Exact member locations, live presence and last-seen times for the whole church. ${notSharing} of ${users.length} members have not shared a location — those pins sit on their congregation area. Updates every 15 seconds.`
                : 'Find Harvest members and congregations nearby. Precise member locations are only shared with mutual follows and admins.'}
            </p>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="Refresh member locations"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-raised text-ink-muted disabled:opacity-50"
            >
              <Icon name="retry" size={17} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="mt-3 grid grid-cols-3 gap-2" data-testid="admin-live-summary">
            <div className="rounded-2xl border border-success/25 bg-success-soft px-3 py-2.5">
              <p className="text-lg font-extrabold leading-none tabular-nums text-success">{liveMembers}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-success/80">Live on map</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface-raised px-3 py-2.5">
              <p className="text-lg font-extrabold leading-none tabular-nums">{activeNow}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">Active now</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface-raised px-3 py-2.5">
              <p className="text-lg font-extrabold leading-none tabular-nums">{sharingCount}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">Sharing pin</p>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={updateMyLocation}
            disabled={locating}
            className="min-h-10 rounded-full bg-accent px-3.5 text-[11px] font-extrabold text-white disabled:opacity-50"
          >
            {locating ? 'Getting your location…' : 'Share my location'}
          </button>
          {isAdmin && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1.5 text-[10px] font-bold text-ink-muted">
              <span className="h-2 w-2 rounded-full bg-success" /> live presence
            </span>
          )}
        </div>

        {locationError && (
          <div role="alert" className="mt-2 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">
            <span className="min-w-0 flex-1">{locationError}</span>
            <button onClick={() => setLocationError('')} className="shrink-0 rounded-md bg-ink/10 px-2 py-1" aria-label="Dismiss location error">Dismiss</button>
          </div>
        )}
      </div>

      <div className="h-[320px] border-b border-line">
        <MapContainer center={[-0.4197, 36.9475]} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          <FitMarkers users={mapUsers} />
          {visibleUsers.filter(inFilter).map((u, i) => {
            const [lat, lng] = pinPosition(u, i)
            return (
              <Marker key={u.id || u.username + '_vis'} position={[lat, lng]} icon={memberPin(u)}>
                <Popup>
                  <div className="min-w-[170px] text-xs">
                    <div className="flex items-center gap-1">
                      <b>{u.name || u.username}</b>
                      {u.verified && <VerifiedBadge size={13} />}
                      {u.online && <span className="h-2 w-2 rounded-full bg-green-600" aria-label="Active now" />}
                    </div>
                    <div className="text-ink-subtle">@{u.username}</div>
                    <div className="mt-1 flex items-center gap-1 font-semibold">
                      <span className={u.online ? 'text-success' : 'text-ink-subtle'}>{formatPresence(u)}</span>
                    </div>
                    <div>{u.location || u.location_label || groupOf(u)}</div>
                    <div className="mt-1 text-ink-subtle">{hasCoords(u) ? formatLocationAge(u.location_updated_at) : `Location not shared — shown at ${groupOf(u)} area`}</div>
                    {isAdmin && u.phone && (
                      <a href={`tel:${u.phone}`} className="mt-1 block font-semibold text-success">{u.phone}</a>
                    )}
                    {onOpenUser && !u.me && (
                      <button
                        className="mt-2 w-full rounded-md bg-ink px-2 py-1.5 text-white"
                        onClick={() => onOpenUser(u)}
                      >
                        View profile
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            )
          })}
          {hiddenUsers.filter(inFilter).map((u, i) => {
            const pos = pinPosition(u, i)
            return (
              <Marker key={u.id || u.username + '_hid'} position={pos} icon={memberPin(u)}>
                <Popup>
                  <div className="text-xs">
                    <b>{u.name || u.username}</b>
                    <div className="mt-1">Approximate area only</div>
                    <div className="text-ink-subtle">{groupOf(u)}</div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[10px] font-semibold text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Active now</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" /> Verified</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-stone-400" /> Location not shared</span>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-b border-line p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button onClick={() => setFilter('all')} className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold ${filter === 'all' ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted'}`}>All groups</button>
        {Object.keys(groups).map(g => (
          <button key={g} onClick={() => setFilter(g)} className={`min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold ${filter === g ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted'}`}>{g} ({groups[g].length})</button>
        ))}
      </div>

      <div className="space-y-3 p-4">
        {(filter === 'all' ? Object.entries(groups) : [[filter, groups[filter] || []]] as any).map(([g, members]: any) => (
          <div key={g} className="rounded-card border border-line bg-surface-raised p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-extrabold">{g}</p>
              <button
                disabled={joining || myGroup === g}
                onClick={() => void joinGroup(g)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold disabled:opacity-70 ${myGroup === g || joined === g ? 'bg-success text-white' : 'border border-line bg-surface-sunken text-ink'}`}
              >
                {joined === g ? 'Joined' : myGroup === g ? 'Your group' : 'Join'}
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {visibleList(members).map((m: any) => {
                const canSee = isAdmin || !m.hidden && (m.me || Boolean(m.location))
                return (
                  <button
                    key={m.id || m.username}
                    type="button"
                    onClick={() => onOpenUser && !m.me && onOpenUser(m)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl p-2 text-left hover:bg-surface-sunken"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-extrabold text-white">
                        {String(m.username || '?')[0].toUpperCase()}
                        {m.online && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-raised bg-success" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {m.username}{m.me ? ' (you)' : ''}
                          {m.verified && <VerifiedBadge size={13} className="ml-1" />}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {m.online
                            ? <span className="font-bold text-success">Active now</span>
                            : !hasCoords(m) && !m.hidden
                              ? <span className="text-gold-strong">Location not shared</span>
                              : canSee
                                ? (m.location || m.location_label || 'Location shared')
                                : 'Approximate area — follow mutually to see exact location'}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[10px] font-semibold text-ink-subtle">
                      {m.hidden ? 'Approx.' : !hasCoords(m) ? 'No pin' : m.online ? 'Live' : formatLocationAge(m.location_updated_at)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="border-t border-line px-4 py-2 text-center text-[11px] text-ink-subtle">
        {isAdmin
          ? 'Admin view — exact pins are visible only to signed-in administrators.'
          : 'Your exact GPS location is never shown to non-mutual members.'}
      </p>
    </div>
  )
}

export { fallbackGroupCoords as groupCoords }
