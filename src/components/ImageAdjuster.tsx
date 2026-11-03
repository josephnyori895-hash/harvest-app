import { useCallback, useEffect, useRef, useState } from 'react'
import { FILTERS, lookCss } from '../lib/imageFilters'

// ImageAdjuster — Harvest Family photo editing, modelled on Instagram's create
// screen: a dark immersive canvas that fills the width, two tabs (Filters ·
// Edit), zoom-to-fill so the photo always covers its crop and never shows
// letterbox bars, and clips + filters that bake into the exported JPEG so the
// server receives exactly what the member saw.
//
// Pure-canvas implementation (no external libs) so it works in the APK WebView.

export type AspectPreset = 'original' | '1:1' | '3:4' | '4:5' | '16:9'

const PRESETS: { id: AspectPreset; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '3:4', label: 'Tall portrait', ratio: 3 / 4 },
  { id: '4:5', label: 'Portrait', ratio: 4 / 5 },
  { id: '16:9', label: 'Wide', ratio: 16 / 9 },
]

type Transform = { x: number; y: number; scale: number; rotation: number }

const MIN_SCALE = 1
const MAX_SCALE = 5
// Feed parity: a post never renders outside this ratio band, so a crop outside
// it would be re-cropped by the feed — a look the editor would be lying about.
const MIN_RATIO = 0.8
const MAX_RATIO = 1.91

export default function ImageAdjuster({
  file,
  onCancel,
  onDone,
}: {
  file: File
  onCancel: () => void
  onDone: (blob: Blob, previewUrl: string) => void
}) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [aspect, setAspect] = useState<AspectPreset>('original')
  const [look, setLook] = useState('Original')
  // Instagram-style intensity for the active look: 0 = original, 1 = full effect.
  const [intensity, setIntensity] = useState(1)
  const [tab, setTab] = useState<'filters' | 'edit'>('filters')
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, rotation: 0 })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const pinchRef = useRef<{ dist: number; baseScale: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrcUrl(url)
    const img = new Image()
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const stageSize = useCallback(() => {
    const el = stageRef.current
    if (!el) return { vw: 0, vh: 0 }
    return { vw: el.clientWidth, vh: el.clientHeight }
  }, [])

  // The crop region the export bakes: the stage area itself (zoom-to-fill —
  // the photo always covers it, nothing is visible but photo).
  const activeRatio: number | null = PRESETS.find(p => p.id === aspect)?.ratio ?? null
  const naturalRatio = imgSize ? imgSize.w / imgSize.h : 4 / 5

  const clampTransform = useCallback((t: Transform): Transform => {
    if (!imgSize) return t
    const { vw, vh } = stageSize()
    if (!vw || !vh) return t
    const rotationDegrees = ((t.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const fit = Math.max(vw / iw, vh / ih) || 1
    const dw = iw * fit * t.scale
    const dh = ih * fit * t.scale
    const maxX = Math.max((dw - vw) / 2, 0)
    const maxY = Math.max((dh - vh) / 2, 0)
    return {
      ...t,
      scale: Math.min(Math.max(t.scale, MIN_SCALE), MAX_SCALE),
      x: Math.min(Math.max(t.x, -maxX), maxX),
      y: Math.min(Math.max(t.y, -maxY), maxY),
    }
  }, [imgSize, stageSize])

  useEffect(() => { setZoom(transform.scale) }, [transform.scale])

  const rotate = () => {
    setTransform(t => clampTransform({ ...t, rotation: (t.rotation + 90) % 360, x: 0, y: 0 }))
  }

  const reset = () => {
    setTransform({ x: 0, y: 0, scale: 1, rotation: 0 })
    setLook('Original')
    setIntensity(1)
    setZoom(1)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && (e as any).isPrimary === false) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: transform.x, baseY: transform.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setTransform(t => clampTransform({ ...t, x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) }))
  }
  const onPointerUp = () => { dragRef.current = null }

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2) return
    const [a, b] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (!pinchRef.current) {
      pinchRef.current = { dist, baseScale: transform.scale }
      return
    }
    const ratio = dist / pinchRef.current.dist
    setTransform(t => clampTransform({ ...t, scale: pinchRef.current!.baseScale * ratio }))
  }
  const onTouchEnd = () => { pinchRef.current = null }

  const onDoubleClick = () => reset()

  const applyZoomSlider = (v: number) => {
    setTransform(t => clampTransform({ ...t, scale: Math.max(v, MIN_SCALE) }))
  }

  const exportBlob = async (): Promise<Blob> => {
    if (!imgSize || !srcUrl) throw new Error('image not ready')
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('could not read image')); img.src = srcUrl })

    const { vw, vh } = stageSize()
    const rotationDegrees = ((transform.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    // Out ratio: the preset, or for Original the uncropped source ratio.
    const outRatio = activeRatio ?? (iw / ih)
    let outW: number, outH: number
    if (outRatio >= 1) { outW = 1440; outH = Math.max(1, Math.round(1440 / outRatio)) }
    else { outH = 1440; outW = Math.max(1, Math.round(1440 * outRatio)) }
    const canvas = document.createElement('canvas')
    canvas.width = outW; canvas.height = outH
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    // Defensive under-fill: coverage arithmetic has a 1.002 slack, so this must
    // never be visible — but if a rounding edge ever shows, it reads as paper,
    // not as the black-bar client bug.
    ctx.fillStyle = '#F4E8D0'; ctx.fillRect(0, 0, outW, outH)

    const minScale = (Math.max(outW / iw, outH / ih) || 1) * 1.002
    const drawW = iw * minScale * transform.scale
    const drawH = ih * minScale * transform.scale
    ctx.save()
    const lookFilter = lookCss(look, intensity)
    if (lookFilter !== 'none' && 'filter' in ctx) ctx.filter = lookFilter
    ctx.translate(outW / 2 + transform.x * (outW / vw), outH / 2 + transform.y * (outH / vh))
    ctx.rotate((rotationDegrees * Math.PI) / 180)
    const drawnW = swapped ? drawH : drawW
    const drawnH = swapped ? drawW : drawH
    ctx.drawImage(img, -drawnW / 2, -drawnH / 2, drawnW, drawnH)
    ctx.restore()

    const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/jpeg', 0.9))
    return blob
  }

  const save = async () => {
    try {
      setSaving(true)
      const blob = await exportBlob()
      onDone(blob, URL.createObjectURL(blob))
    } finally {
      setSaving(false)
    }
  }

  const croppedDisplayRatio = activeRatio ?? Math.min(Math.max(naturalRatio, MIN_RATIO), MAX_RATIO)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-label="Adjust image">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-2">
        <button onClick={onCancel} className="grid h-10 w-10 place-items-center rounded-full" aria-label="Cancel">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <p className="text-base font-extrabold">Edit photo</p>
        <button onClick={() => void save()} disabled={saving || !imgSize} className="px-2 text-base font-extrabold text-sky-400 disabled:opacity-50" aria-label="Apply adjustments" data-testid="image-adjuster-save">
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>

      {/* stage — zoom-to-fill: the photo covers the crop exactly, edge to edge */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-0 py-4">
        <div
          ref={stageRef}
          className="relative overflow-hidden bg-surface-sunken touch-none select-none"
          style={{ aspectRatio: String(croppedDisplayRatio), maxWidth: '100%', maxHeight: '100%', width: '100%' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onDoubleClick={onDoubleClick}
        >
          {srcUrl && imgSize && (
            <img
              src={srcUrl}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
              style={{
                filter: lookCss(look, intensity) === 'none' ? undefined : lookCss(look, intensity),
                width: (() => {
                  const { vw, vh } = stageSize()
                  if (!vw || !vh) return 'auto'
                  const rotationDegrees = ((transform.rotation % 360) + 360) % 360
                  const swapped = rotationDegrees === 90 || rotationDegrees === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const minScale = Math.max(vw / iw, vh / ih) || 1
                  return iw * minScale * transform.scale
                })(),
                height: (() => {
                  const { vw, vh } = stageSize()
                  if (!vw || !vh) return 'auto'
                  const rotationDegrees = ((transform.rotation % 360) + 360) % 360
                  const swapped = rotationDegrees === 90 || rotationDegrees === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const minScale = Math.max(vw / iw, vh / ih) || 1
                  return ih * minScale * transform.scale
                })(),
                transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
                transition: dragRef.current ? 'none' : 'width 0.15s, height 0.15s',
              }}
            />
          )}
          {tab === 'edit' && (
            <div className="pointer-events-none absolute inset-0" data-testid="image-adjuster-crop-frame">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/25" />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* tabs — Filters | Edit, like Instagram's own edit bottom drawer */}
      <div className="shrink-0 border-t border-white/10 bg-black pb-[max(0.75rem,var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))]">
        <div className="flex items-center justify-center gap-6 px-4 pt-3" role="tablist" aria-label="Edit tools">
          <button role="tab" aria-selected={tab === 'filters'} onClick={() => setTab('filters')} className={`rounded px-2 pb-2 pt-1 text-xs font-extrabold uppercase tracking-[0.16em] ${tab === 'filters' ? 'text-white' : 'text-white/40'}`}>Filters</button>
          <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={`rounded px-2 pb-2 pt-1 text-xs font-extrabold uppercase tracking-[0.16em] ${tab === 'edit' ? 'text-white' : 'text-white/40'}`}>Edit</button>
        </div>

        {tab === 'filters' && (
          <div className="flex min-w-0 gap-2 overflow-x-auto px-3 pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map(name => (
              <button
                key={name}
                onClick={() => { setLook(name); setIntensity(1) }}
                aria-pressed={look === name}
                className="flex w-16 shrink-0 flex-col items-center gap-1"
              >
                <span className={`block h-16 w-16 overflow-hidden rounded-xl ring-2 ${look === name ? 'ring-sky-400' : 'ring-white/10'}`}>
                  {srcUrl && imgSize && (
                    <img
                      src={srcUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                      style={{ filter: lookCss(name) === 'none' ? undefined : lookCss(name) }}
                    />
                  )}
                </span>
                <span className={`max-w-full truncate text-[10px] font-semibold ${look === name ? 'text-white' : 'text-white/55'}`}>{name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'filters' && look !== 'Original' && (
          <div className="flex items-center gap-3 px-4 pb-1 pt-1" data-testid="image-adjuster-intensity-row">
            <span className="w-14 shrink-0 text-2xs font-bold text-white/45" aria-hidden="true">Intensity</span>
            <input
              type="range" min={0} max={100} step={1} value={Math.round(intensity * 100)}
              onChange={e => setIntensity(Number(e.target.value) / 100)}
              className="min-w-0 flex-1 accent-sky-400"
              aria-label="Filter intensity"
              data-testid="image-adjuster-intensity"
            />
            <span className="w-9 shrink-0 text-right text-2xs font-bold text-white/70" aria-hidden="true">{Math.round(intensity * 100)}%</span>
          </div>
        )}

        {tab === 'edit' && (
          <div className="space-y-3 px-4 pb-2 pt-3">
            <div className="flex items-center gap-3">
              <span className="text-2xs font-bold text-white/60" aria-hidden="true">−</span>
              <input
                type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.01} value={zoom}
                onChange={e => applyZoomSlider(Number(e.target.value))}
                className="flex-1 accent-sky-400"
                aria-label="Zoom"
              />
              <span className="text-2xs font-bold text-white/60" aria-hidden="true">+</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white/80" aria-label="Reset image adjustments">Reset</button>
              <button onClick={rotate} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white/80" aria-label="Rotate image" data-testid="image-adjuster-rotate">Rotate</button>
              <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setAspect(p.id); setTransform({ x: 0, y: 0, scale: 1, rotation: 0 }); setZoom(1) }}
                    className={`flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 ${aspect === p.id ? 'bg-white/15' : 'bg-white/5'}`}
                    aria-pressed={aspect === p.id}
                    data-testid={`image-adjuster-aspect-${p.id}`}
                  >
                    <span
                      className={`rounded-sm border-2 ${aspect === p.id ? 'border-sky-400' : 'border-white/45'}`}
                      style={{ width: p.ratio == null ? 22 : p.ratio >= 1 ? 22 : Math.max(12, Math.round(22 * p.ratio)), height: p.ratio == null ? 22 : Math.round(22 / Math.max(p.ratio, 0.5)) }}
                    />
                    <span className={`text-[10px] font-bold ${aspect === p.id ? 'text-white' : 'text-white/55'}`}>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-center text-[10px] text-white/35">Drag to move · pinch to zoom · double-tap to reset</p>
          </div>
        )}
      </div>
    </div>
  )
}

export async function captureVideoFrame(videoUrl: string, timeSec: number): Promise<Blob | null> {
  return new Promise(resolve => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.src = videoUrl
    const fail = () => resolve(null)
    v.onerror = fail
    v.onloadedmetadata = () => {
      const t = Math.min(Math.max(timeSec, 0), Math.max((v.duration || 0) - 0.1, 0))
      v.currentTime = t
    }
    v.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        const k = Math.min(1, 1440 / Math.max(v.videoWidth || 1, v.videoHeight || 1))
        canvas.width = Math.round((v.videoWidth || 720) * k)
        canvas.height = Math.round((v.videoHeight || 1280) * k)
        canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9)
      } catch { resolve(null) }
    }
    setTimeout(() => resolve(null), 8000)
  })
}
