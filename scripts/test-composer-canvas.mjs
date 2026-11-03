// The composer is one canvas: IG-style edit screen (zoom-to-fill, filters, crop
// presets) and a stage that shows the exact geometry the feed will render.
// Cheap structural guards that fail CI before the member ever sees bars again.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const post = await readFile(new URL('../src/components/PostCreate.tsx', import.meta.url), 'utf8')
const adjuster = await readFile(new URL('../src/components/ImageAdjuster.tsx', import.meta.url), 'utf8')
const stories = await readFile(new URL('../src/components/Stories.tsx', import.meta.url), 'utf8')
const filtersLib = await readFile(new URL('../src/lib/imageFilters.ts', import.meta.url), 'utf8')

test('no letterbox anywhere in the composer stage', () => {
  // The media review canvas (the "Selected media preview" stage) must be
  // zoom-to-fill. The sermon audio stage's small inline video control is not
  // the review canvas and may contain.
  assert.ok(!/Selected media preview"\n?\s*className="[^"]*object-contain/.test(post), 'the review stage must not letterbox media')
  assert.match(post, /clampStageRatio/)
  assert.match(post, /imgRatio/)
})

test('the edit screen is zoom-to-fill and IG-shaped', () => {
  // Image covers its crop frame always — the fill side of min-scale.
  assert.match(adjuster, /Math\.max\(vw \/ iw, vh \/ ih\)/)
  assert.match(adjuster, /Math\.max\(outW \/ iw, outH \/ ih\)/)
  // Filters · Edit tabs like Instagram's bottom drawer.
  assert.match(adjuster, />Filters</)
  assert.match(adjuster, />Edit</)
  // Aspect chips + crop frame + rotate keep their test ids for the e2e flow.
  for (const id of ['image-adjuster-save', 'image-adjuster-rotate', 'image-adjuster-crop-frame']) {
    assert.match(adjuster, new RegExp(`data-testid="${id}"`))
  }
  assert.match(adjuster, /data-testid=\{`image-adjuster-aspect-\$\{p\.id\}`\}/)
})

test('filters are one shared look library, not duplicated definitions', () => {
  assert.match(filtersLib, /export const FILTERS/)
  assert.match(filtersLib, /export const FILTER_CSS/)
  assert.match(filtersLib, /export function lookCss/)
  // Stories imports the shared module instead of declaring its own copy.
  assert.match(stories, /from '\.\.\/lib\/imageFilters'/)
  assert.doesNotMatch(stories, /const FILTERS = \[/, 'story composer must not fork the look list')
})

test('export bakes the selected look into the pixels', () => {
  assert.match(adjuster, /'filter' in ctx/)
  assert.match(adjuster, /ctx\.filter = lookFilter/, 'export must use the blended look, same expression the preview shows')
})

test('the editor shows the filter preview live on the stage image', () => {
  assert.match(adjuster, /filter: lookCss\(look, intensity\) === 'none' \? undefined : lookCss\(look, intensity\)/)
})

test('Instagram-grade filter intensity: preview, export and the slider share one value', () => {
  assert.match(filtersLib, /export function lookCss\(name: string \| null, strength = 1\)/, 'the look library blends toward neutral by strength')
  assert.match(adjuster, /const \[intensity, setIntensity\] = useState\(1\)/)
  assert.match(adjuster, /const lookFilter = lookCss\(look, intensity\)/)
  assert.match(adjuster, /data-testid="image-adjuster-intensity"/)
  assert.match(adjuster, /lookFilter = lookCss\(look, intensity\)/, 'intensity must survive into the export')
})
