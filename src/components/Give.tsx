import { useState, useMemo } from 'react'
import { showToast } from './Toast'

const FUNDS = [
  { id: 'tithe', label: 'Tithe', sub: 'First fruits • Malachi 3:10', icon: '💰' },
  { id: 'offering', label: 'Offering', sub: 'Thanksgiving', icon: '🙏' },
  { id: 'building', label: 'Building Fund', sub: 'Expand the altar', icon: '🏗️' },
  { id: 'ministry', label: 'Ministry', sub: 'Outreach + Missions', icon: '🌍' },
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
  const [showTxns, setShowTxns] = useState(false)
  const [tab, setTab] = useState<'give'|'admin'>('give')
  const currentRole = (()=>{ try{ return localStorage.getItem('harvest_role') }catch{return 'member'}})() const isAdmin = currentRole==='admin'

  const totalCollected = useMemo(()=>mockTxns.filter(t=>t.status==='completed').reduce((s,t)=>s+t.amount,0),[])
  const pendingCount = mockTxns.filter(t=>t.status==='pending').length
  
  const pay = () => {
    if (!amount || !phone.trim()) { showToast('Enter phone and amount', 'error'); return }
    showToast(`STK sent to ${phone} for KES ${amount}`, 'success')
  }
  
  const verifyTxn = (id:number) => {
    const t = mockTxns.find(x=>x.id===id)
    if(t){t.status='completed';setShowTxns(false);showToast('Transaction verified ✓', 'success')}
  }

  return (
    <div className="bg-gradient-church text-white min-h-[70vh] p-4">
      {isAdmin && (
        <div className="flex gap-2 mb-4">
          <button onClick={()=>setTab('give')} className={`px-4 py-2 rounded-full text-xs font-bold transition ${tab==='give'?'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/50':'bg-slate-700/50 text-purple-200 hover:bg-slate-600/50'}`}>💰 Give</button>
          <button onClick={()=>setTab('admin')} className={`px-4 py-2 rounded-full text-xs font-bold transition ${tab==='admin'?'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/50':'bg-slate-700/50 text-purple-200 hover:bg-slate-600/50'}`}>📊 Admin</button>
        </div>
      )}

      {tab==='give' && (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold bg-gradient-to-r from-yellow-300 to-pink-400 bg-clip-text text-transparent">Give</h1>
            <p className="text-sm text-purple-300/70 mt-1">Support Harvest Family Church • Tithe • Offering • Building • Ministry</p>
          </div>
          
          {isAdmin && (
            <div className="mb-4 px-4 py-3 bg-gradient-to-r from-purple-900/40 to-slate-900/40 border border-purple-600/30 rounded-xl backdrop-blur-sm">
              <p className="text-xs text-purple-200/80">📊 Total collected: <span className="font-bold text-yellow-300">KES {totalCollected.toLocaleString()}</span> • <span className="text-amber-300 font-semibold">{pendingCount} pending</span></p>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-3 mb-6">
            {FUNDS.map(f => (
              <button key={f.id} onClick={() => setFund(f.id)} className={`p-4 rounded-2xl border transition-all ${
                fund===f.id
                  ? 'bg-gradient-to-br from-purple-600 to-pink-600 border-pink-500/50 shadow-lg shadow-purple-500/50 scale-105'
                  : 'bg-slate-800/50 border-purple-600/30 hover:border-purple-500/50 hover:bg-slate-700/50'
              }`}>
                <p className="text-2xl mb-1">{f.icon}</p>
                <p className="text-sm font-bold text-white">{f.label}</p>
                <p className="text-[11px] text-purple-200/70 mt-1">{f.sub}</p>
              </button>
            ))}
          </div>
          
          <p className="text-xs font-semibold text-purple-300 mb-2">Quick Amounts</p>
          <div className="flex gap-2 mb-5 flex-wrap">
            {QUICK.map(v => (
              <button key={v} onClick={() => setAmount(v)} className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
                amount===v
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/50'
                  : 'bg-slate-700/50 text-purple-200 hover:bg-slate-600/50 border border-purple-600/30'
              }`}>
                {v}
              </button>
            ))}
          </div>
          
          <input value={amount as any} onChange={e=>setAmount(e.target.value===''?'' : Number(e.target.value))} placeholder="Custom amount KES" className="input-premium mb-3" />
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="M-Pesa phone 07... or 254..." className="input-premium mb-4" />
          
          <button onClick={pay} className="btn-primary-lg w-full mb-3">
            💳 Pay KES {amount || 0} → {fund}
          </button>
          
          {isAdmin && (
            <button onClick={()=>setShowTxns(true)} className="w-full py-3 rounded-xl bg-slate-800/50 border border-purple-600/30 text-purple-200 text-sm font-bold hover:bg-slate-700/50 transition">
              📋 View Transactions ({pendingCount} pending)
            </button>
          )}
          
          {showTxns && (
            <div className="mt-4 p-4 bg-slate-800/50 border border-purple-600/30 rounded-2xl max-h-80 overflow-auto">
              <h2 className="text-sm font-bold text-purple-200 mb-3">Recent Transactions</h2>
              {mockTxns.map(t => (
                <div key={t.id} className={`flex items-center justify-between mb-2 p-3 rounded-xl border transition ${
                  t.status==='pending' ? 'bg-amber-900/20 border-amber-600/40' : t.status==='completed' ? 'bg-green-900/20 border-green-600/40' : 'bg-red-900/20 border-red-600/40'
                }`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">{t.user} • KES {t.amount}</p>
                    <p className="text-[10px] text-purple-300/70">{t.fund} • {t.at.slice(0,10)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${
                      t.status==='completed' ? 'bg-green-600/40 text-green-300' : t.status==='pending' ? 'bg-amber-600/40 text-amber-300' : 'bg-red-600/40 text-red-300'
                    }`}>
                      {t.status==='completed' ? '✓ Done' : t.status==='pending' ? '⏳ Pending' : '✕ Failed'}
                    </span>
                    {t.status==='pending' && isAdmin && (
                      <button onClick={()=>verifyTxn(t.id)} className="text-[10px] bg-green-600 text-white px-2 py-1 rounded-full font-bold hover:bg-green-700 transition">✓ Verify</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab==='admin' && isAdmin && (
        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold bg-gradient-to-r from-blue-300 to-purple-400 bg-clip-text text-transparent">Fund Manager</h1>
          <p className="text-xs text-purple-300/70">Manage all giving funds for Harvest Family Church</p>
          <button className="btn-primary w-full">＋ Add New Fund</button>
        </div>
      )}
    </div>
  )
}
