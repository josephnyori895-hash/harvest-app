import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [viewport, main, app, css, chat, comments, stories, adjuster, video, manifest, activity] = await Promise.all([
  read('src/lib/mobileViewport.ts'),
  read('src/main.jsx'),
  read('src/App.jsx'),
  read('src/index.css'),
  read('src/components/Chat.tsx'),
  read('src/components/Comments.tsx'),
  read('src/components/Stories.tsx'),
  read('src/components/ImageAdjuster.tsx'),
  read('src/components/VideoAdjuster.tsx'),
  read('android/app/src/main/AndroidManifest.xml'),
  read('android/app/src/main/java/com/harvestfamily/nyeri/MainActivity.java'),
])

test('the app uses a measured visual viewport instead of raw 100dvh', () => {
  assert.match(main, /installMobileViewport\(\)/)
  assert.match(viewport, /--app-viewport-height/)
  assert.match(viewport, /--keyboard-adjust/)
  assert.match(viewport, /dataset\.keyboard/)
  assert.match(viewport, /visualViewport/)
  assert.match(viewport, /safe-area-change/)
  assert.match(css, /height: var\(--app-viewport-height, 100dvh\)/)
  assert.match(app, /height: 'var\(--app-viewport-height, 100dvh\)'/)
})

test('keyboard-aware chrome keeps composers above the IME', () => {
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/)
  assert.match(activity, /Type\.ime\(\)/)
  assert.match(activity, /composerBottomDp = keyboardVisible \? 0 : bottomDp/)
  assert.match(activity, /--keyboard-inset-bottom/)
  assert.match(css, /html\[data-keyboard="open"\] \.app-fixed-nav \{ display: none; \}/)
  assert.match(comments, /bottom: 'var\(--keyboard-adjust, 0px\)'/)
  assert.match(chat, /window\.visualViewport/)
  assert.match(chat, /chatViewportHeight/)
})

test('full-screen mobile surfaces stay inside system bars', () => {
  assert.match(stories, /paddingTop: 'var\(--safe-area-inset-top/)
  assert.match(adjuster, /paddingTop: 'var\(--safe-area-inset-top/)
  assert.match(video, /paddingTop: 'var\(--safe-area-inset-top/)
  assert.match(css, /padding-left: var\(--safe-area-inset-left/)
  assert.match(css, /padding-right: var\(--safe-area-inset-right/)
})

test('phone layouts are bounded, not stretched', () => {
  assert.match(app, /max-w-\[560px\]/)
  assert.match(app, /xl:max-w-\[620px\]/)
  assert.match(app, /max-w-\[560px\] -translate-x-1\/2/)
  assert.match(css, /\.app-shell \{[^}]*width: 100%;[^}]*min-width: 0;/)
})

test('hardware back closes the topmost overlay before leaving the app', async () => {
  assert.match(app, /harvest:nested-back/)
  assert.match(app, /CapApp\.addListener\('backButton'/)
  const hook = await read('src/lib/useAndroidBack.ts')
  assert.match(hook, /for \(let i = stack\.length - 1; i >= 0; i -= 1\)/, 'the newest overlay wins')
  assert.match(comments, /useAndroidBack\(!inline, onClose\)/)
  assert.match(stories, /useAndroidBack\(true/)
  assert.match(adjuster, /useAndroidBack\(true, onCancel\)/)
  assert.match(video, /useAndroidBack\(true, onCancel\)/)
  assert.match(app, /useAndroidBack\(moreOpen/)
})
