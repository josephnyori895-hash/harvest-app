import type { GivingFund } from '../lib/givingDefaults'

// Where a purpose's money actually goes. Stored as JSON in the
// `giving_payment_methods` content key, keyed by purpose id, because that is
// what the Give screen and the giving worker already read. This editor is the
// human way in: an admin picks the method and types the number, and never has
// to write JSON.
export type PurposePayment = {
  method?: string
  enabled?: boolean
  payment_number?: string
  account_reference?: string
  bank_name?: string
  bank_account_name?: string
  bank_account_number?: string
  instructions?: string
}

export const PAYMENT_METHODS = [
  { value: 'stk', label: 'Online M-Pesa prompt (STK push)' },
  { value: 'paybill', label: 'M-Pesa Paybill' },
  { value: 'till', label: 'M-Pesa Till (Buy Goods)' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'manual', label: 'Instructions only' },
]

export function parsePayments(raw?: string | null): Record<string, PurposePayment> {
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** One short line an admin can scan without opening the editor. */
export function describePayment(cfg?: PurposePayment): string {
  const method = String(cfg?.method || 'stk')
  if (method === 'till') return cfg?.payment_number ? `Till ${cfg.payment_number}` : 'Till number missing'
  if (method === 'paybill') return cfg?.payment_number ? `Paybill ${cfg.payment_number}` : 'Paybill number missing'
  if (method === 'bank') return cfg?.bank_name ? `Bank · ${cfg.bank_name}` : 'Bank details missing'
  if (method === 'manual') return 'Instructions only'
  return 'Online M-Pesa prompt'
}

/** The server refuses an incomplete destination, so the save button checks
 *  first and names the purpose instead of failing with a JSON error. */
export function paymentProblem(funds: GivingFund[], payments: Record<string, PurposePayment>): string {
  for (const [id, cfg] of Object.entries(payments)) {
    const label = funds.find(f => f.id === id)?.label || id
    const method = String(cfg?.method || 'stk')
    if ((method === 'paybill' || method === 'till') && !String(cfg?.payment_number || '').trim()) {
      return `${label}: enter the ${method === 'till' ? 'till' : 'paybill'} number before saving.`
    }
    if (method === 'bank' && (!String(cfg.bank_name || '').trim() || !String(cfg.bank_account_name || '').trim() || !String(cfg.bank_account_number || '').trim())) {
      return `${label}: enter the bank name, account name and account number before saving.`
    }
  }
  return ''
}

export default function GivingPaymentEditor({
  funds,
  configs,
  onChange,
}: {
  funds: GivingFund[]
  configs: Record<string, PurposePayment>
  onChange: (next: Record<string, PurposePayment>) => void
}) {
  const set = (id: string, patch: Partial<PurposePayment>) =>
    onChange({ ...configs, [id]: { method: 'stk', enabled: true, ...(configs[id] || {}), ...patch } })

  return (
    <div className="space-y-2" data-testid="giving-payment-editor">
      {funds.map(fund => {
        const cfg = configs[fund.id] || { method: 'stk', enabled: true }
        const method = ['stk', 'paybill', 'till', 'bank', 'manual'].includes(String(cfg.method)) ? String(cfg.method) : 'stk'
        const off = cfg.enabled === false
        return (
          <details key={fund.id} className="rounded-2xl border border-line bg-surface p-3">
            <summary className="cursor-pointer text-sm font-bold">
              <span className="truncate">{fund.icon ? `${fund.icon} ` : ''}{fund.label}</span>
              <span className={`ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-extrabold ${off ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-strong'}`}>
                {off ? 'Switched off' : describePayment(cfg)}
              </span>
            </summary>

            <div className="mt-3 space-y-2">
              <label htmlFor={`pay-${fund.id}-method`} className="label-caps block">How members give to {fund.label}</label>
              <select
                id={`pay-${fund.id}-method`}
                value={method}
                onChange={e => set(fund.id, { method: e.target.value })}
                className="input-base"
              >
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>

              {(method === 'paybill' || method === 'till') && (
                <div>
                  <label htmlFor={`pay-${fund.id}-number`} className="label-caps mb-1 block">
                    {method === 'till' ? 'Till number (Buy Goods)' : 'Paybill number'}
                  </label>
                  <input
                    id={`pay-${fund.id}-number`}
                    inputMode="numeric"
                    value={cfg.payment_number || ''}
                    onChange={e => set(fund.id, { payment_number: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) })}
                    placeholder={method === 'till' ? 'e.g. 4505860' : 'e.g. 4138895'}
                    className="input-base"
                  />
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted">
                    This is the number members will see and key into M-Pesa. It is required before the change can be saved.
                  </p>
                </div>
              )}

              {method === 'paybill' && (
                <div>
                  <label htmlFor={`pay-${fund.id}-account`} className="label-caps mb-1 block">Account reference</label>
                  <input
                    id={`pay-${fund.id}-account`}
                    value={cfg.account_reference || ''}
                    onChange={e => set(fund.id, { account_reference: e.target.value.slice(0, 40) })}
                    placeholder={fund.label}
                    className="input-base"
                  />
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted">What the member types as the account. Leave empty to use “{fund.label}”.</p>
                </div>
              )}

              {method === 'bank' && (
                <div className="space-y-2">
                  <div>
                    <label htmlFor={`pay-${fund.id}-bank`} className="label-caps mb-1 block">Bank name</label>
                    <input id={`pay-${fund.id}-bank`} value={cfg.bank_name || ''} onChange={e => set(fund.id, { bank_name: e.target.value.slice(0, 120) })} placeholder="e.g. Equity Bank" className="input-base" />
                  </div>
                  <div>
                    <label htmlFor={`pay-${fund.id}-bank-name`} className="label-caps mb-1 block">Account name</label>
                    <input id={`pay-${fund.id}-bank-name`} value={cfg.bank_account_name || ''} onChange={e => set(fund.id, { bank_account_name: e.target.value.slice(0, 120) })} placeholder="e.g. Harvest Family Church" className="input-base" />
                  </div>
                  <div>
                    <label htmlFor={`pay-${fund.id}-bank-number`} className="label-caps mb-1 block">Account number</label>
                    <input id={`pay-${fund.id}-bank-number`} value={cfg.bank_account_number || ''} onChange={e => set(fund.id, { bank_account_number: e.target.value.slice(0, 64) })} placeholder="Church account number" className="input-base" />
                  </div>
                  <div>
                    <label htmlFor={`pay-${fund.id}-bank-ref`} className="label-caps mb-1 block">Transfer reference (optional)</label>
                    <input id={`pay-${fund.id}-bank-ref`} value={cfg.account_reference || ''} onChange={e => set(fund.id, { account_reference: e.target.value.slice(0, 40) })} placeholder={fund.label} className="input-base" />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor={`pay-${fund.id}-instructions`} className="label-caps mb-1 block">Instructions shown to members (optional)</label>
                <textarea
                  id={`pay-${fund.id}-instructions`}
                  value={cfg.instructions || ''}
                  onChange={e => set(fund.id, { instructions: e.target.value.slice(0, 1000) })}
                  rows={3}
                  placeholder="Steps the member follows after choosing this purpose"
                  className="input-base"
                />
              </div>

              <label className="flex min-h-10 items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={cfg.enabled !== false} onChange={e => set(fund.id, { enabled: e.target.checked })} />
                Members can give to this purpose
              </label>
            </div>
          </details>
        )
      })}
      <p className="text-[10px] leading-4 text-ink-muted">
        Open a purpose to set its number. “Online M-Pesa prompt” uses the server’s Daraja keys and needs no number here.
      </p>
    </div>
  )
}
