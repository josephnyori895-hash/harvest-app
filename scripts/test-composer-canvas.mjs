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

test("create follows Instagram's pick → edit → share sequence", () => {
  // Media kinds take a separate share screen (thumbnail + caption + music);
  // the header offers Next on the pick step and back-to-media on share.
  assert.match(post, /isMediaKind && share/)
  assert.match(post, /data-testid="create-share-step"/)
  assert.match(post, /data-testid="create-next"/)
  assert.match(post, /data-testid="share-caption"/)
  // Editing done (photo or cover) advances straight to the share step.
  assert.match(post, /const applyAdjust = \(blob: Blob, preview: string\) => \{[\s\S]*?setShare\(true\)/)
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
  assert.match(adjuster, /filter: previewFilter === 'none' \? undefined : previewFilter/)
})

test('manual adjustments share one composeLook between the stage and the export', () => {
  assert.match(filtersLib, /export function composeLook\(name: string \| null, intensity = 1, adjust: Partial<Adjustments> = \{\}\)/)
  assert.match(filtersLib, /export const neutralAdjust/)
  assert.match(adjuster, /data-testid=\{`image-adjuster-\$\{tool\.key\}`\}/, 'every edit tool renders a slider from the shared ADJUST_TOOLS list')
  for (const tool of ['brightness', 'contrast', 'saturate', 'warmth', 'fade']) {
    assert.match(adjuster, new RegExp(`key: '${tool}'`), `the ${tool} tool must be offered`)
  }
  const previewUse = adjuster.match(/const previewFilter = composeLook\(look, intensity, adjust\)/)
  const exportUse = adjuster.match(/const lookFilter = composeLook\(look, intensity, adjust\)/)
  assert.ok(previewUse && exportUse, 'preview and export must both read the same composeLook with the same adjust state')
})

test('Instagram-grade filter intensity: preview, export and the slider share one value', () => {
  assert.match(filtersLib, /export function lookCss\(name: string \| null, strength = 1\)/, 'the look library blends toward neutral by strength')
  assert.match(adjuster, /const \[intensity, setIntensity\] = useState\(1\)/)
  assert.match(adjuster, /data-testid="image-adjuster-intensity"/)
  assert.match(adjuster, /const lookFilter = composeLook\(look, intensity, adjust\)/, 'intensity must survive into the export')
})
