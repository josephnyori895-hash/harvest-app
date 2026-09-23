import { useCallback, useEffect, useRef, useState } from 'react'

// ImageAdjuster — Instagram-style pre-post editing for photos.
// Drag to reposition, pinch or slider to zoom, 90° rotate, and crop presets
// (original / square / portrait / landscape). "Save" bakes the adjustments
// into a JPEG blob that replaces the picked file before upload, so the server
// receives exactly what the user sees.
//
// Pure-canvas implementation (no external libs) so it works in the APK WebView.

export type AspectPreset = 'original' | '1:1' | '4:5' | '16:9'

const PRESETS: { id: AspectPreset; label: string; box: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', box: 'w-6 h-6', ratio: null },
  { id: '1:1', label: 'Square', box: 'w-6 h-6', ratio: 1 },
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

  // Load the picked file into an <img> we can measure and draw.
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

  const rotatedDimensions = useCallback(() => {
    if (!imgSize) return { w: 0, h: 0 }
    const rot = ((transform.rotation % 360) + 360) % 360
    return rot === 90 || rot === 270 ? { w: imgSize.h, h: imgSize.w } : { w: imgSize.w, h: imgSize.h }
  }, [imgSize, transform.rotation])

  const activeRatio = useCallback(() => {
    if (aspect === 'original') {
      const d = rotatedDimensions()
      return d.w && d.h ? d.w / d.h : 1
    }
    return PRESETS.find(p => p.id === aspect)?.ratio ?? 1
  }, [aspect, rotatedDimensions])

  const cropSize = useCallback(() => {
    const { vw, vh } = viewportSize()
    if (!vw || !vh) return { cw: 0, ch: 0 }
    const ratio = activeRatio()
    return ratio >= vw / vh
      ? { cw: vw, ch: vw / ratio }
      : { cw: vh * ratio, ch: vh }
  }, [activeRatio, viewportSize])

  const clampTransform = useCallback((t: Transform): Transform => {
    if (!imgSize) return t
    const { cw, ch } = cropSize()
    if (!cw || !ch) return t
    const rot = ((t.rotation % 360) + 360) % 360
    const swapped = rot === 90 || rot === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const cover = Math.max(cw / iw, ch / ih)
    const dw = iw * cover * t.scale
    const dh = ih * cover * t.scale
    const maxX = Math.max((dw - cw) / 2, 0)
    const maxY = Math.max((dh - ch) / 2, 0)
    return {
      ...t,
      scale: Math.min(Math.max(t.scale, MIN_SCALE), MAX_SCALE),
      x: Math.min(Math.max(t.x, -maxX), maxX),
      y: Math.min(Math.max(t.y, -maxY), maxY),
    }
  }, [cropSize, imgSize])

  const minScaleFor = useCallback(() => {
    if (!imgSize) return 1
    const { cw, ch } = cropSize()
    const d = rotatedDimensions()
    if (!cw || !ch || !d.w || !d.h) return 1
    return Math.max(cw / d.w, ch / d.h)
  }, [cropSize, imgSize, rotatedDimensions])

  const selectAspect = (next: AspectPreset) => {
    setAspect(next)
    requestAnimationFrame(() => setTransform(t => clampTransform({ ...t, x: 0, y: 0 })))
  }

  const rotate = () => {
    setTransform(t => clampTransform({ ...t, rotation: (t.rotation + 90) % 360, x: 0, y: 0 }))
  }

  // Drag to pan (mouse + touch).
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

  // Two-finger pinch zoom.
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

  const applyZoomSlider = (v: number) => {
    const min = minScaleFor()
    setTransform(t => clampTransform({ ...t, scale: Math.max(v, min) }))
  }

  // Export exactly the selected crop viewport so the file ratio matches the UI.
  const exportBlob = async (): Promise<Blob> => {
    if (!imgSize || !srcUrl) throw new Error('image not ready')
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('could not read image'))
      img.src = srcUrl
    })

    const { cw, ch } = cropSize()
    if (!cw || !ch) throw new Error('crop viewport not ready')
    const outW = Math.max(1, Math.round(cw * 2))
    const outH = Math.max(1, Math.round(ch * 2))
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, outW, outH)

    const rot = ((transform.rotation % 360) + 360) % 360
    const rotated = rot === 90 || rot === 270
    const iw = rotated ? imgSize.h : imgSize.w
    const ih = rotated ? imgSize.w : imgSize.h
    const cover = Math.max(cw / iw, ch / ih)
    const drawScale = cover * transform.scale

    ctx.save()
    ctx.translate(outW / 2 + transform.x * 2, outH / 2 + transform.y * 2)
    ctx.rotate((rot * Math.PI) / 180)
    ctx.drawImage(img, -(imgSize.w * drawScale) / 2, -(imgSize.h * drawScale) / 2, imgSize.w * drawScale, imgSize.h * drawScale)
    ctx.restore()

    const long = Math.max(outW, outH)
    let final = canvas
    if (long > 1440) {
      const k = 1440 / long
      const c2 = document.createElement('canvas')
      c2.width = Math.max(1, Math.round(outW * k))
      c2.height = Math.max(1, Math.round(outH * k))
      c2.getContext('2d')!.drawImage(canvas, 0, 0, c2.width, c2.height)
      final = c2
    }
    return await new Promise<Blob>((resolve, reject) => {
      final.toBlob(b => b ? resolve(b) : reject(new Error('could not encode image')), 'image/jpeg', 0.9)
    })
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
    <div className="fixed inset-0 z-[60] bg-[#FFFBF0] text-[#29251F] flex flex-col hf-image-editor" role="dialog" aria-label="Adjust image" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="h-14 shrink-0 flex items-center justify-between px-3 border-b border-[#E8DEC9]">
        <button onClick={onCancel} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-sm text-[#5B5248] px-2 py-2 active:bg-[#F5EEDF]" aria-label="Cancel">✕ Cancel</button>
        <p className="text-sm font-extrabold text-[#29251F]">Adjust</p>
        <button data-testid="image-adjuster-save" onClick={() => void save()} disabled={rotating || !imgSize} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-sm font-extrabold text-[#7C3AED] px-2 py-2 active:bg-[#F3E8FF] disabled:opacity-50" aria-label="Apply adjustments">{rotating ? '…' : 'Save ✓'}</button>
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden touch-none select-none bg-[#111] flex items-center justify-center"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ cursor: 'grab' }}
      >
        <div
          className="relative overflow-hidden bg-[#111] shrink-0"
          style={{ width: cropSize().cw || '100%', height: cropSize().ch || '100%', maxWidth: '100%', maxHeight: '100%' }}
        >
          {srcUrl && imgSize && (
            <img
              src={srcUrl}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
              style={{
                width: (() => {
                  const d = rotatedDimensions()
                  const { cw, ch } = cropSize()
                  return imgSize.w * Math.max(cw / d.w, ch / d.h) * transform.scale
                })(),
                height: (() => {
                  const d = rotatedDimensions()
                  const { cw, ch } = cropSize()
                  return imgSize.h * Math.max(cw / d.w, ch / d.h) * transform.scale
                })(),
                transform: 'translate(calc(-50% + ' + transform.x + 'px), calc(-50% + ' + transform.y + 'px)) rotate(' + transform.rotation + 'deg)',
              }}
            />
          )}
          <div className="absolute inset-0 pointer-events-none border-2 border-white/90" />
          <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/20" />)}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-[#E8DEC9] px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-4 bg-[#FFFBF0]">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8A8175]">Adjust photo</p>
        <div className="flex items-center gap-3">
          <span className="text-lg text-[#766E63] w-6">🔍−</span>
          <input
            type="range" min={1} max={5} step={0.01} value={zoom}
            onChange={e => applyZoomSlider(Number(e.target.value))}
            className="flex-1 accent-[#7C3AED]"
            aria-label="Zoom"
          />
          <span className="text-lg text-zinc-400 w-6">🔍＋</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2 overflow-x-auto">
            {PRESETS.map(p => (
              <button
                key={p.id}
                data-testid={`image-adjuster-aspect-${p.id}`}
                onClick={() => selectAspect(p.id)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl ${aspect === p.id ? 'bg-[#F3E8FF]' : 'bg-[#F5EEDF]'}`}
                aria-pressed={aspect === p.id}
              >
                <span className={`${p.box} rounded-sm border-2 ${aspect === p.id ? 'border-[#7C3AED]' : 'border-[#A49A8E]'}`} />
                <span className={`text-[10px] font-bold ${aspect === p.id ? 'text-[#7C3AED]' : 'text-zinc-400'}`}>{p.label}</span>
              </button>
            ))}
          </div>
          <button onClick={rotate} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl bg-[#7C3AED] text-white text-xl active:scale-95 transition-transform" aria-label="Rotate 90 degrees">⟳</button>
        </div>
        <p className="text-[11px] leading-5 text-[#8A8175] text-center">Drag to reposition · pinch or slide to zoom · choose a crop shape</p>
      </div>
    </div>
  )
}

// Capture a frame from a video at a given time — used by the reel cover picker.
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
