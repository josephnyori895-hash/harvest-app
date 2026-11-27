import { useCallback, useEffect, useRef, useState } from 'react'
import { FILTERS, composeLook, lookCss, neutralAdjust, type Adjustments } from '../lib/imageFilters'
import { useModalFocus } from '../lib/useModalFocus'
import { useAndroidBack } from '../lib/useAndroidBack'

// ImageAdjuster — Harvest Family photo editing, modelled on Instagram's create
// screen: a dark immersive canvas that fills the width, a bottom drawer with
// two tabs (Filters · Edit), zoom-to-fill so the photo always covers its crop
// and never shows letterbox bars, and clips + filters that bake into the
// exported JPEG so the server receives exactly what the member saw.
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

/** Instagram's edit carousel glyphs — drawn inline so the strip reads as a row
 *  of tools instead of a form of labelled sliders. */
function ToolGlyph({ kind }: { kind: 'brightness' | 'contrast' | 'saturate' | 'warmth' | 'fade' | 'zoom' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === 'brightness' && (<><circle cx="12" cy="12" r="4.2" {...common} /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" {...common} /></>)}
      {kind === 'contrast' && (<><circle cx="12" cy="12" r="8.4" {...common} /><path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" /></>)}
      {kind === 'saturate' && (<><path d="M12 3.4c3.4 4.2 6 6.8 6 9.9a6 6 0 0 1-12 0c0-3.1 2.6-5.7 6-9.9Z" {...common} /></>)}
      {kind === 'warmth' && (<><rect x="10.4" y="3.4" width="3.2" height="17.2" rx="1.6" {...common} /><circle cx="12" cy="15" r="3.4" fill="currentColor" stroke="none" /></>)}
      {kind === 'fade' && (<><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3" {...common} /><path d="M3.4 12h17.2" {...common} /></>)}
      {kind === 'zoom' && (<><circle cx="10.6" cy="10.6" r="6.4" {...common} /><path d="m15.4 15.4 4.4 4.4" {...common} /><path d="M8.2 10.6h4.8M10.6 8.2v4.8" {...common} /></>)}
    </svg>
  )
}

type ToolKey = keyof Adjustments | 'zoom'

const ADJUST_TOOLS: { key: keyof Adjustments; label: string; min: number; max: number; scale: number }[] = [
  { key: 'brightness', label: 'Brightness', min: 50, max: 150, scale: 100 },
  { key: 'contrast', label: 'Contrast', min: 50, max: 150, scale: 100 },
  { key: 'saturate', label: 'Saturation', min: 0, max: 200, scale: 100 },
  { key: 'warmth', label: 'Warmth', min: 0, max: 100, scale: 100 },
  { key: 'fade', label: 'Fade', min: 0, max: 100, scale: 100 },
]

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
  // Instagram's manual Edit tools: each is a scaled CSS filter so the same
  // string works live on the stage and inside the export's ctx.filter.
  const [adjust, setAdjust] = useState<Adjustments>({ ...neutralAdjust })
  const [tab, setTab] = useState<'filters' | 'edit'>('filters')
  // Instagram shows one tool at a time: pick from the carousel, then drag the
  // single slider underneath. All tools stay mounted (hidden) so each keeps a
  // stable, labelled control for keyboards and screen readers.
  const [activeTool, setActiveTool] = useState<ToolKey>('brightness')
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, rotation: 0 })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The editor fills the screen and is mounted only while it is open, so it is
  // always "open": Escape cancels, focus stays on the controls, and the page
  // behind it cannot scroll.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const pinchRef = useRef<{ dist: number; baseScale: number } | null>(null)
  useModalFocus(true, panelRef, onCancel)

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
    setAdjust({ ...neutralAdjust })
    setZoom(1)
  }

  const applyAdjust = (key: keyof Adjustments, raw: number) => {
    const value = key === 'brightness' || key === 'contrast' ? Math.min(1.5, Math.max(0.5, raw))
      : key === 'saturate' ? Math.min(2, Math.max(0, raw))
      : Math.min(1, Math.max(0, raw))
    setAdjust(a => ({ ...a, [key]: value }))
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
    const lookFilter = composeLook(look, intensity, adjust)
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
  // One string drives both the live preview and the export canvas.
  const previewFilter = composeLook(look, intensity, adjust)
  useAndroidBack(true, onCancel)

  const activeAdjustTool = ADJUST_TOOLS.find(t => t.key === activeTool)
  const selectedToolLabel = activeTool === 'zoom' ? 'Zoom' : activeAdjustTool?.label ?? 'Brightness'

  const stageWidth = (() => {
    const { vw, vh } = stageSize()
    if (!vw || !vh || !imgSize) return 'auto'
    const rotationDegrees = ((transform.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    return iw * (Math.max(vw / iw, vh / ih) || 1) * transform.scale
  })()
  const stageHeight = (() => {
    const { vw, vh } = stageSize()
    if (!vw || !vh || !imgSize) return 'auto'
    const rotationDegrees = ((transform.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    return ih * (Math.max(vw / iw, vh / ih) || 1) * transform.scale
  })()

  return (
    <div ref={panelRef} tabIndex={-1} className="fixed inset-0 z-[60] flex flex-col bg-black text-white outline-none" role="dialog" aria-modal="true" aria-label="Adjust image" style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}>
      {/* Instagram's create header: X on the left, "Next" in blue on the right. */}
      <div className="flex h-14 shrink-0 items-center justify-between px-2">
        <button onClick={onCancel} className="grid h-11 w-11 place-items-center rounded-full" aria-label="Cancel">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <p className="text-sm font-extrabold tracking-tight">Edit</p>
        <button onClick={() => void save()} disabled={saving || !imgSize} className="min-h-11 px-3 text-sm font-extrabold text-sky-400 disabled:opacity-50" aria-label="Apply adjustments" data-testid="image-adjuster-save">
          {saving ? 'Saving…' : 'Next'}
        </button>
      </div>

      {/* stage — edge to edge, zoom-to-fill: the photo covers the crop exactly */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <div
          ref={stageRef}
          className="relative overflow-hidden bg-black touch-none select-none"
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
                filter: previewFilter === 'none' ? undefined : previewFilter,
                width: stageWidth,
                height: stageHeight,
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

      {/* bottom drawer — Instagram's Filters · Edit tabs sit over the media */}
      <div className="shrink-0 bg-black pb-[max(0.5rem,var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))]">
        <div className="flex items-center justify-center gap-8 px-4 pt-2" role="tablist" aria-label="Edit tools">
          <button role="tab" aria-selected={tab === 'filters'} onClick={() => setTab('filters')} className={`flex flex-col items-center gap-1 rounded px-2 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${tab === 'filters' ? 'text-white' : 'text-white/40'}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">            <circle cx="9" cy="9" r="5.2" /><circle cx="15.4" cy="15.4" r="5.2" /></svg>
            <span>Filters</span>
          </button>
          <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={`flex flex-col items-center gap-1 rounded px-2 pb-2 pt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${tab === 'edit' ? 'text-white' : 'text-white/40'}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="8" cy="6" r="1.9" fill="currentColor" /><circle cx="15" cy="12" r="1.9" fill="currentColor" /><circle cx="13" cy="18" r="1.9" fill="currentColor" /></svg>
            <span>Edit</span>
          </button>
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
                <span className={`block h-16 w-16 overflow-hidden rounded-lg ring-2 ${look === name ? 'ring-sky-400' : 'ring-white/10'}`}>
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
          <div className="flex items-center gap-3 px-4 pb-1 pt-2" data-testid="image-adjuster-intensity-row">
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
          <div className="pt-1">
            {/* Instagram's tool carousel: tap a tool, then drag the slider. */}
            <div className="flex min-w-0 gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Adjustment tools">
              {(['brightness', 'contrast', 'saturate', 'warmth', 'fade', 'zoom'] as ToolKey[]).map(key => {
                const label = key === 'zoom' ? 'Zoom' : ADJUST_TOOLS.find(t => t.key === key)?.label ?? key
                const selected = activeTool === key
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTool(key)}
                    className={`flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-lg py-2 transition ${selected ? 'bg-white/10 text-white' : 'text-white/50'}`}
                  >
                    <ToolGlyph kind={key as any} />
                    <span className="text-[10px] font-bold">{label}</span>
                  </button>
                )
              })}
            </div>

            {/* One slider at a time, exactly like Instagram — the hidden rows
                stay mounted so every tool keeps a labelled control. */}
            <div className="px-4 pb-1 pt-2">
              {ADJUST_TOOLS.map(tool => {
                const value = Math.round(adjust[tool.key] * tool.scale)
                return (
                  <div key={tool.key} className={activeTool === tool.key ? 'flex items-center gap-3' : 'hidden'}>
                    <input
                      type="range" min={tool.min} max={tool.max} step={1} value={value}
                      onChange={e => applyAdjust(tool.key, Number(e.target.value) / tool.scale)}
                      className="min-w-0 flex-1 accent-sky-400"
                      aria-label={`${tool.label} adjustment`}
                      data-testid={`image-adjuster-${tool.key}`}
                    />
                    <span className="w-8 shrink-0 text-right text-[10px] font-bold text-white/70" aria-hidden="true">{value}%</span>
                  </div>
                )
              })}
              <div className={activeTool === 'zoom' ? 'flex items-center gap-3' : 'hidden'}>
                <span className="text-2xs font-bold text-white/60" aria-hidden="true">−</span>
                <input
                  type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.01} value={zoom}
                  onChange={e => applyZoomSlider(Number(e.target.value))}
                  className="flex-1 accent-sky-400"
                  aria-label="Zoom"
                />
                <span className="text-2xs font-bold text-white/60" aria-hidden="true">+</span>
              </div>
              <p className="pt-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">{selectedToolLabel}</p>
            </div>

            <div className="flex items-center gap-2 px-3 pb-1 pt-1">
              <button onClick={rotate} className="min-h-9 shrink-0 rounded-full bg-white/10 px-3 text-[11px] font-bold text-white/85" aria-label="Rotate image" data-testid="image-adjuster-rotate">Rotate</button>
              <button onClick={reset} className="min-h-9 shrink-0 rounded-full bg-white/10 px-3 text-[11px] font-bold text-white/85" aria-label="Reset image adjustments">Reset</button>
              <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setAspect(p.id); setTransform({ x: 0, y: 0, scale: 1, rotation: 0 }); setZoom(1) }}
                    className={`flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1 ${aspect === p.id ? 'bg-white/15' : 'bg-white/5'}`}
                    aria-pressed={aspect === p.id}
                    aria-label={p.label}
                    data-testid={`image-adjuster-aspect-${p.id}`}
                  >
                    <span
                      className={`rounded-sm border-2 ${aspect === p.id ? 'border-sky-400' : 'border-white/45'}`}
                      style={{ width: p.ratio == null ? 20 : p.ratio >= 1 ? 20 : Math.max(11, Math.round(20 * p.ratio)), height: p.ratio == null ? 20 : Math.round(20 / Math.max(p.ratio, 0.5)) }}
                    />
                  </button>
                ))}
              </div>
            </div>
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
