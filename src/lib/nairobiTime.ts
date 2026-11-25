// Publishing times are chosen in Kenya time (EAT, UTC+03:00, no DST) and
// stored as UTC ISO strings. Browsers may be in another timezone, so never use
// `datetime-local`'s local interpretation for the church calendar.
export const NAIROBI_TZ = 'Africa/Nairobi'

function parts(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAIROBI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => p.find(x => x.type === type)?.value || ''
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') }
}

/** ISO timestamp → `YYYY-MM-DDTHH:mm` for a datetime-local input. */
export function nairobiInput(iso?: string | null): string {
  if (!iso) return ''
  const p = parts(iso)
  return p ? `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}` : ''
}

/** datetime-local value chosen as Nairobi time → UTC ISO. */
export function nairobiIso(value?: string | null): string | null {
  const v = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null
  const withSeconds = v.length === 16 ? `${v}:00` : v
  const d = new Date(`${withSeconds}+03:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function formatNairobi(iso?: string | null, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    ...opts,
  }).format(d)
}

export function nairobiDay(iso?: string | null): string {
  if (!iso) return ''
  const p = parts(iso)
  return p ? `${p.y}-${p.m}-${p.d}` : ''
}

export function nairobiDayLabel(iso?: string | null): string {
  if (!iso) return 'No date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'No date'
  return new Intl.DateTimeFormat('en-KE', { timeZone: NAIROBI_TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
}
