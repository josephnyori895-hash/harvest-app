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

  const activeRatio = PRESETS.find(p => p.id === aspect)?.ratio ?? null

  // Fit the image inside the crop viewport ("cover"): scale ≥ 1 so there are
  // never empty bars. Used as the base on load, rotate, and aspect change.
  const clampTransform = useCallback((t: Transform): Transform => {
    if (!imgSize) return t
    const { vw, vh } = viewportSize()
    if (!vw || !vh) return t
    // Effective displayed image dimensions at scale 1.
    const rot = ((t.rotation % 360) + 360) % 360
    const swapped = rot === 90 || rot === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const cover = Math.max(vw / iw, vh / ih)
    const minScale = cover > 1 ? cover : 1
    // The displayed image is iw*minScale x ih*minScale (≥ viewport in both axes
    // when cover ≥ 1; when minScale is 1 the image may be smaller than the
    // viewport in one axis — then center it and allow no pan on that axis).
    const dw = iw * minScale * t.scale
    const dh = ih * minScale * t.scale
    const maxX = Math.max((dw - vw) / 2, 0)
    const maxY = Math.max((dh - vh) / 2, 0)
    return {
      ...t,
      scale: Math.min(Math.max(t.scale, MIN_SCALE), MAX_SCALE),
      x: Math.min(Math.max(t.x, -maxX), maxX),
      y: Math.min(Math.max(t.y, -maxY), maxY),
    }
  }, [imgSize, viewportSize])

  // minScale helper shared by zoom slider.
  const minScaleFor = useCallback(() => {
    if (!imgSize) return 1
    const { vw, vh } = viewportSize()
    if (!vw || !vh) return 1
    const rot = ((transform.rotation % 360) + 360) % 360
    const swapped = rot === 90 || rot === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    return Math.max(vw / iw, vh / ih, 1)
  }, [imgSize, transform.rotation, viewportSize])

  useEffect(() => { setZoom(transform.scale) }, [transform.scale])

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

  // Bake the visible crop into a JPEG at up to 1440px on the long edge.
  const exportBlob = async (): Promise<Blob> => {
    if (!imgSize || !srcUrl) throw new Error('image not ready')
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('could not read image')); img.src = srcUrl })

    const { vw, vh } = viewportSize()
    // Crop box in source pixels: the viewport maps to the exported rectangle.
    const outW = vw * 2 // 2x for sharpness, capped later
    const outH = Math.round(outW * (vh / vw))
    const canvas = document.createElement('canvas')
    canvas.width = outW; canvas.height = outH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, outW, outH)

    const rot = ((transform.rotation % 360) + 360) % 360
    const swapped = rot === 90 || rot === 270
    const iw = swapped ? imgSize.h : imgSize.w
    const ih = swapped ? imgSize.w : imgSize.h
    const minScale = Math.max(vw / iw, vh / ih, 1)
    const drawW = iw * minScale * transform.scale
    const drawH = ih * minScale * transform.scale

    ctx.save()
    ctx.translate(outW / 2 + transform.x * 2, outH / 2 + transform.y * 2)
    ctx.rotate((rot * Math.PI) / 180)
    const drawnW = swapped ? drawH : drawW
    const drawnH = swapped ? drawW : drawH
    ctx.drawImage(img, -drawnW / 2, -drawnH / 2, drawnW, drawnH)
    ctx.restore()

    // Cap long edge at 1440px to keep uploads small.
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
    <div className="fixed inset-0 z-[60] bg-[#FFFBF0] text-[#29251F] flex flex-col hf-image-editor" role="dialog" aria-label="Adjust image" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="h-14 shrink-0 flex items-center justify-between px-3 border-b border-[#E8DEC9]">
        <button onClick={onCancel} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-sm text-[#5B5248] px-2 py-2 active:bg-[#F5EEDF]" aria-label="Cancel">✕ Cancel</button>
        <p className="text-sm font-extrabold text-[#29251F]">Adjust</p>
        <button onClick={() => void save()} disabled={rotating || !imgSize} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-sm font-extrabold text-[#7C3AED] px-2 py-2 active:bg-[#F3E8FF] disabled:opacity-50" aria-label="Apply adjustments">{rotating ? '…' : 'Save ✓'}</button>
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden touch-none select-none bg-[#111]"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
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
                  const rot = ((transform.rotation % 360) + 360) % 360
                  const swapped = rot === 90 || rot === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const { vw, vh } = viewportSize()
                  const minScale = Math.max(vw / iw, vh / ih, 1)
                  return iw * minScale * transform.scale
                })(),
                height: (() => {
                  const rot = ((transform.rotation % 360) + 360) % 360
                  const swapped = rot === 90 || rot === 270
                  const iw = swapped ? imgSize.h : imgSize.w
                  const ih = swapped ? imgSize.w : imgSize.h
                  const { vw, vh } = viewportSize()
                  const minScale = Math.max(vw / iw, vh / ih, 1)
                  return ih * minScale * transform.scale
                })(),
                transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
                transition: dragRef.current ? 'none' : 'width 0.15s, height 0.15s',
              }}
            />
          </div>
        )}
        {/* crop frame overlay */}
        <div className="absolute inset-0 pointer-events-none border-2 border-white/80" />
        <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/20" />)}
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
                onClick={() => setAspect(p.id)}
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
