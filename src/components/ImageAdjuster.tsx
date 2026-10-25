import { useCallback, useEffect, useRef, useState } from 'react'

// ImageAdjuster — Harvest Family photo adjustments.
// Drag to reposition, pinch or slider to zoom, 90° rotate, and crop presets
// (original / square / portrait / wide). "Save" bakes the adjustments
// into a JPEG blob that replaces the picked file before upload, so the server
// receives exactly what the user sees.
//
// Pure-canvas implementation (no external libs) so it works in the APK WebView.

export type AspectPreset = 'original' | '1:1' | '3:4' | '4:5' | '16:9'

const PRESETS: { id: AspectPreset; label: string; box: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', box: 'w-6 h-6', ratio: null },
  { id: '1:1', label: 'Square', box: 'w-6 h-6', ratio: 1 },
  { id: '3:4', label: 'Tall portrait', box: 'w-5 h-6', ratio: 3 / 4 },
  { id: '4:5', label: 'Portrait', box: 'w-5 h-6', ratio: 4 / 5 },
  { id: '16:9', label: 'Wide', box: 'w-7 h-4', ratio: 16 / 9 },
]

type Transform = { x: number; y: number; scale: number; rotation: number }

const MIN_SCALE = 1
const MAX_SCALE = 5

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
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, rotation: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotating, setRotating] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
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

  const viewportSize = useCallback(() => {
    const el = viewportRef.current
    if (!el) return { vw: 0, vh: 0 }
    return { vw: el.clientWidth, vh: el.clientHeight }
  }, [])

  const activeRatio = PRESETS.find(p => p.id === aspect)?.ratio ?? null

  const cropSize = useCallback((vw: number, vh: number, ratio: number | null) => {
    if (!vw || !vh) return { cw: vw, ch: vh }
    const target = ratio ?? (imgSize ? imgSize.w / imgSize.h : vw / vh)
    return vw / vh > target
      ? { cw: vh * target, ch: vh }
      : { cw: vw, ch: vw / target }
  }, [imgSize])

  const clampTransform = useCallback((t: Transform): Transform => {
    if (!imgSize) return t
    const { vw, vh } = viewportSize()
    if (!vw || !vh) return t
    const rotationDegrees = ((t.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const { cw, ch } = cropSize(vw, vh, activeRatio ?? iw / ih)
    const fit = Math.max(cw / iw, ch / ih) || 1
    const dw = iw * fit * t.scale
    const dh = ih * fit * t.scale
    const maxX = Math.max((dw - cw) / 2, 0)
    const maxY = Math.max((dh - ch) / 2, 0)
    return {
      ...t,
      scale: Math.min(Math.max(t.scale, MIN_SCALE), MAX_SCALE),
      x: Math.min(Math.max(t.x, -maxX), maxX),
      y: Math.min(Math.max(t.y, -maxY), maxY),
    }
  }, [imgSize, viewportSize, cropSize, activeRatio])

  const minScaleFor = useCallback(() => {
    if (!imgSize) return 1
    const { vw, vh } = viewportSize()
    if (!vw || !vh) return 1
    const rotationDegrees = ((transform.rotation % 360) + 360) % 360
    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const { cw, ch } = cropSize(vw, vh, activeRatio ?? iw / ih)
    return Math.max(cw / iw, ch / ih) || 1
  }, [imgSize, transform.rotation, viewportSize, cropSize, activeRatio])

  useEffect(() => { setZoom(transform.scale) }, [transform.scale])

  const rotate = () => {
    setTransform(t => clampTransform({ ...t, rotation: (t.rotation + 90) % 360, x: 0, y: 0 }))
  }

  const reset = () => {
    setTransform({ x: 0, y: 0, scale: 1, rotation: 0 })
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
    const min = minScaleFor()
    setTransform(t => clampTransform({ ...t, scale: Math.max(v, min) }))
  }

  const exportBlob = async (): Promise<Blob> => {
    if (!imgSize || !srcUrl) throw new Error('image not ready')
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('could not read image')); img.src = srcUrl })

    const { vw, vh } = viewportSize()
    const rotationDegrees = ((transform.rotation % 360) + 360) % 360
    const sourceRatio = rotationDegrees === 90 || rotationDegrees === 270 ? imgSize.h / imgSize.w : imgSize.w / imgSize.h
    const { cw, ch } = cropSize(vw, vh, activeRatio ?? sourceRatio)
    const outW = Math.max(1, Math.round(cw >= ch ? 1440 : 1440 * cw / ch))
    const outH = Math.max(1, Math.round(ch > cw ? 1440 : 1440 * ch / cw))
    const canvas = document.createElement('canvas')
    canvas.width = outW; canvas.height = outH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, outW, outH)

    const swapped = rotationDegrees === 90 || rotationDegrees === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const minScale = Math.max(cw / iw, ch / ih) || 1
    const drawW = iw * minScale * transform.scale
    const drawH = ih * minScale * transform.scale

    ctx.save()
    ctx.translate(outW / 2 + transform.x * (outW / cw), outH / 2 + transform.y * (outH / ch))
    ctx.rotate((rotationDegrees * Math.PI) / 180)
    const drawnW = swapped ? drawH : drawW
    const drawnH = swapped ? drawW : drawH
    ctx.drawImage(img, -drawnW / 2, -drawnH / 2, drawnW, drawnH)
    ctx.restore()

    const long = Math.max(outW, outH)
    let final = canvas
    if (long > 1440) {
      const k = 1440 / long
      const c2 = document.createElement('canvas')
      c2.width = Math.round(outW * k); c2.height = Math.round(outH * k)
      c2.getContext('2d')!.drawImage(canvas, 0, 0, c2.width, c2.height)
      final = c2
    }
    const blob: Blob = await new Promise(res => final.toBlob(b => res(b!), 'image/jpeg', 0.9))
    return blob
  }

  const save = async () => {
    try {
      setRotating(true)
      const blob = await exportBlob()
      onDone(blob, URL.createObjectURL(blob))
    } finally {
      setRotating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#FFFBF0] flex flex-col" role="dialog" aria-label="Adjust image">
      <div className="h-14 shrink-0 flex items-center justify-between px-3 border-b border-[#E8DEC9] bg-[#FFFBF0]">
        <button onClick={onCancel} className="text-sm text-stone-300 px-2 py-2" aria-label="Cancel">✕ Cancel</button>
        <p className="text-sm font-bold text-white">Adjust</p>
        <button onClick={() => void save()} disabled={rotating || !imgSize} className="text-sm font-bold text-[#C4B5FD] px-2 py-2 disabled:opacity-50" aria-label="Apply adjustments" data-testid="image-adjuster-save">Save</button>
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden touch-none select-none bg-[#F4E8D0]"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onDoubleClick={onDoubleClick}
        style={{ cursor: 'grab' }}
      >
        {srcUrl && imgSize && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <img
              src={srcUrl}
              alt=""
              draggable={false}
              className="max-w-none pointer-events-none"
              style={{
                width: (() => {
                  const rotationDegrees = ((transform.rotation % 360) + 360) % 360
                  const swapped = rotationDegrees === 90 || rotationDegrees === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const { vw, vh } = viewportSize()
                  const sourceRatio = rotationDegrees === 90 || rotationDegrees === 270 ? imgSize.h / imgSize.w : imgSize.w / imgSize.h
                  const { cw, ch } = cropSize(vw, vh, activeRatio ?? sourceRatio)
                  const minScale = Math.max(cw / iw, ch / ih) || 1
                  return iw * minScale * transform.scale
                })(),
                height: (() => {
                  const rotationDegrees = ((transform.rotation % 360) + 360) % 360
                  const swapped = rotationDegrees === 90 || rotationDegrees === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const { vw, vh } = viewportSize()
                  const sourceRatio = rotationDegrees === 90 || rotationDegrees === 270 ? imgSize.h / imgSize.w : imgSize.w / imgSize.h
                  const { cw, ch } = cropSize(vw, vh, activeRatio ?? sourceRatio)
                  const minScale = Math.max(cw / iw, ch / ih) || 1
                  return ih * minScale * transform.scale
                })(),
                transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
                transition: dragRef.current ? 'none' : 'width 0.15s, height 0.15s',
              }}
            />
          </div>
        )}
        {(() => {
          const { vw, vh } = viewportSize()
          const rotated = ((transform.rotation % 360) + 360) % 360
          const sourceRatio = imgSize ? (rotated === 90 || rotated === 270 ? imgSize.h / imgSize.w : imgSize.w / imgSize.h) : vw / vh
          const { cw, ch } = cropSize(vw, vh, activeRatio ?? sourceRatio)
          return <div className="absolute pointer-events-none border-2 border-white/90" data-testid="image-adjuster-crop-frame" style={{ width: cw, height: ch, left: (vw - cw) / 2, top: (vh - ch) / 2 }}>
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/25" />)}</div>
          </div>
        })()}
      </div>

      <div className="shrink-0 border-t border-[#E8DEC9] px-4 pt-4 pb-[max(1rem,var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))] space-y-4 bg-[#FFFBF0]">
        <div className="flex items-center gap-3">
          <span className="text-lg text-stone-400 w-6" aria-hidden="true">🔍−</span>
          <input
            type="range" min={1} max={5} step={0.01} value={zoom}
            onChange={e => applyZoomSlider(Number(e.target.value))}
            className="flex-1 accent-sky-400"
            aria-label="Zoom"
          />
          <span className="text-lg text-stone-400 w-6" aria-hidden="true">🔍＋</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="shrink-0 px-3 py-2 rounded-xl bg-white/5 text-stone-300 text-[11px] font-bold" aria-label="Reset image adjustments">Reset</button>
          <button onClick={rotate} className="shrink-0 px-3 py-2 rounded-xl bg-white/5 text-stone-300 text-[11px] font-bold" aria-label="Rotate image">↻ Rotate</button>
          <div className="flex gap-2 overflow-x-auto min-w-0">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => { setAspect(p.id); setTransform({ x: 0, y: 0, scale: 1, rotation: 0 }); setZoom(1) }}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl ${aspect === p.id ? 'bg-white/15' : 'bg-white/5'}`}
                aria-pressed={aspect === p.id}
                data-testid={`image-adjuster-aspect-${p.id}`}
              >
                <span className={`${p.box} rounded-sm border-2 ${aspect === p.id ? 'border-sky-400' : 'border-stone-500'}`} />
                <span className={`text-[10px] font-bold ${aspect === p.id ? 'text-sky-400' : 'text-stone-400'}`}>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-stone-500 text-center">Drag to move · pinch or slide to zoom · double-tap to reset</p>
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
