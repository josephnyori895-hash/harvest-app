// One look library for every photo surface — the story composer and the post
// editor must show and bake the same five-second visual decision, so the CSS
// strings live here and nowhere else.

export const FILTERS = ['Original', 'Clarendon', 'Juno', 'Aden', 'Lark', 'Moody', 'Valencia', 'Perpetua', 'Willow', 'Gingham'] as const

// Preview-only approximations of the filters the burn step applies to the
// pixels at submit. The composer must show what the viewer will get.
export const FILTER_CSS: Record<string, string> = {
  Original: 'none',
  Clarendon: 'brightness(1.06) contrast(1.14) saturate(1.18)',
  Juno: 'brightness(1.05) contrast(1.1) saturate(1.3) hue-rotate(-6deg)',
  Aden: 'brightness(1.08) contrast(1.06) saturate(1.2) hue-rotate(4deg)',
  Lark: 'brightness(1.06) contrast(1.04) saturate(1.12) hue-rotate(-8deg)',
  Moody: 'brightness(0.88) contrast(1.12) saturate(1.2) hue-rotate(8deg)',
  Valencia: 'brightness(1.1) contrast(1.05) saturate(1.24) hue-rotate(4deg)',
  Perpetua: 'brightness(1.06) contrast(1.02) saturate(1.26) hue-rotate(-4deg)',
  Willow: 'brightness(0.98) contrast(1.04) saturate(0.9) hue-rotate(10deg)',
  Gingham: 'brightness(1.06) contrast(1.06) saturate(1.1) hue-rotate(-10deg)',
}

/** CSS `filter` value for a look name ('none' for Original). `strength` (0–1)
 *  blends the look toward neutral on every axis, Instagram's intensity slider:
 *  0 = pure original, 1 = full effect. Default 1 preserves existing callers. */
export function lookCss(name: string | null, strength = 1): string {
  const css = FILTER_CSS[name || 'Original'] || FILTER_CSS.Original
  if (css === 'none' || strength >= 1) return css
  if (strength <= 0) return 'none'
  return css.replace(/([a-z-]+)\(([^)]+)\)/g, (_, fn: string, arg: string) => {
    const v = parseFloat(arg)
    if (Number.isNaN(v)) return `${fn}(${arg})`
    const target = fn === 'hue-rotate' ? 0 : 1
    const blended = target + (v - target) * strength
    return `${fn}(${fn === 'hue-rotate' ? `${blended.toFixed(2)}deg` : blended.toFixed(3)})`
  })
}

/** Adds the CSS styling that makes an <img> display `look` live. */
export function applyLookCss(el: HTMLElement | null, look: string | null): void {
  if (!el) return
  el.style.filter = lookCss(look) === 'none' ? '' : lookCss(look)
}

/** Instagram's manual Edit tools share one shape across preview and export. */
export type Adjustments = { brightness: number; contrast: number; saturate: number; warmth: number; fade: number }
export const neutralAdjust: Adjustments = { brightness: 1, contrast: 1, saturate: 1, warmth: 0, fade: 0 }

/** The editor's full filter string: the selected look at `strength`, then the
 *  manual tool stack on top. Only one function may produce it, so the stage
 *  img and the export canvas can never show different pictures. */
export function composeLook(name: string | null, intensity = 1, adjust: Partial<Adjustments> = {}): string {
  const a = { ...neutralAdjust, ...adjust }
  const parts: string[] = []
  const look = lookCss(name, intensity)
  if (look !== 'none') parts.push(look)
  if (a.fade > 0) {
    // Fade washes blacks toward grey: lower contrast, lifted exposure, less colour.
    const f = a.fade
    parts.push(`contrast(${(1 - 0.35 * f).toFixed(3)})`, `brightness(${(1 + 0.12 * f).toFixed(3)})`, `saturate(${(1 - 0.25 * f).toFixed(3)})`)
  }
  if (a.brightness !== 1) parts.push(`brightness(${a.brightness.toFixed(3)})`)
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast.toFixed(3)})`)
  if (a.saturate !== 1) parts.push(`saturate(${a.saturate.toFixed(3)})`)
  if (a.warmth > 0) parts.push(`sepia(${a.warmth.toFixed(3)})`)
  return parts.length ? parts.join(' ') : 'none'
}

type Dice = { brightness: number; contrast: number; saturate: number; hue: number }
const LOOK_DICE: Record<string, Dice> = {
  Clarendon: { brightness: 1.2, contrast: 1.0, saturate: 1.0, hue: 0 },
  Juno: { brightness: 1.15, contrast: 1.0, saturate: 1.0, hue: 0 },
  Aden: { brightness: 1.25, contrast: 1.0, saturate: 1.0, hue: 8 },
  Lark: { brightness: 0.98, contrast: 1.0, saturate: 1.0, hue: -6 },
  Moody: { brightness: 0.7, contrast: 1.0, saturate: 1.0, hue: 10 },
  Valencia: { brightness: 1.3, contrast: 1.0, saturate: 1.0, hue: 0 },
  Perpetua: { brightness: 1.18, contrast: 1.0, saturate: 1.08, hue: 0 },
  Willow: { brightness: 0.9, contrast: 1.0, saturate: 1.0, hue: 0 },
  Gingham: { brightness: 1.12, contrast: 1.0, saturate: 1.08, hue: 0 },
}

/**
 * Bakes `look` into image pixel data — the exact pixel walk the story burn and
 * the post editor export use, so the two surfaces cannot drift apart.
 * Mutates and returns the ImageData for chaining into ctx.putImageData.
 */
export function bakeLook(data: ImageData, look: string): ImageData {
  if (!look || look === 'Original') return data
  const d = data.data
  const dice = LOOK_DICE[look]
  if (!dice) return data
  const { brightness, saturate: s, hue } = dice
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    d[i] = Math.min(255, r * brightness)
    d[i + 1] = Math.min(255, g * (brightness < 1 ? brightness * (s > 1 ? s - 1 + 0.9 : 1) : 0.96 + (s - 1) * 0.96 + 0.04))
    d[i + 2] = Math.min(255, b * (brightness === 1 ? 1 : brightness * 1.1))
    if (hue) {
      const rad = (hue * Math.PI) / 180
      const cos = Math.cos(rad), sin = Math.sin(rad)
      d[i + 1] = Math.min(255, Math.max(0, (0.213 + cos * 0.787 - sin * 0.213) * d[i] + (0.715 - cos * 0.715 - sin * 0.715) * d[i + 1] + (0.072 - cos * 0.085 + sin * 0.285) * d[i + 2]))
    } else if (s !== 1) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      d[i] = Math.min(255, Math.max(0, lum + (d[i] - lum) * s))
      d[i + 1] = Math.min(255, Math.max(0, lum + (d[i + 1] - lum) * s))
      d[i + 2] = Math.min(255, Math.max(0, lum + (d[i + 2] - lum) * s))
    }
  }
  return data
}
