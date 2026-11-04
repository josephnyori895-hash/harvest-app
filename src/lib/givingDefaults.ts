// One source of truth for the giving purposes and quick amounts. Both the Give
// screen and the admin editor read these, so an admin edit can never be
// overwritten by a stale hardcoded list in either place.

export type GivingFund = { id: string; label: string; sub?: string; icon?: string }

export const DEFAULT_FUNDS: GivingFund[] = [
  { id: 'tithe', label: 'Tithe', sub: 'First fruits', icon: '💰' },
  { id: 'offering', label: 'Offering', sub: 'Thanksgiving', icon: '🙏' },
  { id: 'building', label: 'Building Fund', sub: 'Church development', icon: '🏗️' },
  // id stays 'ministry' so saved payment configs and past transactions keep
  // pointing at the same purpose; only the member-facing name is HYP.
  { id: 'ministry', label: 'HYP', sub: 'Outreach + missions', icon: '🌍' },
]

export const DEFAULT_QUICK = [100, 200, 500, 1000, 2500, 5000]

/** Parse the stored JSON. Anything malformed or empty falls back to the
 *  defaults rather than leaving the giving screen with no purposes at all. */
export function parseFunds(raw?: string | null): GivingFund[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    if (!Array.isArray(parsed)) return DEFAULT_FUNDS
    const funds = parsed
      .filter((f: any) => f && typeof f.id === 'string' && typeof f.label === 'string' && f.label.trim())
      .slice(0, 12)
      .map((f: any) => {
        const label = String(f.label).slice(0, 60)
        // Churches that already saved the old default list still have
        // "Ministry" in site_content. Rename it on read (id unchanged) so the
        // purpose shows as HYP everywhere without a database edit; any other
        // custom label the admin chose is left alone.
        const renamed = f.id === 'ministry' && label.trim().toLowerCase() === 'ministry' ? 'HYP' : label
        return { id: f.id, label: renamed, sub: String(f.sub || '').slice(0, 120), icon: String(f.icon || '').slice(0, 8) }
      })
    return funds.length ? funds : DEFAULT_FUNDS
  } catch {
    return DEFAULT_FUNDS
  }
}

export function parseQuick(raw?: string | null): number[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    if (!Array.isArray(parsed)) return DEFAULT_QUICK
    const amounts = parsed
      .map(Number)
      .filter((n: number) => Number.isInteger(n) && n > 0 && n <= 1_000_000)
      .slice(0, 12)
    return amounts.length ? amounts : DEFAULT_QUICK
  } catch {
    return DEFAULT_QUICK
  }
}

export function slugFundId(label: string, existing: GivingFund[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'purpose'
  let id = base
  let n = 2
  while (existing.some(f => f.id === id)) { id = `${base}_${n}`; n += 1 }
  return id
}
