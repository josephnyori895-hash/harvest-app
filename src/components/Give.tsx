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

const PAYBILL_FALLBACK = { number: '4138895', name: 'Harvest Family Church' }
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export default function Give() {
  const [fund, setFund] = useState('tithe')
  const [amount, setAmount] = useState<number | ''>(500)
  const [phone, setPhone] = useState('')
  const [transactions, setTransactions] = useState<any[]>([])
  const [adminData, setAdminData] = useState<{transactions:any[],totals:any} | null>(null)
  const [tab, setTab] = useState<'give'|'admin'>('give')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [mpesaEnabled, setMpesaEnabled] = useState<boolean | null>(null)
  const [paybill, setPaybill] = useState('')
  const [pollingId, setPollingId] = useState<string | null>(null)
  const apiEnabled = useApi()
  const currentRole = (() => { try { return localStorage.getItem('harvest_role') } catch { return 'member' } })()
  const isAdmin = currentRole === 'admin'

  const purpose = useMemo(() => FUNDS.find(f => f.id === fund)?.label || 'General Giving', [fund])

  useEffect(() => {
    if (!apiEnabled) return
    fetch(`${API}/api/giving/config`)
      .then(r => r.json()).then(d => { setMpesaEnabled(!!d.mpesa_enabled); setPaybill(d.paybill || '') }).catch(() => setMpesaEnabled(false))
    fetchMyGiving().then(setTransactions).catch(() => {})
    if (isAdmin) fetchGivingAdmin().then(setAdminData).catch(() => {})
  }, [apiEnabled, isAdmin])

  // After an STK push, poll the transaction status so "pending" flips to
  // completed/failed on screen without the member reopening the page.
  useEffect(() => {
    if (!pollingId) return
    const timer = window.setInterval(async () => {
      try {
        const list = await fetchMyGiving()
        setTransactions(list)
        const tx = (Array.isArray(list) ? list : []).find(t => t.id === pollingId)
        if (tx && tx.status !== 'pending') {
          setPollingId(null)
          if (tx.status === 'completed') {
            showToast(`Giving received — thank you! 🙏 Receipt ${tx.receipt_number || ''}`.trim(), 'success')
            setMessage('✅ Your gift has been received. Asante sana!')
          } else if (tx.status === 'failed') {
            setMessage('The M-Pesa payment did not go through. You can try again below.')
          }
        }
      } catch { /* keep polling silently */ }
    }, 4000)
    const stop = window.setTimeout(() => setPollingId(null), 120_000)
    return () => { window.clearInterval(timer); window.clearTimeout(stop) }
  }, [pollingId])

  const pay = async () => {
    if (!apiEnabled) { showToast('Giving requires the server API in production', 'error'); return }
    if (!amount || Number(amount) < 1 || !phone.trim()) { showToast('Enter a valid amount and M-Pesa phone', 'error'); return }
    setBusy(true); setMessage('')
    try {
      const result = await startGiving({ amount:Number(amount), phone:phone.trim(), purpose })
      setMessage(result.message || 'Check your phone — enter your M-Pesa PIN to complete the gift.')
      showToast('M-Pesa prompt sent — check your phone', 'success')
      setPollingId(result.transactionId || null)
      const latest = await fetchMyGiving()
      setTransactions(latest)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Giving request failed'
      if (/unavailable|503/i.test(msg)) {
        setMpesaEnabled(false)
        setMessage('')
        showToast('Online push is being set up — use the Paybill option below for now', 'info')
      } else {
        showToast(msg, 'error')
      }
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
        {mpesaEnabled === false && (
          <div className="mb-4 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] p-4 text-sm">
            <p className="font-bold text-[#92400E]">Give via M-Pesa Paybill (works right now)</p>
            <ol className="list-decimal ml-4 mt-2 space-y-1 text-[#78350F]">
              <li>Open <b>M-Pesa</b> → <b>Lipa na M-Pesa</b> → <b>Pay Bill</b></li>
              <li>Business Number: <b className="select-all">{paybill || PAYBILL_FALLBACK.number}</b> <button onClick={() => { navigator.clipboard?.writeText(paybill || PAYBILL_FALLBACK.number); showToast('Paybill number copied', 'success') }} className="ml-1 text-[#7C3AED] font-bold underline">copy</button></li>
              <li>Account: <b>{purpose}</b> (or your name)</li>
              <li>Amount: <b>KES {Number(amount || 0).toLocaleString()}</b> → enter your PIN</li>
            </ol>
            <p className="text-[11px] text-[#92400E] mt-2">Your gift is recorded by the church treasurer. Automatic receipts activate when online giving is switched on.</p>
          </div>
        )}
        <button disabled={busy} onClick={pay} className="btn-primary-lg w-full mb-3 disabled:opacity-60">{busy?'Sending M-Pesa prompt…':`Give KES ${Number(amount||0).toLocaleString()} · ${purpose}`}</button>
        {pollingId && <div className="mb-3 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-4 text-sm text-[#1E40AF] flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />Waiting for you to enter your M-Pesa PIN…</div>}
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
