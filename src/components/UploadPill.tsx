import { useEffect, useState } from 'react'
import { getUploads, subscribeUploads, type BgUpload } from '../lib/backgroundUploads'

// Floating pill (bottom-right, above the nav bar) showing active background
// uploads. Renders on every tab so users can keep browsing while media sends.
export default function UploadPill() {
  const [uploads, setUploads] = useState<BgUpload[]>(getUploads())
  useEffect(() => subscribeUploads(() => setUploads(getUploads())), [])

  // Multiple uploads stack; collapse older ones behind a count badge.
  const active = uploads.slice(-3)
  const hidden = uploads.length - active.length
  if (uploads.length === 0) return null

  return (
    <div className="fixed bottom-[68px] right-3 z-40 flex flex-col gap-2 items-end pointer-events-none">
      {hidden > 0 && (
        <div className="pointer-events-auto rounded-full bg-neutral-900/85 text-white text-[10px] font-bold px-3 py-1.5 shadow-lg backdrop-blur">
          +{hidden} more uploading
        </div>
      )}
      {active.map(u => (
        <div
          key={u.id}
          role="status"
          aria-label={`${u.label} uploading, ${u.pct}% complete`}
          className="pointer-events-auto max-w-[260px] rounded-2xl bg-neutral-900/90 text-white shadow-2xl backdrop-blur px-3.5 py-2.5 border border-white/10"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={u.pct >= 100 ? '#4ade80' : '#a78bfa'}
                strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${(u.pct / 100) * 97.4} 97.4`}
                transform="rotate(-90 18 18)"
                style={{ transition: 'stroke-dasharray 0.3s ease' }}
              />
              <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="white">{u.pct >= 100 ? '✓' : u.pct}</text>
            </svg>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate leading-tight">{u.pct >= 100 ? 'Almost done…' : `Uploading ${u.label}`}</p>
              <p className="text-[10px] text-white/55 leading-tight">You can keep using the app</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
