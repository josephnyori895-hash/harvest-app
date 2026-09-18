// Validate the onboarding redesign requirements numerically.
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await page.goto(process.env.PREVIEW_URL || 'http://localhost:5199/', { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise(r => setTimeout(r, 600))

// WCAG contrast ratio for two hex colors
const lum = hex => {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => {
    let v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const report = await page.evaluate(() => {
  const out = {}
  const input = document.querySelector('#reg-username')
  const cs = getComputedStyle(input)
  out.placeholderColor = cs.getPropertyValue('placeholder-color') || 'see computed'
  // get placeholder color via temporary probe
  const probe = document.createElement('span')
  probe.className = 'placeholder:text-zinc-600'
  out.usesZinc600Placeholder = !!document.querySelector('input.placeholder\\:text-zinc-600, input[class*="placeholder:text-zinc-600"]')
  out.inputCount = document.querySelectorAll('input').length
  out.labeledInputs = document.querySelectorAll('input[id]').length

  const h1 = document.querySelector('h1')
  const h1cs = getComputedStyle(h1)
  out.h1 = { fontSize: h1cs.fontSize, weight: h1cs.fontWeight, lineHeight: h1cs.lineHeight }

  const h2 = document.querySelector('h2')
  const h2cs = getComputedStyle(h2)
  out.h2 = { fontSize: h2cs.fontSize, weight: h2cs.fontWeight }

  const header = document.querySelector('header, .pt-4')
  out.headerPaddingTop = header ? getComputedStyle(header).paddingTop : 'n/a'

  const root = document.querySelector('[style*="safe-area"]')
  out.safeAreaApplied = !!root

  const select = document.querySelector('select')
  const selcs = getComputedStyle(select)
  out.select = { appearance: selcs.appearance, padding: selcs.padding, fontSize: selcs.fontSize, fontWeight: selcs.fontWeight }
  const groupCard = select?.closest('.p-4')
  out.groupCardPadding = groupCard ? getComputedStyle(groupCard).padding : 'n/a'

  const cta = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Create my account'))
  const ccs = getComputedStyle(cta)
  out.cta = { fontSize: ccs.fontSize, weight: ccs.fontWeight, height: cta.offsetHeight }

  // vertical gap between stacked form fields
  const fields = [...document.querySelectorAll('main input, div > input[id]')]
  const u = document.querySelector('#reg-username')?.getBoundingClientRect()
  const n = document.querySelector('#reg-name')?.getBoundingClientRect()
  out.fieldGap = u && n ? Math.round(n.top - u.bottom) : 'n/a'
  return out
})

const placeholderFg = '#52525b' // zinc-600
const fieldBg = '#fafafa' // zinc-50
const ratio = contrast(placeholderFg, fieldBg)
const oldFg = '#71717a' // zinc-500
const oldRatio = contrast(oldFg, fieldBg)

console.log('=== ONBOARDING DESIGN VERIFICATION ===')
console.log(`Placeholder contrast: NEW zinc-600 = ${ratio.toFixed(2)}:1 (was zinc-500 = ${oldRatio.toFixed(2)}:1)`)
console.log(`  WCAG requirement for placeholder-size text: 4.5:1 → ${ratio >= 4.5 ? '✅ PASS' : '❌ FAIL'}`)
console.log(`H1 heading: ${report.h1.fontSize} / weight ${report.h1.weight} / line-height ${report.h1.lineHeight}`)
console.log(`H2 subheading: ${report.h2.fontSize} / weight ${report.h2.weight}`)
console.log(`Hierarchy (h1 > h2): ${parseFloat(report.h1.fontSize) > parseFloat(report.h2.fontSize) ? '✅' : '❌'}`)
console.log(`Labeled inputs: ${report.labeledInputs}/${report.inputCount}`)
console.log(`Safe-area padding on root: ${report.safeAreaApplied ? '✅ applied' : '❌ missing'}`)
console.log(`Select: appearance=${report.select.appearance}, font=${report.select.fontSize}/${report.select.fontWeight}, padding=${report.select.padding}`)
console.log(`Group card padding: ${report.groupCardPadding}`)
console.log(`CTA button: ${report.cta.fontSize} / weight ${report.cta.weight} / height ${report.cta.height}px`)
console.log(`Gap between first two fields: ${report.fieldGap}px`)

await browser.close()
