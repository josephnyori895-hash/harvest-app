// Codemod: map the product's ad-hoc palette onto the semantic token layer.
//
// Only hex values that are known brand/semantic colours are rewritten, and only
// to token names that actually exist in tailwind.config.js. Anything unmapped is
// reported rather than guessed at, so nothing silently loses its styling.
import { readFile, writeFile, readdir } from 'node:fs/promises'

const MAP = {
  'FFFBF0': 'surface', 'FFFFFF': 'surface-raised', 'F8F1E3': 'surface-sunken',
  'F4E8D0': 'surface-sunken', 'F5F1E8': 'surface-sunken',
  '29251F': 'ink', '141210': 'ink', '4B433A': 'ink-muted', '5B5146': 'ink-muted',
  '6B6257': 'ink-muted', '766E63': 'ink-muted', '8B8175': 'ink-subtle', '9C948A': 'ink-subtle',
  'E8DEC9': 'line', 'F1E9DA': 'line', 'D9CDB4': 'line-strong',
  '7C3AED': 'accent', '6D28D9': 'accent-strong', '5B21B6': 'accent-strong',
  '4C1D95': 'accent-strong', 'EDE9FE': 'accent-soft', 'DDD6FE': 'accent-soft',
  'F3E8FF': 'accent-soft', 'F5F0FF': 'accent-wash',
  'F59E0B': 'gold', 'FFCD00': 'gold', 'FDE68A': 'gold',
  'B45309': 'gold-strong', '92400E': 'gold-strong', '78350F': 'gold-strong',
  'FFFBEB': 'gold-soft', 'FEF3C7': 'gold-soft',
  'ECFDF5': 'success-soft', '065F46': 'success', 'A7F3D0': 'success',
  'FEF2F2': 'danger-soft', '991B1B': 'danger', 'FECACA': 'danger', 'B91C1C': 'danger',
}

const PREFIX = 'bg|text|border(?:-[trblxy])?|from|via|to|ring|divide|placeholder|decoration|fill|stroke|outline'
const UTIL = new RegExp(`\\b(${PREFIX})-\\[#([0-9A-Fa-f]{6})\\]`, 'g')
const ANY_HEX = /(?:bg|text|border(?:-[trblxy])?|from|via|to|ring|divide|placeholder|decoration|fill|stroke|outline)-\[#[0-9A-Fa-f]{3,8}\]/g

const root = new URL('../src/', import.meta.url)
const apply = process.argv.includes('--apply')

const walk = async dir => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) out.push(...(await walk(child)))
    else if (/\.(jsx|tsx)$/.test(entry.name)) out.push(child)
  }
  return out
}

let files = 0, replaced = 0
const unmapped = new Map()
for (const file of await walk(root)) {
  const before = await readFile(file, 'utf8')
  const after = before.replace(UTIL, (match, prefix, hex) => {
    const token = MAP[hex.toUpperCase()]
    if (!token) return match
    replaced++
    return `${prefix}-${token}`
  })
  for (const hit of before.match(ANY_HEX) || []) {
    const hex = hit.match(/#([0-9A-Fa-f]{6})/)?.[1]?.toUpperCase()
    if (hex && !MAP[hex]) unmapped.set(hit, (unmapped.get(hit) || 0) + 1)
  }
  if (after !== before) {
    files++
    if (apply) await writeFile(file, after)
  }
}

const totalLeft = []
if (apply) {
  for (const file of await walk(root)) totalLeft.push(...((await readFile(file, 'utf8')).match(ANY_HEX) || []))
}

console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${replaced} utilities rewritten across ${files} files`)
if (apply) console.log(`remaining hex utilities in src: ${totalLeft.length}`)
console.log(`unmapped hex utilities (left untouched): ${[...unmapped.values()].reduce((a, b) => a + b, 0)}`)
for (const [hit, n] of [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n.toString().padStart(3)} × ${hit}`)
