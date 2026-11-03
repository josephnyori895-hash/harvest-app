import { useState } from 'react'
import { Icon } from '../ui'
import { slugFundId, type GivingFund } from '../lib/givingDefaults'

// Admins change what members actually see: the purpose cards (label, sub-text,
// icon) and the quick amounts. No JSON, no pipe syntax, no hidden defaults.
export default function GivingFundsEditor({
  funds,
  quick,
  onChange,
}: {
  funds: GivingFund[]
  quick: number[]
  onChange: (funds: GivingFund[], quick: number[]) => void
}) {
  const [label, setLabel] = useState('')
  const [sub, setSub] = useState('')
  const [icon, setIcon] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState('')

  const patch = (index: number, next: Partial<GivingFund>) =>
    onChange(funds.map((f, i) => (i === index ? { ...f, ...next } : f)), quick)
  const remove = (index: number) => onChange(funds.filter((_, i) => i !== index), quick)

  const addFund = () => {
    const name = label.trim()
    if (!name) { setErr('Give the purpose a name first'); return }
    if (funds.length >= 12) { setErr('Up to 12 giving purposes'); return }
    setErr('')
    onChange([...funds, { id: slugFundId(name, funds), label: name.slice(0, 60), sub: sub.trim().slice(0, 120), icon: icon.trim().slice(0, 8) }], quick)
    setLabel(''); setSub(''); setIcon('')
  }

  const addAmount = () => {
    const value = Number(amount)
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) { setErr('Quick amounts are whole shillings between 1 and 1,000,000'); return }
    if (quick.includes(value)) { setErr('That amount is already there'); return }
    if (quick.length >= 12) { setErr('Up to 12 quick amounts'); return }
    setErr('')
    onChange(funds, [...quick, value].sort((a, b) => a - b))
    setAmount('')
  }

  return (
    <div className="space-y-4" data-testid="giving-funds-editor">
      <div>
        <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-ink-muted">Giving purposes</p>
        <p className="mt-0.5 text-[10px] text-ink-muted">Each purpose becomes a card on the Give screen. The icon is optional.</p>
        <div className="mt-2 space-y-2">
          {funds.map((f, i) => (
            <div key={`${f.id}_${i}`} className="rounded-2xl border border-line bg-surface p-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={f.icon || ''}
                  onChange={e => patch(i, { icon: e.target.value.slice(0, 8) })}
                  aria-label={`${f.label} icon`}
                  placeholder="🙏"
                  className="h-10 w-12 shrink-0 rounded-xl border border-line bg-surface-raised text-center text-lg outline-none focus:border-accent"
                />
                <input
                  value={f.label}
                  onChange={e => patch(i, { label: e.target.value.slice(0, 60) })}
                  aria-label={`${f.label} name`}
                  className="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-raised px-3 text-sm font-bold outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={funds.length <= 1}
                  aria-label={`Remove ${f.label}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface-raised text-danger transition disabled:opacity-30"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <input
                value={f.sub || ''}
                onChange={e => patch(i, { sub: e.target.value.slice(0, 120) })}
                aria-label={`${f.label} sub-text`}
                placeholder="One short line under the name"
                className="mt-2 min-h-9 w-full rounded-xl border border-line bg-surface-raised px-3 text-xs outline-none focus:border-accent"
              />
              <p className="mt-1 px-1 text-[10px] text-ink-subtle">id: {f.id}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-line p-2.5">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-muted">Add a purpose</p>
        <div className="mt-2 flex gap-2">
          <input value={icon} onChange={e => setIcon(e.target.value.slice(0, 8))} placeholder="🙏" aria-label="New purpose icon" className="h-10 w-12 shrink-0 rounded-xl border border-line bg-surface-raised text-center text-lg outline-none focus:border-accent" />
          <input value={label} onChange={e => setLabel(e.target.value.slice(0, 60))} placeholder="Name (e.g. Missions)" aria-label="New purpose name" className="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-raised px-3 text-sm outline-none focus:border-accent" />
        </div>
        <input value={sub} onChange={e => setSub(e.target.value.slice(0, 120))} placeholder="Sub-text (optional)" aria-label="New purpose sub-text" className="mt-2 min-h-9 w-full rounded-xl border border-line bg-surface-raised px-3 text-xs outline-none focus:border-accent" />
        <button type="button" onClick={addFund} className="mt-2 min-h-10 w-full rounded-full bg-accent text-2xs font-extrabold text-white">Add purpose</button>
      </div>

      <div>
        <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-ink-muted">Quick amounts · KES</p>
        <p className="mt-0.5 text-[10px] text-ink-muted">The chips members tap above the amount field.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quick.map(v => (
            <span key={v} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-extrabold text-ink">
              {v.toLocaleString()}
              <button type="button" onClick={() => onChange(funds, quick.filter(x => x !== v))} disabled={quick.length <= 1} aria-label={`Remove ${v} shillings`} className="text-ink-subtle transition hover:text-danger disabled:opacity-30">
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="Add amount" aria-label="New quick amount" className="min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-raised px-3 text-sm outline-none focus:border-accent" />
          <button type="button" onClick={addAmount} className="shrink-0 rounded-full bg-surface-sunken px-4 text-2xs font-extrabold text-ink">Add</button>
        </div>
      </div>

      {err && <p className="text-2xs font-bold text-danger">{err}</p>}
    </div>
  )
}
