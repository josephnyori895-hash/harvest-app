// Landing and auth are the first two screens every member sees, and the WebView
// has already broken both scroll and back navigation once. These source-contract
// tests keep the wiring explicit: every feature card must lead to a real choice
// sheet, auth must return to the landing page, errors must stay human, and the
// global CSS must never reintroduce the Android scroll lock.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [app, css, errors, reels, youth, backdrop] = await Promise.all([
  read('src/App.jsx'),
  read('src/index.css'),
  read('src/components/ErrorMessage.tsx'),
  read('src/components/Reels.tsx'),
  read('src/components/YouthChurchAnimation.tsx'),
  read('src/components/LandingBackdrop.tsx'),
])

test('landing feature cards and congregation chips open the auth choice sheet', () => {
  assert.match(app, /setLandingPrompt\(\{ title: item\.title, copy: item\.prompt \}\)/)
  assert.match(app, /setLandingPrompt\(\{ title: g, copy:/, 'congregation chips must also lead somewhere')
  assert.match(app, /role="dialog"/, 'the auth prompt must be a real dialog')
  assert.match(app, /Create my account/, 'the prompt must offer sign-up')
  assert.match(app, /I already have an account/, 'the prompt must offer sign-in')
  assert.match(app, /onClick=\{\(\) => setLandingPrompt\(null\)\}/, 'the prompt must be dismissible')
})

test('auth can return to the landing page and always opens at the top', () => {
  assert.match(app, /aria-label="Back to welcome page"/)
  assert.match(app, /<Icon name="arrow-left"/, 'the back control must use the real back icon')
  assert.match(app, /onClick=\{\(\) => enter\('landing'\)\}/)
  assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0 \}\)/, 'entering auth must reset the inherited landing scroll')
})

test('auth errors are human, distinct and attached to the right field', () => {
  assert.match(errors, /network: \{ title: 'No connection'/)
  assert.match(errors, /credentials: \{ title: 'Check your details'/)
  assert.match(errors, /server: \{ title: 'Please try again'/)
  assert.match(errors, /aria-live="polite"/, 'errors must be announced without stealing focus')
  assert.match(app, /function AuthFieldError/, 'field errors need one consistent component')
  assert.match(app, /aria-invalid=\{!!fieldErrors\./, 'invalid fields must be marked for assistive tech')
  assert.match(app, /aria-invalid=\{errorKind === 'credentials'\}/, 'wrong sign-in details must mark both login fields')
  assert.match(app, /Nothing you typed has been lost/, 'offline copy must reassure the member')
  assert.match(app, /We couldn’t create your account\. Check the details and try again\./, 'unknown signup failures need a calm fallback')
})

test('auth carries the dark landing atmosphere into sign-in and sign-up', () => {
  assert.match(app, /auth-screen relative isolate/, 'auth must use the dark screen shell')
  assert.match(backdrop, /auth-underlay/, 'auth must carry the photographic background')
  assert.match(app, /<LandingBackdrop variant="auth"/, 'auth must render the shared backdrop')
  assert.match(app, /bg-gradient-to-br from-\[#3a2f86\] via-\[#221a56\] to-\[#151036\]/, 'auth hero must use the logo navy gradient')
  assert.match(app, /text-\[11px\] font-extrabold tracking-\[0\.22em\] text-gold/, 'the shared tagline must stay gold on purple')
  assert.match(css, /\.auth-screen \.hf-error-message/, 'error tones must be readable on dark auth')
})

test('landing motion is visible but respects reduced motion', () => {
  assert.match(app, /landingHero = siteArt\.landing_hero_url \|\| '\/landing\/hero\.jpg'/, 'the landing needs a real photographic background, with the shipped photo as its fallback')
  assert.match(css, /@keyframes landingPhotoDrift/, 'the photo must have its own slow Ken Burns motion')
  assert.match(css, /\.landing-page-underlay/, 'the landing must not fall back to flat black')
  assert.match(app, /<LandingBackdrop variant="landing" urls=\{siteArt\.landing_background_url\} \/>/, 'the page backdrop needs its own admin-managed photos')
  assert.match(app, /<LandingBackdrop variant="auth" urls=\{siteArt\.landing_background_url\} \/>/, 'auth shares the same rotating backdrop')
  assert.doesNotMatch(app, /landing-page-underlay[\s\S]{0,80}landingHero/, 'the hero photo must not fill the page background')
  assert.match(css, /@keyframes landingPageDrift/, 'the separate backdrop may drift on its own')
  assert.match(css, /\.landing-bg-layer \{[\s\S]{0,400}opacity: 0/, 'backdrop photos must start hidden for a cross-fade')
  assert.match(css, /\.landing-page-underlay \.landing-bg-layer\.is-active \{ opacity: \.52; \}/, 'the active landing photo needs its half-strength opacity')
  assert.match(css, /\.auth-underlay \.landing-bg-layer\.is-active \{ opacity: \.45; \}/, 'auth shares the backdrop but stays calmer')
  assert.match(app, /<YouthChurchAnimation \/>/, 'the youth film must sit on the landing page, not inside the hero')
  assert.match(youth, /\/landing\/01\.jpg/, 'the film must use actual people, not icons')
  assert.match(youth, /HARVEST FAMILY CHURCH/, 'the film must reveal the church name')
  assert.match(css, /\.youth-film \{[\s\S]{0,120}position: fixed/, 'the film must be a full-page fixed background')
  for (const layer of ['landing-sky', 'landing-aurora', 'landing-beams', 'landing-arches', 'landing-dust', 'landing-grain']) {
    assert.match(app, new RegExp(`"${layer}"`), `${layer} layer is missing`)
  }
  assert.match(css, /@keyframes landingRise/, 'hero entrance is missing')
  assert.match(css, /\.landing-cta::after/, 'CTA sheen is missing')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*landing-rise/, 'reduced motion must freeze the entrance')
  assert.doesNotMatch(css, /filter:\s*blur\(42px\)/, 'the old animated full-screen blur must not return')
})

test('several backdrop photos rotate on their own, one at a time', () => {
  assert.match(backdrop, /const ROTATE_MS = 7000/, 'the rotation needs a slow, calm interval')
  assert.match(backdrop, /const SLOT_COUNT = 8/, 'the office can add photos beside the first one')
  assert.match(backdrop, /`\/landing\/background\$\{String\(i \+ 1\)\.padStart\(2, '0'\)\}\.jpg`/, 'numbered slots must be discovered without a code change')
  assert.match(backdrop, /urls\.split\(\/\[,\\n\]\/\).*filter\(Boolean\)/, 'the admin can paste a comma-separated list of photos')
  assert.match(backdrop, /const probe = new Image\(\)/, 'missing photos must be skipped, not shown as broken')
  assert.match(backdrop, /setIndex\(i => \(i \+ 1\) % loaded\.length\)/, 'the backdrop must advance to the next photo')
  assert.match(backdrop, /className=\{`landing-bg-layer\$\{i === active \? ' is-active' : ''\}`\}/, 'exactly one photo is active at a time')
  assert.match(backdrop, /prefers-reduced-motion: reduce[\s\S]*loaded\.length < 2/, 'reduced motion must stop the rotation')
  assert.match(css, /transition: opacity 1600ms ease-in-out/, 'photos must cross-fade instead of cutting')
})

test('the landing page offers the current Android build for download', () => {
  assert.match(app, /href=\{`\$\{API\}\/harvest-family\.apk`\}/, 'the download button must use the stable public APK URL')
  assert.match(app, /Download the app/, 'the download button must be labelled')
  assert.match(app, /name="download"/, 'the download button needs the download icon')
})

test('the Android scroll lock is not reintroduced globally', () => {
  assert.doesNotMatch(css, /^\s*overscroll-behavior:\s*none;?\s*$/m, 'global overscroll-behavior:none blocks WebView scrolling')
  assert.match(css, /overscroll-behavior-x: none/, 'only horizontal rubber-banding should stay locked')
})

test('a failed reel renders a deliberate dark state, not a blank cream page', () => {
  assert.match(reels, /This video couldn’t play/)
  assert.match(reels, /bg-\[#140f1d\]/, 'the video error surface must stay dark')
  assert.match(reels, /Check your connection, then try again/, 'the error must explain recovery')
})
