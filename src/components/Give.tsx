import { useEffect, useMemo, useState } from 'react'
import { fetchGivingAdmin, fetchMyGiving, startGiving, useApi } from '../lib/api'
import { showToast } from './Toast'

const FUNDS = [
  { id:'tithe', label:'Tithe', sub:'First fruits', icon:'💰' },
  { id:'offering', label:'Offering', sub:'Thanksgiving', icon:'🙏' },
  { id:'building', label:'Building Fund', sub:'Church development', icon:'🏗️' },
  { id:'ministry', label:'Ministry', sub:'Outreach + missions', icon:'🌍' },
]
const QUICK = [100, 200, 500, 1000, 2500, 5000]

export default function Give() {
  const [fund, setFund] = useState('tithe')
  const [amount, setAmount] = useState<number | ''>(500)
  const [phone, setPhone] = useState('')
  const [transactions, setTransactions] = useState<any[]>([])
  const [adminData, setAdminData] = useState<{transactions:any[],totals:any} | null>(null)
  const [tab, setTab] = useState<'give'|'admin'>('give')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const apiEnabled = useApi()
  const currentRole = (() => { try { return localStorage.getItem('harvest_role') } catch { return 'member' } })()
  const isAdmin = currentRole === 'admin'

  const purpose = useMemo(() => FUNDS.find(f => f.id === fund)?.label || 'General Giving', [fund])

  useEffect(() => {
    if (!apiEnabled) return
    fetchMyGiving().then(setTransactions).catch(() => {})
    if (isAdmin) fetchGivingAdmin().then(setAdminData).catch(() => {})
  }, [apiEnabled, isAdmin])

  const pay = async () => {
    if (!apiEnabled) { showToast('Giving requires the server API in production', 'error'); return }
    if (!amount || Number(amount) < 1 || !phone.trim()) { showToast('Enter a valid amount and M-Pesa phone', 'error'); return }
    setBusy(true); setMessage('')
    try {
      const result = await startGiving({ amount:Number(amount), phone:phone.trim(), purpose })
      setMessage(result.message || 'Check your phone to complete the M-Pesa prompt.')
      showToast('M-Pesa prompt sent', 'success')
      const latest = await fetchMyGiving()
      setTransactions(latest)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Giving request failed', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-[#FFFBF0] text-[#29251F] min-h-[70vh] p-4">
      {isAdmin && <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('give')} className={`px-4 py-2 rounded-full text-xs font-bold ${tab==='give'?'bg-[#7C3AED] text-white':'bg-white border border-[#E8DEC9]'}`}>Give</button>
        <button onClick={() => setTab('admin')} className={`px-4 py-2 rounded-full text-xs font-bold ${tab==='admin'?'bg-[#7C3AED] text-white':'bg-white border border-[#E8DEC9]'}`}>Giving admin</button>
      </div>}

      {tab === 'give' && <>
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7C3AED]">Harvest Giving</p>
          <h1 className="text-2xl font-extrabold mt-1">Give with purpose</h1>
          <p className="text-sm text-[#6B6257] mt-1">Secure M-Pesa giving for Harvest Family Church.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {FUNDS.map(f => <button key={f.id} onClick={() => setFund(f.id)} className={`text-left p-4 rounded-2xl border transition ${fund===f.id?'bg-[#F3E8FF] border-[#7C3AED]':'bg-white border-[#E8DEC9]'}`}>
            <p className="text-xl mb-1">{f.icon}</p><p className="text-sm font-bold">{f.label}</p><p className="text-[11px] text-[#6B6257] mt-1">{f.sub}</p>
          </button>)}
        </div>

        <p className="text-xs font-semibold text-[#6B6257] mb-2">Quick amounts · KES</p>
        <div className="flex gap-2 mb-4 flex-wrap">{QUICK.map(v => <button key={v} onClick={() => setAmount(v)} className={`px-4 py-2 rounded-full text-sm font-semibold ${amount===v?'bg-[#7C3AED] text-white':'bg-white border border-[#E8DEC9]'}`}>{v.toLocaleString()}</button>)}</div>
        <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value===''?'':Number(e.target.value))} placeholder="Custom amount KES" className="input-premium mb-3" />
        <input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="M-Pesa phone 07... or 254..." className="input-premium mb-4" />
        <button disabled={busy} onClick={pay} className="btn-primary-lg w-full mb-3 disabled:opacity-60">{busy?'Sending M-Pesa prompt…':`Give KES ${Number(amount||0).toLocaleString()} · ${purpose}`}</button>
        {message && <div className="mb-4 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] p-4 text-sm text-[#065F46]">{message}</div>}

        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4">
          <h2 className="font-bold mb-3">My giving</h2>
          {transactions.length === 0 ? <p className="text-sm text-[#6B6257]">Your completed and pending gifts will appear here.</p> : transactions.map(t => <div key={t.id} className="flex items-center justify-between py-3 border-b last:border-0 border-[#F1E9DA]">
            <div><p className="text-sm font-semibold">KES {Number(t.amount_kes).toLocaleString()}</p><p className="text-xs text-[#6B6257]">{t.purpose} · {new Date(t.created_at).toLocaleDateString()}</p></div>
            <span className="text-xs font-bold capitalize">{t.status}</span>
          </div>)}
        </div>
      </>}

      {tab === 'admin' && isAdmin && <div className="space-y-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7C3AED]">Administration</p><h1 className="text-2xl font-extrabold mt-1">Giving ledger</h1></div>
        <div className="grid grid-cols-2 gap-3"><div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><p className="text-xs text-[#6B6257]">Completed</p><p className="text-xl font-extrabold">KES {Number(adminData?.totals?.completed_kes||0).toLocaleString()}</p></div><div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><p className="text-xs text-[#6B6257]">Pending</p><p className="text-xl font-extrabold">{adminData?.totals?.pending_count||0}</p></div></div>
        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4">{(adminData?.transactions||[]).map(t => <div key={t.id} className="py-3 border-b last:border-0 border-[#F1E9DA]"><div className="flex justify-between gap-3"><p className="font-semibold">KES {Number(t.amount_kes).toLocaleString()} · {t.purpose}</p><span className="text-xs font-bold capitalize">{t.status}</span></div><p className="text-xs text-[#6B6257]">{t.username || 'member'} · {t.receipt_number || 'No receipt yet'}</p></div>)}</div>
      </div>}
    </div>
  )
}
