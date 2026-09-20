// Share to WhatsApp — free deep-link sharing (wa.me), no API, no verification.
// Members/admin share announcements, posts, reels and stories straight into
// their church WhatsApp groups. Text is pre-composed so the share looks good.

const BRAND = 'Harvest Family Church · Nyeri 🙏'

function openWa(text: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`
  // On the APK (Capacitor) and mobile browsers, wa.me deep-link opens WhatsApp directly.
  // On desktop we still open it so the user can copy into WhatsApp Web.
  if (/Capacitor|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    window.location.href = url
  } else {
    window.open(url, '_blank', 'noopener')
  }
}

export function shareToWhatsApp(text: string) {
  openWa(`${text}\n\n— ${BRAND}`)
}

export function sharePostToWhatsApp(opts: { author?: string; caption?: string; url?: string }) {
  const bits = [
    opts.author ? `📢 ${opts.author} shared on the Harvest app:` : '📢 From the Harvest app:',
    opts.caption,
    opts.url,
  ].filter(Boolean)
  shareToWhatsApp(bits.join('\n\n'))
  window.dispatchEvent(new CustomEvent('harvest:whatsapp-share', { detail: { author: opts.author, caption: opts.caption } }))
}

export function shareStoryToWhatsApp(opts: { author?: string; caption?: string }) {
  const bits = [
    opts.author ? `🙏 ${opts.author}'s 24h story on the Harvest app:` : '🙏 A 24h story on the Harvest app:',
    opts.caption || 'Tap to catch it before it disappears!',
  ].filter(Boolean)
  shareToWhatsApp(bits.join('\n'))
  window.dispatchEvent(new CustomEvent('harvest:whatsapp-share', { detail: { author: opts.author, caption: opts.caption } }))
}

export function shareAnnouncementToWhatsApp(text: string) {
  shareToWhatsApp(`📣 *ANNOUNCEMENT*\n\n${text}`)
}
