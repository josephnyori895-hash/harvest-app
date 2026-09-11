import { useState, useMemo } from 'react'

const FUNDS = [
  { id: 'tithe', label: 'Tithe', sub: 'First fruits • Malachi 3:10' },
  { id: 'offering', label: 'Offering', sub: 'Thanksgiving' },
  { id: 'building', label: 'Building Fund', sub: 'Expand the altar' },
  { id: 'ministry', label: 'Ministry', sub: 'Outreach + Missions' },
]
const QUICK = [100, 200, 500, 1000, 2500, 5000]

const mockTxns = [
  { id:1, user:'grace', fund:'tithe', amount:500, phone:'0712345678', status:'completed', at:'2025-09-09T10:00:00Z' },
  { id:2, user:'youth_harvest', fund:'offering', amount:2000, phone:'0787654321', status:'pending', at:'2025-09-09T11:30:00Z' },
  { id:3, user:'pst.simon', fund:'building', amount:5000, phone:'0711122233', status:'completed', at:'2025-09-08T09:00:00Z' },
  { id:4, user:'worship_team', fund:'ministry', amount:1500, phone:'0799988877', status:'failed', at:'2025-09-08T14:00:00Z' },
]

export default function Give() {
  const [fund, setFund] = useState('tithe')
  const [amount, setAmount] = useState<number | ''>(500)
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState('')
  const [showTxns, setShowTxns] = useState(false)
  const [tab, setTab] = useState<'give'|'admin'>('give')
  const currentRole = (()=>{ try{ return localStorage.getItem('harvest_role') }catch{return 'member'}})()
  const isAdmin = currentRole==='admin'

  const totalCollected = useMemo(()=>mockTxns.filter(t=>t.status==='completed').reduce((s,t)=>s+t.amount,0),[])
  const pendingCount = mockTxns.filter(t=>t.status==='pending').length
  const pay = () => {
    if (!amount || !phone.trim()) { setStatus('Enter phone and amount'); return }
    setStatus('STK Push sent to ' + phone + ' — KES ' + amount + ' for ' + fund + ' (demo, PIN 7777)')
    setTimeout(() => setStatus(s => s + ' ✓'), 1200)
  }
  const addFund = () => {
    const label = prompt('New fund name:')
    if(!label) return
    const sub = prompt('Description:')||''
    FUNDS.push({ id: label.toLowerCase().replace(/\s+/g,'_'), label, sub })
    setFund(label.toLowerCase().replace(/\s+/g,'_'))
    alert('Fund added ✓')
  }
  const removeFund = (id:string) => {
    if(!confirm('Remove this fund?')) return
    const idx = FUNDS.findIndex(f=>f.id===id)
    if(idx>=0) FUNDS.splice(idx,1)
    alert('Fund removed ✓')
  }
  const verifyTxn = (id:number) => {
    const t = mockTxns.find(x=>x.id===id)
    if(t){t.status='completed';setShowTxns(false);alert('Transaction verified ✓')}
  }

  return (
    <div className="bg-black text-white min-h-[70vh] p-4">
      {isAdmin && (
        <div className="flex gap-2 mb-3">
          <button onClick={()=>setTab('give')} className={`px-3 py-1 rounded-full text-xs font-semibold ${tab==='give'?'bg-[#0095f6] text-white':'bg-zinc-800'}`}>💰 Give</button>
          <button onClick={()=>setTab('admin')} className={`px-3 py-1 rounded-full text-xs font-semibold ${tab==='admin'?'bg-[#7C3AED] text-white':'bg-zinc-800'}`}>📊 Admin</button>
        </div>
      )}

      {tab==='give' && (
        <>
          <h1 className="font-bold text-lg">Give</h1>
          <p className="text-xs text-zinc-500">Tithe • Offering • Building • Ministry — M-Pesa STK</p>
          {isAdmin && <div className="mt-2 px-3 py-2 bg-zinc-900 rounded-xl text-[11px] text-zinc-400">Total collected: KES {totalCollected.toLocaleString()} • {pendingCount} pending</div>}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {FUNDS.map(f => (
              <button key={f.id} onClick={() => setFund(f.id)} className={`p-3 rounded-xl border text-left ${fund===f.id?'bg-white text-black border-white':'bg-zinc-900 border-zinc-800 text-white'}`}>
                <p className="text-sm font-bold">{f.label}</p><p className={`text-[11px] ${fund===f.id?'text-zinc-600':'text-zinc-500'}`}>{f.sub}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            {QUICK.map(v => (
              <button key={v} onClick={() => setAmount(v)} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${amount===v?'bg-[#7C3AED] text-white':'bg-zinc-800 text-white'}`}>{v}</button>
            ))}
          </div>
          <input value={amount as any} onChange={e=>setAmount(e.target.value===''?'' : Number(e.target.value))} placeholder="Custom amount" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mt-3 text-sm outline-none" />
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="M-Pesa phone 07... or 2547..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mt-3 text-sm outline-none" />
          <button onClick={pay} className="w-full mt-4 py-3 rounded-full bg-[#7C3AED] text-white font-semibold">Pay KES {amount || 0} → {fund}</button>
          {status && <p className="text-xs text-amber-400 mt-3 text-center">{status}</p>}
          <p className="text-[11px] text-zinc-600 text-center mt-4">Secure via VPS Daraja • Receipt on approval</p>
          {isAdmin && <button onClick={()=>setShowTxns(true)} className="w-full mt-3 py-2 rounded-full bg-zinc-800 text-xs text-zinc-400">📋 View Transactions ({pendingCount} pending)</button>}
        </>
      )}

      {tab==='admin' && isAdmin && (
        <>
          <div className="flex justify-between items-center mb-3">
            <h1 className="font-bold text-lg">📊 Fund Manager</h1>
            <button onClick={addFund} className="px-3 py-1 rounded-full bg-[#0095f6] text-xs font-semibold">＋ Add Fund</button>
          </div>
          <div className="space-y-2">
            {FUNDS.map(f => (
              <div key={f.id} className="flex items-center justify-between bg-zinc-900 rounded-xl px-4 py-3">
                <div><p className="text-sm font-bold">{f.label}</p><p className="text-[11px] text-zinc-500">{f.sub}</p></div>
                <button onClick={()=>removeFund(f.id)} className="text-red-400 text-xs">✕ Remove</button>
              </div>
            ))}
          </div>
          {showTxns && (
            <div className="mt-3 space-y-2 max-h-60 overflow-auto">
              <h2 className="text-sm font-bold">Transactions</h2>
              {mockTxns.map(t => (
                <div key={t.id} className={`flex items-center justify-between bg-zinc-900 rounded-xl px-4 py-3 ${t.status==='pending'?'border border-amber-600':''}`}>
                  <div><p className="text-xs font-semibold">{t.user} → {t.fund} • KES {t.amount}</p><p className="text-[10px] text-zinc-500">{t.phone} • {t.at.slice(0,10)}</p></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.status==='completed'?'bg-green-900 text-green-400':t.status==='pending'?'bg-amber-900 text-amber-400':'bg-red-900 text-red-400'}`}>{t.status}</span>
                  {t.status==='pending' && <button onClick={()=>verifyTxn(t.id)} className="ml-2 text-xs bg-green-600 px-2 py-1 rounded-full">✓ Verify</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
