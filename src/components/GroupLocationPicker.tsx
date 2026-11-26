import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useModalFocus } from '../lib/useModalFocus'

// The admin maps a congregation's physical area here instead of hunting for
// latitude/longitude elsewhere. The picker only reports numbers; saving stays
// on the group settings form, so Cancel changes nothing.
const NYERI: [number, number] = [-0.4197, 36.9475]

function pinIcon() {
  return L.divIcon({
    className: 'group-location-pin',
    html: '<div style="width:26px;height:26px;border-radius:9999px;background:#EEB609;border:3px solid #29251F;box-shadow:0 2px 8px rgba(15,23,42,.35)"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPlace(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

/** Keeps the chosen point in view when it is set from "use my location". */
function Recentre({ point }: { point: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.setView(point, Math.max(map.getZoom(), 15))
  }, [map, point])
  return null
}

export default function GroupLocationPicker({
  initialLat,
  initialLng,
  groupName,
  onClose,
  onPick,
}: {
  initialLat: string
  initialLng: string
  groupName?: string
  onClose: () => void
  onPick: (lat: string, lng: string) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const startLat = Number(initialLat)
  const startLng = Number(initialLng)
  const validStart = initialLat.trim() !== '' && initialLng.trim() !== '' &&
    Number.isFinite(startLat) && Number.isFinite(startLng)
  const [point, setPoint] = useState<[number, number]>(validStart ? [startLat, startLng] : NYERI)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  useModalFocus(true, panelRef, onClose)

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This device cannot share a location.'); return }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setPoint([pos.coords.latitude, pos.coords.longitude])
        setLocating(false)
      },
      () => {
        setLocating(false)
        setError('Could not read your location. Tap the map instead.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-location-title"
        className="w-full max-w-lg overflow-hidden rounded-[24px] border border-line bg-surface shadow-raised outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-accent">Registration area</p>
            <h2 id="group-location-title" className="mt-0.5 truncate text-base font-extrabold">
              {groupName ? `Where is ${groupName}?` : 'Choose the group area'}
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">Tap the map to place the centre of this congregation. New signups near this point join the group.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close map picker" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface-raised text-ink-muted">✕</button>
        </div>

        <div className="h-[300px] w-full">
          <MapContainer center={point} zoom={validStart ? 14 : 12} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
            <ClickToPlace onPlace={(lat, lng) => setPoint([lat, lng])} />
            <Recentre point={point} />
            <Marker position={point} icon={pinIcon()} />
          </MapContainer>
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded-xl border border-line bg-surface-raised px-3 py-2 text-[11px] text-ink-muted">
            <b className="text-ink">Selected point:</b>{' '}
            {point[0].toFixed(6)}, {point[1].toFixed(6)}
          </div>
          {error && <p className="text-[11px] font-semibold text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="min-h-11 rounded-full border border-line bg-surface-raised px-4 text-xs font-extrabold text-ink disabled:opacity-50"
            >
              {locating ? 'Finding you…' : 'Use my current location'}
            </button>
            <button
              type="button"
              onClick={() => onPick(point[0].toFixed(6), point[1].toFixed(6))}
              className="min-h-11 flex-1 rounded-full bg-accent px-4 text-xs font-extrabold text-white"
            >
              Use this point
            </button>
          </div>
          <p className="text-[10px] leading-4 text-ink-subtle">Nothing changes until you tap “Save settings” on the group form.</p>
        </div>
      </div>
    </div>
  )
}
