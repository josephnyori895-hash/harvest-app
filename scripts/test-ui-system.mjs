// Guard: the design system must stay the only source of visual decisions.
// These are structural assertions, deliberately cheap, so a regression in the
// token layer or an emoji creeping back into UI code fails CI rather than code
// review.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const tailwind = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
const ui = await readFile(new URL('../src/ui/index.tsx', import.meta.url), 'utf8')

test('tokens exist for every semantic role, in both schemes', () => {
  for (const token of ['--surface', '--surface-raised', '--surface-sunken', '--ink', '--ink-muted', '--line', '--accent', '--gold', '--success', '--danger']) {
    assert.match(css, new RegExp(`${token}:`), `${token} must be declared`)
  }
  assert.match(css, /\.dark\s*\{/, 'dark scheme must be a variable swap')
  assert.match(css, /--surface:\s*24 22 20/, 'dark surface override missing')
})

test('tailwind maps semantic names to the variables, not to hex', () => {
  assert.match(tailwind, /surface:\s*\{\s*\n\s*DEFAULT:\s*"rgb\(var\(--surface\)/)
  assert.match(tailwind, /ink:\s*\{\s*\n\s*DEFAULT:\s*"rgb\(var\(--ink\)/)
  assert.match(tailwind, /accent:\s*\{\s*\n\s*DEFAULT:\s*"rgb\(var\(--accent\)/)
  assert.match(tailwind, /darkMode:\s*"class"/)
  assert.match(tailwind, /fontFamily:\s*\{\s*\n\s*sans:\s*\["Outfit"/)
})

test('type floor is 12px and no smaller step exists', () => {
  assert.match(tailwind, /"2xs":\s*\["0\.75rem"/, '2xs must be 12px')
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(m => Number(m[1]))
  for (const px of sizes) assert.ok(px >= 12, `index.css declares ${px}px text — below the 12px floor`)
})

test('design system exports every primitive screens need', () => {
  for (const name of ['Icon', 'Spinner', 'Button', 'Card', 'Badge', 'Field', 'Input', 'Select', 'Textarea', 'Dialog', 'EmptyState', 'Skeleton']) {
    assert.match(ui, new RegExp(`export (function|const) ${name}\\b`), `${name} must be exported`)
  }
})

test('icon set covers the navigation and domain glyphs emoji used to fake', () => {
  const names = [...ui.matchAll(/^\s{2}'?([a-z-]+)'?:/gm)].map(m => m[1])
  const unique = new Set(names)
  for (const required of ['home', 'search', 'reels', 'plus', 'gift', 'chat', 'user', 'bell', 'heart', 'retry', 'close', 'check']) {
    assert.ok(unique.has(required), `missing icon: ${required}`)
  }
  assert.ok(unique.size >= 24, `icon set too small (${unique.size}) — emoji would creep back in`)
})

test('the system module carries no hardcoded palette', () => {
  const hexes = ui.match(/#[0-9A-Fa-f]{3,8}/g) || []
  assert.equal(hexes.length, 0, `ui/index.tsx must not define colours: ${hexes.join(', ')}`)
})

test('dialog is accessible by construction', () => {
  assert.match(ui, /role="dialog"/)
  assert.match(ui, /aria-modal="true"/)
  assert.match(ui, /e\.key === 'Escape'/)
  assert.match(ui, /role="status" aria-live="polite"/)
})
