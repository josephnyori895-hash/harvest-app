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
