// Guard: no dialog may be written without the shared focus contract.
//
// The app had the same bug twice — a sheet that opened with focus left behind
// on the button that opened it, so Tab walked the feed underneath and Escape
// did nothing. src/lib/useModalFocus.ts now owns that behaviour (focus in, Tab
// trapped, Escape closes only the topmost dialog, focus returned, page scroll
// locked). These assertions are deliberately structural and server-free so they
// run in the normal gate: they cannot prove the browser behaves, but they make
// it impossible to add a dialog that never opted in.
//
// The behavioural sweep (real Chromium: open, Tab both ways, Escape, focus
// return, scroll lock) is scripts/qa-android-notifications.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../src/', import.meta.url)

async function sourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) files.push(...await sourceFiles(url))
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(url)
  }
  return files
}

const files = (await sourceFiles()).map(url => ({ path: fileURLToPath(url), url }))
const sources = new Map()
for (const file of files) sources.set(file.path, await readFile(file.url, 'utf8'))

const rel = path => path.slice(fileURLToPath(SRC).length)
const dialogFiles = [...sources].filter(([, src]) => src.includes('role="dialog"'))

// Opening tags can span lines (the notification drawer's class list does), so a
// tag is matched up to its closing `>`, not up to the end of the line.
// `[^>]` alone truncates a tag at the `>` inside `onClick={e => e.stopPropagation()}`,
// so an arrow is matched as a unit instead of ending the tag early.
const TAGS = /<(div|section|main|aside|article)\b(?:(?:=>)|[^>])*?>/gs

test('every file that renders a dialog opts into the shared focus hook', () => {
  assert.ok(dialogFiles.length >= 6, `expected several dialog surfaces, found ${dialogFiles.length}`)
  for (const [path, src] of dialogFiles) {
    // src/ui/index.tsx is the Dialog primitive: it portals its panel and runs
    // its own trap, because a portal cannot share the page-level hook cleanly.
    if (rel(path) === 'ui/index.tsx') continue
    assert.match(src, /useModalFocus/, `${rel(path)} renders role="dialog" but never calls useModalFocus`)
  }
})

test('the Dialog primitive keeps its own trap rather than losing one', () => {
  const primitive = sources.get([...sources.keys()].find(p => rel(p) === 'ui/index.tsx'))
  assert.ok(primitive, 'src/ui/index.tsx must exist')
  assert.match(primitive, /createPortal/, 'Dialog must portal its panel')
  assert.match(primitive, /e\.key === 'Escape'/, 'Dialog must answer Escape itself')
  assert.match(primitive, /body\.style\.overflow = 'hidden'/, 'Dialog must lock page scroll')
  assert.match(primitive, /previous\?\.focus/, 'Dialog must return focus to its opener')
})

test('the hook owns the full contract', () => {
  const hook = sources.get([...sources.keys()].find(p => rel(p) === 'lib/useModalFocus.ts'))
  assert.ok(hook, 'src/lib/useModalFocus.ts must exist')
  assert.match(hook, /export function useModalFocus/)
  assert.match(hook, /e\.key === 'Escape'/, 'Escape must close the dialog')
  assert.match(hook, /ownsEscape\(\)/, 'only the topmost dialog may answer Escape')
  assert.match(hook, /e\.key !== 'Tab'/, 'Tab must be trapped')
  assert.match(hook, /shiftKey/, 'Shift+Tab must wrap backwards')
  assert.match(hook, /lockScroll\(panel\)/, 'the page behind the dialog must not scroll')
  assert.match(hook, /scrollLockDepth/, 'stacked dialogs must not unlock the page early')
  assert.match(hook, /requestAnimationFrame/, 'focus must be restored after the opener remounts')
})

test('every dialog carries an accessible name and can take focus', () => {
  for (const [path, src] of dialogFiles) {
    for (const match of src.matchAll(TAGS)) {
      const tag = match[0]
      if (!tag.includes('role="dialog"')) continue
      assert.match(tag, /aria-label=|aria-labelledby=/, `${rel(path)} has a dialog with no accessible name`)
      assert.match(tag, /tabIndex=\{-1\}/, `${rel(path)} has a dialog panel that cannot receive focus`)
    }
  }
})

test('the panel handed to the hook is the element carrying role="dialog"', () => {
  for (const [path, src] of dialogFiles) {
    // The hook's own signature mentions a panel ref that no JSX binds.
    if (rel(path) === 'lib/useModalFocus.ts') continue
    for (const call of src.matchAll(/useModalFocus\([^,]+,\s*(\w+)/g)) {
      const ref = call[1]
      assert.match(src, new RegExp(`const ${ref} = useRef`), `${rel(path)}: ${ref} is not a ref`)
      const owned = [...src.matchAll(TAGS)].map(m => m[0]).filter(tag => tag.includes('role="dialog"'))
      const tagged = owned.filter(tag => new RegExp(`ref=\\{${ref}\\}`).test(tag))
      assert.ok(tagged.length > 0, `${rel(path)}: ${ref} is not on the role="dialog" element, so the trap would guard the wrong node`)
    }
  }
})

test('modal dialogs that stack declare aria-modal', () => {
  for (const [path, src] of dialogFiles) {
    for (const match of src.matchAll(TAGS)) {
      const tag = match[0]
      if (!tag.includes('role="dialog"')) continue
      assert.match(tag, /aria-modal="true"/, `${rel(path)} has a dialog that does not declare aria-modal`)
    }
  }
})
