import { useEffect, useMemo, useState } from 'react'
import { fetchGivingAdmin, fetchMyGiving, startGiving, fetchProjects, participateInProject, participateByTake, fetchGroupDirectory, fetchDepartmentDirectory, createGivingProject, updateGivingProject, deleteGivingProject, overrideGivingPledge, removeGivenParticipant, renameGivingTake, removeFromTake, useApi } from '../lib/api'
import { showToast } from './Toast'
import { scheduleProjectReminders } from '../lib/notifications'
import { timeAgo } from '../lib/time'

const FUNDS = [
  { id:'tithe', label:'Tithe', sub:'First fruits', icon:'💰' },
  { id:'offering', label:'Offering', sub:'Thanksgiving', icon:'🙏' },
  { id:'building', label:'Building Fund', sub:'Church development', icon:'🏗️' },
  { id:'ministry', label:'Ministry', sub:'Outreach + missions', icon:'🌍' },
]
const QUICK = [100, 200, 500, 1000, 2500, 5000]

const PAYBILL_FALLBACK = { number: '4138895', name: 'Harvest Family Church' }
const MIN_GIVE = 1 // Daraja's floor; church can raise later
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

// Kenyan mobile: 07XXXXXXXX, 01XXXXXXXX, +2547…, 2547… — normalised to 2547…
export function normalizeMpesaPhone(raw: string): string | null {
  const v = String(raw || '').replace(/[\s-]/g, '')
  if (/^0[17]\d{8}$/.test(v)) return `254${v.slice(1)}`
  if (/^254[17]\d{8}$/.test(v)) return v
  if (/^\+254[17]\d{8}$/.test(v)) return v.slice(1)
  return null
}

function ProjectAdminForm({ initial, onCreated, onUpdated }: { initial?: any; onCreated?: (p:any) => void; onUpdated?: (p:any) => void }) {
  const [name,setName]=useState<string>(initial?.name !== undefined ? initial.name : '')
  const [description,setDescription]=useState<string>(initial?.description !== undefined ? initial.description : '')
  const [goal,setGoal]=useState<number | ''>(initial?.goal_kes !== undefined ? initial.goal_kes : '')
  const [deadline,setDeadline]=useState<string>(initial?.deadline ? String(initial.deadline).slice(0,10) : '')
  const [auto,setAuto]=useState<boolean>(initial?.auto_advertise !== false)
  const [busy,setBusy]=useState(false)
  const submit=async()=>{ const n=name.trim(), g=Number(goal); if(!n||!Number.isFinite(g)||g<=0){showToast('Enter a project name and positive goal','error');return}; setBusy(true); try { const payload={name:n,description,goal_kes:g,deadline:deadline?new Date(deadline).toISOString():null,auto_advertise:auto}; if (initial?.id) { const d=await updateGivingProject(String(initial.id),payload); onUpdated?.(d.project); showToast('Project updated','success') } else { const d=await createGivingProject(payload); onCreated?.(d.project); setName('');setDescription('');setGoal('');setDeadline(''); showToast('Project created','success') } } catch(e){showToast(e instanceof Error?e.message:'Could not save project','error')} finally{setBusy(false)} }
  return <div className="mt-3 space-y-2"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Project name" className="input-premium" /><textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What are we working toward?" className="input-premium min-h-20" /><div className="grid grid-cols-2 gap-2"><input inputMode="numeric" value={goal} onChange={e=>setGoal(e.target.value===''?'':Number(e.target.value))} placeholder="Goal KES" className="input-premium" /><input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)} className="input-premium" /></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} /> Auto advertise in Home feed</label><button type="button" disabled={busy} onClick={() => void submit()} className="btn-primary-lg w-full disabled:opacity-60">{initial?.id ? (busy?'Saving…':'Save changes') : (busy?'Creating…':'Create project')}</button></div>
}

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
  const [contentLoaded, setContentLoaded] = useState(false)
  const [paybill, setPaybill] = useState('')
  const [pollingId, setPollingId] = useState<string | null>(null)
  // Admin-editable content (funds, amounts, headline, paybill) with defaults.
  const [content, setContent] = useState<Record<string, string>>({})
  const [paymentConfigs, setPaymentConfigs] = useState<Record<string, any>>({})
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentEditFund, setPaymentEditFund] = useState('offering')
  const [projects, setProjects] = useState<any[]>([])
  const [selectedProject, setSelectedProject] = useState<any | null>(null)
  const [givingProject, setGivingProject] = useState<any | null>(null)
  const [projectCommitment, setProjectCommitment] = useState<number | ''>('')
  const [projectReminder, setProjectReminder] = useState(true)
  const [projectBusy, setProjectBusy] = useState(false)
  const [editingProject, setEditingProject] = useState<any | null>(null)

  // Take modes: an individual commitment (project_participants) or a team
  // take under a group / department / community (project_takes + helpers).
  // Other members may opt to HELP under any existing take.
  type TakeKind = 'individual' | 'group' | 'department' | 'community'
  const [takeKind, setTakeKind] = useState<TakeKind>('individual')
  const [takeEntity, setTakeEntity] = useState<string>('')
  const [takeJoinId, setTakeJoinId] = useState<string>('')
  const [takeNote, setTakeNote] = useState('')
  const [entityOptions, setEntityOptions] = useState<{ group: string[]; department: string[]; community: string[] }>({ group: [], department: [], community: [] })
  const [adminAmts, setAdminAmts] = useState<Record<string, string>>({})

  const refreshProject = async () => {
    try {
      const d = await fetchProjects()
      const list = Array.isArray(d?.projects) ? d.projects : []
      setProjects(list)
      setSelectedProject(prev => prev ? (list.find(x => x.id === prev.id) || prev) : prev)
    } catch { /* keep current view */ }
  }

  const adminSetPledge = async (username: string, key: string) => {
    if (!selectedProject) return
    const value = Number(adminAmts[key])
    if (!Number.isFinite(value) || value < 0) { showToast('Enter a valid amount', 'error'); return }
    try { await overrideGivingPledge(String(selectedProject.id), username, value); setAdminAmts(prev => ({ ...prev, [key]: '' })); showToast(`Pledge set for ${username}`, 'success'); void refreshProject() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not override pledge', 'error') }
  }

  const adminRemoveMember = async (username: string) => {
    if (!selectedProject) return
    if (!window.confirm(`Remove ${username} from this project (individual + helper)?`)) return
    try { await removeGivenParticipant(String(selectedProject.id), username); showToast(`${username} removed`, 'success'); void refreshProject() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not remove member', 'error') }
  }

  const adminRemoveTake = async (take: any) => {
    if (!selectedProject) return
    if (!window.confirm(`Delete take "${take.name}"? Its helper pledges are removed with it.`)) return
    try { await removeFromTake(String(selectedProject.id), String(take.id)); showToast('Take removed', 'success'); void refreshProject() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not remove take', 'error') }
  }

  const adminRenameTake = async (take: any) => {
    if (!selectedProject) return
    const name = window.prompt('New name for this take:', take.name)
    if (name === null) return
    try { await renameGivingTake(String(selectedProject.id), String(take.id), { name: name.trim() }); showToast('Take renamed', 'success'); void refreshProject() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Could not rename take', 'error') }
  }

  const changeProjectStatus = async (p: any, status: string) => {
    try {
      const d = await updateGivingProject(String(p.id), { status })
      setProjects(prev => prev.map(x => x.id === d.project.id ? d.project : x))
      setSelectedProject(prev => prev?.id === d.project.id ? d.project : prev)
      setEditingProject(prev => prev?.id === d.project.id ? d.project : prev)
      showToast(`Project marked ${status}`, 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not update project', 'error') }
  }

  const removeProject = async (p: any) => {
    if (!window.confirm(`Delete "${p.name}"? Participation is removed; contributions already recorded stay in the ledger.`)) return
    try {
      await deleteGivingProject(String(p.id))
      setProjects(prev => prev.filter(x => x.id !== p.id))
      setSelectedProject(prev => prev?.id === p.id ? null : prev)
      setEditingProject(prev => prev?.id === p.id ? null : prev)
      showToast('Project deleted', 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not delete project', 'error') }
  }
  const apiEnabled = useApi()
  const currentRole = (() => { try { return localStorage.getItem('harvest_role') } catch { return 'member' } })()
  const isAdmin = currentRole === 'admin'

  // Group / department / community directories for take pickers.
  useEffect(() => {
    if (!apiEnabled) return
    let cancelled = false
    void (async () => {
      const [g, d] = await Promise.all([
        fetchGroupDirectory().catch(() => null),
        fetchDepartmentDirectory().catch(() => null),
      ])
      if (cancelled || !g) return
      const communities = Object.keys(g.communities || {}).filter(Boolean)
      const groups = (g.groups || []).map((x: any) => x.name || x.slug).filter(Boolean)
      const departments = (Array.isArray(d?.departments) ? d.departments : []).map((x: any) => x.name || x.slug).filter(Boolean)
      setEntityOptions({ group: groups, department: departments, community: communities })
    })()
    return () => { cancelled = true }
  }, [apiEnabled])

  const funds = useMemo<any[]>(() => {
    try { const f = JSON.parse(content.giving_funds || '[]'); if (Array.isArray(f) && f.length) return f } catch { /* default below */ }
    return FUNDS
  }, [content.giving_funds])
  const quick = useMemo<number[]>(() => {
    try { const q = JSON.parse(content.giving_quick || '[]'); if (Array.isArray(q) && q.length) return q.map(Number) } catch { /* default below */ }
    return QUICK
  }, [content.giving_quick])
  const paybillName = content.paybill_name || PAYBILL_FALLBACK.name
  const selectedPayment = paymentConfigs[fund] || { method: 'stk', enabled: true, instructions: '', payment_number: '', account_reference: '' }
  const savePaymentConfigs = async () => {
    setPaymentSaving(true)
    try {
      const token = localStorage.getItem('harvest_token')
      const response = await fetch(`${API}/api/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ giving_payment_methods: JSON.stringify(paymentConfigs) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error || result?.message || 'Could not save payment settings')
      setContent(result.content || { ...content, giving_payment_methods: JSON.stringify(paymentConfigs) })
      showToast('Purpose-specific payment settings saved', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save payment settings', 'error')
    } finally { setPaymentSaving(false) }
  }
  const updatePaymentConfig = (id: string, patch: Record<string, any>) => {
    setPaymentConfigs(prev => ({ ...prev, [id]: { method: 'stk', enabled: true, instructions: '', payment_number: '', account_reference: '', ...(prev[id] || {}), ...patch } }))
  }

  useEffect(() => {
    fetch(`${API}/api/content`).then(r => r.json()).then(d => { const next = d?.content || {}; setContent(next); try { const parsed = JSON.parse(next.giving_payment_methods || '{}'); setPaymentConfigs(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) } catch { setPaymentConfigs({}) }; setContentLoaded(true) }).catch(() => setContentLoaded(true))
  }, [])

  const purpose = useMemo(() => funds.find((f: any) => f.id === fund)?.label || 'General Giving', [funds, fund])

  useEffect(() => {
    if (!apiEnabled) return
    fetch(`${API}/api/giving/config`)
      .then(r => r.json()).then(d => { setMpesaEnabled(!!d.mpesa_enabled); setPaybill(d.paybill || '') }).catch(() => setMpesaEnabled(false))
    fetchMyGiving().then(setTransactions).catch(() => {})
    fetchProjects().then(d => setProjects(Array.isArray(d?.projects) ? d.projects : [])).catch(() => setProjects([]))
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

  const openProject = (project: any) => {
    setSelectedProject(project)
    setProjectCommitment(project?.mine?.commitment_kes || '')
    setProjectReminder(project?.mine?.reminder_enabled !== false)
    setTakeKind(project?.mine_take ? project.mine_take.kind : 'individual')
    setTakeEntity(project?.mine_take ? project.mine_take.name : '')
    setTakeJoinId(project?.mine_take ? String(project.mine_take.take_id) : '')
    setTakeNote('')
  }

  const saveTeamTake = async () => {
    if (!selectedProject || projectBusy) return
    const value = Number(projectCommitment)
    if (!Number.isFinite(value) || value < 0) { showToast('Enter a valid pledge amount', 'error'); return }
    if (!takeJoinId && !takeEntity) { showToast('Pick a group, department or community — or an existing take to help', 'error'); return }
    setProjectBusy(true)
    try {
      const take: any = takeJoinId ? { take_id: takeJoinId } : { kind: takeKind === 'individual' ? 'group' : takeKind, name: takeEntity, ...(takeNote.trim() ? { note: takeNote.trim() } : {}) }
      const d = await participateByTake(String(selectedProject.id), take, value)
      setProjects(prev => prev.map(p => p.id === d.project.id ? d.project : p))
      setSelectedProject(d.project)
      setTakeJoinId(takeJoinId || d.helper?.take_id || '')
      showToast(takeJoinId ? 'Helping recorded — thank you!' : `Take recorded — ${takeEntity} is in. Others can now help.`, 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save take', 'error') }
    finally { setProjectBusy(false) }
  }

  const saveParticipation = async () => {
    if (!selectedProject || projectBusy) return
    const value = Number(projectCommitment)
    if (!Number.isFinite(value) || value < 0) { showToast('Enter a valid commitment amount', 'error'); return }
    setProjectBusy(true)
    try {
      const d = await participateInProject(String(selectedProject.id), value, projectReminder)
      setProjects(prev => prev.map(p => p.id === d.project.id ? d.project : p))
      setSelectedProject(d.project)
      if (projectReminder) void scheduleProjectReminders(d.project, Number(d.project?.mine?.remaining_kes) || 0)
      showToast(value > 0 ? 'Project participation saved' : 'Project participation removed', 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not save participation', 'error') }
    finally { setProjectBusy(false) }
  }
  const projectCard = (p: any) => {
    const pct = p.goal_kes > 0 ? Math.min(100, Math.round((p.raised_kes / p.goal_kes) * 100)) : 0
    return <button key={p.id} type="button" onClick={() => openProject(p)} className="w-full text-left rounded-2xl bg-white border border-[#E8DEC9] p-4 shadow-sm active:scale-[0.99] transition-transform">
      <div className="flex items-start gap-3"><span className="w-11 h-11 shrink-0 rounded-2xl bg-[#F3E8FF] flex items-center justify-center text-xl">{p.icon || '🤲'}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="font-extrabold truncate">{p.name}</p><span className="text-[10px] font-bold capitalize text-[#7C3AED] shrink-0">{p.status}</span></div><p className="mt-1 text-xs text-[#6B6257] line-clamp-2">{p.description || 'Give with purpose and help us move this project forward.'}</p></div></div>
      <div className="mt-3 h-2 rounded-full bg-[#F4E8D0] overflow-hidden"><div className="h-full bg-[#7C3AED] rounded-full" style={{width:`${pct}%`}} /></div>
      <div className="mt-2 flex justify-between gap-3 text-[11px] font-semibold"><span>KES {Number(p.raised_kes).toLocaleString()} raised</span><span>{pct}% · {p.participants} participating</span></div>
      {p.mine && <p className="mt-2 text-[11px] text-[#5B21B6] font-bold">Your commitment: KES {Number(p.mine.commitment_kes).toLocaleString()} · paid KES {Number(p.mine.paid_kes).toLocaleString()}</p>}
      {p.deadline && <p className="mt-1 text-[10px] text-[#8B8175]">Deadline {timeAgo(p.deadline)}</p>}
    </button>
  }

  const pay = async () => {
    if (!apiEnabled) { showToast('Giving requires the server API in production', 'error'); return }
    // Field-level validation: fail fast with a specific, visible error instead
    // of a doomed STK push that leaves a permanent "pending" row.
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < MIN_GIVE) { showToast(`Enter a whole amount of at least KES ${MIN_GIVE}`, 'error', 3500); return }
    if (!Number.isInteger(amt)) { showToast('M-Pesa takes whole shillings — round to a whole number', 'error', 3500); return }
    if (amt > 1000000) { showToast('For gifts above KES 1,000,000 please contact the treasurer', 'error', 3500); return }
    const normalizedPhone = normalizeMpesaPhone(phone)
    if (!normalizedPhone) { showToast('Enter a valid Safaricom number: 07…, 01… or 2547…', 'error', 3500); return }
    setBusy(true); setMessage('')
    try {
      const result = await startGiving({ amount: amt, phone: normalizedPhone, purpose, ...(givingProject?.id ? { project_id: String(givingProject.id) } : {}) })
      setMessage(result.message || 'Check your phone — enter your M-Pesa PIN to complete the gift.')
      showToast('M-Pesa prompt sent — check your phone', 'success')
      setPollingId(result.transactionId || null)
      setGivingProject(null)
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

      {tab === 'give' && (!contentLoaded ? (
        <div className="mb-6 p-4 rounded-2xl bg-white border border-[#E8DEC9] animate-pulse"><div className="h-4 w-1/3 bg-[#F4E8D0] rounded mb-3" /><div className="h-3 w-2/3 bg-[#F4E8D0] rounded" /></div>
      ) : (<>
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7C3AED]">Harvest Giving</p>
          <h1 className="text-2xl font-extrabold mt-1">{content.giving_title || 'Give with purpose'}</h1>
          <p className="text-sm text-[#6B6257] mt-1">{content.giving_subtitle || 'Secure M-Pesa giving for Harvest Family Church.'}</p>
        </div>

        {projects.length > 0 && <section className="mb-7"><div className="mb-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#B45309]">Projects</p><h2 className="text-lg font-extrabold">Give with purpose</h2><p className="text-xs text-[#6B6257] mt-1">Take part, track your progress, and help complete a shared goal.</p></div><div className="space-y-3">{projects.filter(p => ['active','upcoming'].includes(p.status)).map(projectCard)}</div></section>}

        <div className="grid grid-cols-2 gap-3 mb-6">
          {funds.map((f: any) => <button key={f.id} onClick={() => setFund(f.id)} className={`text-left p-4 rounded-2xl border transition ${fund===f.id?'bg-[#F3E8FF] border-[#7C3AED]':'bg-white border-[#E8DEC9]'}`}>
            <p className="text-xl mb-1">{f.icon || '💝'}</p><p className="text-sm font-bold">{f.label}</p>{f.sub && <p className="text-[11px] text-[#6B6257] mt-1">{f.sub}</p>}
          </button>)}
        </div>

        <p className="text-xs font-semibold text-[#6B6257] mb-2">Quick amounts · KES</p>
        <div className="flex gap-2 mb-4 flex-wrap">{quick.map((v: number) => <button key={v} onClick={() => setAmount(v)} className={`px-4 py-2 rounded-full text-sm font-semibold ${amount===v?'bg-[#7C3AED] text-white':'bg-white border border-[#E8DEC9]'}`}>{v.toLocaleString()}</button>)}</div>
        <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value===''?'':Number(e.target.value))} placeholder={`Custom amount KES (min ${MIN_GIVE})`} className="input-premium mb-1" />
        {amount !== '' && !Number.isInteger(Number(amount)) && <p className="text-xs text-[#B45309] mb-1">M-Pesa takes whole shillings — this will be rejected.</p>}
        <input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="M-Pesa phone 07… or 01…" className="input-premium mb-1" />
        {phone.trim() !== '' && !normalizeMpesaPhone(phone) && <p className="text-xs text-[#B45309] mb-1">Not a valid Safaricom number — use 07XX XXX XXX or 01XX XXX XXX.</p>}
        {mpesaEnabled === false && (
          <div className="mb-4 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] p-4 text-sm">
            <p className="font-bold text-[#92400E]">Give via M-Pesa Paybill (works right now)</p>
            <ol className="list-decimal ml-4 mt-2 space-y-1 text-[#78350F]">
              <li>Open <b>M-Pesa</b> → <b>Lipa na M-Pesa</b> → <b>Pay Bill</b></li>
              <li>Business Number: <b className="select-all">{paybill || content.paybill_number || PAYBILL_FALLBACK.number}</b> <button onClick={() => { navigator.clipboard?.writeText(paybill || content.paybill_number || PAYBILL_FALLBACK.number); showToast('Paybill number copied', 'success') }} className="ml-1 text-[#7C3AED] font-bold underline">copy</button></li>
              <li>Account: <b>{purpose}</b> (or your name){paybillName && paybillName !== PAYBILL_FALLBACK.name ? '' : ''}</li>
              <li>Amount: <b>KES {Number(amount || 0).toLocaleString()}</b> → enter your PIN</li>
            </ol>
            <p className="text-[11px] text-[#92400E] mt-2">Your gift is recorded by the church treasurer. Automatic receipts activate when online giving is switched on.</p>
          </div>
        )}
        {givingProject && <div className="mb-3 rounded-2xl bg-[#F3E8FF] border border-[#DDD6FE] p-3 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] uppercase tracking-wide font-extrabold text-[#5B21B6]">Giving toward</p><p className="text-sm font-extrabold truncate">{givingProject.name}</p></div><button type="button" onClick={() => setGivingProject(null)} className="text-xs font-bold text-[#6B6257]">Clear</button></div>}
        <button disabled={busy} onClick={pay} className="btn-primary-lg w-full mb-3 disabled:opacity-60">{busy?'Sending M-Pesa prompt…':`Give KES ${Number(amount||0).toLocaleString()} · ${purpose}`}</button>
        {pollingId && <div className="mb-3 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] p-4 text-sm text-[#1E40AF] flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />Waiting for you to enter your M-Pesa PIN…</div>}
        {message && <div className="mb-4 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] p-4 text-sm text-[#065F46]">{message}</div>}

        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4">
          <h2 className="font-bold mb-3">My giving</h2>
          {transactions.length === 0 ? <p className="text-sm text-[#6B6257]">Your completed and pending gifts will appear here.</p> : transactions.map(t => <div key={t.id} className="flex items-center justify-between py-3 border-b last:border-0 border-[#F1E9DA]">
            <div><p className="text-sm font-semibold">KES {Number(t.amount_kes).toLocaleString()}</p><p className="text-xs text-[#6B6257]">{t.purpose} · {timeAgo(t.created_at)}</p></div>
            <span className="text-xs font-bold capitalize">{t.status}</span>
          </div>)}
        </div>
      </>))}

      {selectedProject && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setSelectedProject(null)}><div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-[28px] bg-[#FFFBF0] p-5" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.16em] text-[#7C3AED] font-extrabold">Project</p><h2 className="text-xl font-extrabold mt-1">{selectedProject.icon} {selectedProject.name}</h2></div><button type="button" onClick={() => setSelectedProject(null)} className="w-9 h-9 rounded-full bg-white border border-[#E8DEC9]">×</button></div><p className="mt-3 text-sm text-[#5B5146] leading-6">{selectedProject.description}</p><div className="mt-4 rounded-2xl bg-white border border-[#E8DEC9] p-4"><div className="flex justify-between text-xs font-bold"><span>Raised</span><span>KES {Number(selectedProject.raised_kes).toLocaleString()} / {Number(selectedProject.goal_kes).toLocaleString()}</span></div><div className="mt-2 h-2 rounded-full bg-[#F4E8D0]"><div className="h-full rounded-full bg-[#7C3AED]" style={{width: (selectedProject.goal_kes ? Math.min(100, selectedProject.raised_kes / selectedProject.goal_kes * 100) : 0) + '%'}} /></div><div className="mt-2 flex justify-between text-[11px] text-[#6B6257]"><span>{selectedProject.participants} participating</span><span>KES {Number(selectedProject.remaining_kes).toLocaleString()} remaining</span></div></div>{selectedProject.mine && <div className="mt-3 rounded-2xl bg-[#F3E8FF] p-4"><p className="text-xs font-extrabold text-[#5B21B6]">Your project status</p><p className="mt-2 text-sm font-bold">Committed KES {Number(selectedProject.mine.commitment_kes).toLocaleString()}</p><p className="text-xs text-[#6B6257]">Paid KES {Number(selectedProject.mine.paid_kes).toLocaleString()} · KES {Number(selectedProject.mine.remaining_kes).toLocaleString()} remaining</p></div>}
          {(selectedProject.takes || []).length > 0 && <div className="mt-3"><p className="text-xs font-extrabold text-[#7C3AED]">Team takes on this project</p>{selectedProject.takes.map((t: any) => <div key={t.id} className="mt-2 rounded-2xl bg-white border border-[#E8DEC9] p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-bold truncate">{t.kind === 'group' ? '👥' : t.kind === 'department' ? '🏛' : '🏘'} {t.name}</p><p className="text-[11px] text-[#6B6257] mt-0.5">{t.taken_by ? `Taken by ${t.taken_by.name || t.taken_by.username}` : 'Open'} · {t.helpers_count} helping · KES {Number(t.total_committed_kes).toLocaleString()} pledged</p></div><button type="button" onClick={() => { setTakeKind(t.kind); setTakeJoinId(t.id); setTakeEntity(t.name); setProjectCommitment(t.mine_helper ? Number(t.mine_helper.commitment_kes) : '') }} className="shrink-0 px-3 py-1.5 rounded-xl bg-[#F3E8FF] text-[#5B21B6] text-[11px] font-extrabold">{t.mine_helper ? 'Update' : 'Help'}</button></div></div>)}</div>}
          {isAdmin && <div className="mt-3 rounded-2xl bg-white border border-[#E8DEC9] p-3"><p className="text-xs font-extrabold text-[#7C3AED]">Admin controls</p>{(selectedProject.participants_list || []).length === 0 && (selectedProject.takes || []).length === 0 && <p className="text-xs text-[#6B6257] mt-1">No members have taken or contributed to this project yet.</p>}{(selectedProject.participants_list || []).map((u: any) => <div key={`ind-${u.username}`} className="mt-2"><p className="text-[11px] font-bold truncate">{u.name || u.username} <span className="text-[#8B8175]">@{u.username}</span> · KES {Number(u.commitment_kes).toLocaleString()}</p><div className="flex gap-1.5 mt-1"><input inputMode="numeric" value={adminAmts[`ind:${u.username}`] ?? ''} onChange={e => setAdminAmts(prev => ({ ...prev, [`ind:${u.username}`]: e.target.value }))} placeholder="New pledge" className="input-premium flex-1" /><button type="button" onClick={() => void adminSetPledge(u.username, `ind:${u.username}`)} className="px-3 py-1.5 rounded-xl bg-[#F3E8FF] text-[#5B21B6] text-[11px] font-extrabold">Set</button><button type="button" onClick={() => void adminRemoveMember(u.username)} className="px-3 py-1.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[11px] font-extrabold">✕</button></div></div>)}{(selectedProject.takes || []).map((t: any) => <div key={t.id} className="mt-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold truncate">{t.kind === 'group' ? '👥' : t.kind === 'department' ? '🏛' : '🏘'} {t.name} · {t.helpers_detail?.length || t.helpers_count} helping · KES {Number(t.total_committed_kes).toLocaleString()}</p><div className="flex gap-1"><button type="button" onClick={() => void adminRenameTake(t)} className="px-2 py-1 rounded-lg bg-[#F3E8FF] text-[#5B21B6] text-[10px] font-extrabold">Rename</button><button type="button" onClick={() => void adminRemoveTake(t)} className="px-2 py-1 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[10px] font-extrabold">Remove</button></div></div>{(t.helpers_detail || []).map((h: any) => <div key={`h-${t.id}-${h.username}`} className="mt-1.5"><p className="text-[10px] text-[#6B6257] truncate">{h.name || h.username} · KES {Number(h.commitment_kes).toLocaleString()}{h.note ? ` · "${h.note}"` : ''}</p><div className="flex gap-1.5"><input inputMode="numeric" value={adminAmts[`helper:${t.id}:${h.username}`] ?? ''} onChange={e => setAdminAmts(prev => ({ ...prev, [`helper:${t.id}:${h.username}`]: e.target.value }))} placeholder="Set pledge" className="input-premium flex-1" /><button type="button" onClick={() => void adminSetPledge(h.username, `helper:${t.id}:${h.username}`)} className="px-3 py-1.5 rounded-xl bg-[#F3E8FF] text-[#5B21B6] text-[11px] font-extrabold">Set</button></div></div>)}</div>)}</div>}
          <div className="mt-4"><p className="text-xs font-extrabold text-[#7C3AED]">How do you want to take this?</p><div className="mt-2 grid grid-cols-4 gap-1.5">{(['individual','group','department','community'] as const).map(k => <button key={k} type="button" onClick={() => { setTakeKind(k); setTakeJoinId(''); setTakeEntity(k === 'individual' ? '' : takeEntity) }} className={`py-2 rounded-xl text-[11px] font-extrabold border ${takeKind === k ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white border-[#E8DEC9] text-[#5B5146]'}`}>{k === 'individual' ? '👤 Me' : k === 'group' ? '👥 Group' : k === 'department' ? '🏛 Dept' : '🏘 Community'}</button>)}</div></div>
          {takeKind !== 'individual' && <div className="mt-3 rounded-2xl bg-white border border-[#E8DEC9] p-3"><p className="text-xs font-bold">{takeKind === 'group' ? '👥 As a group' : takeKind === 'department' ? '🏛 As a department' : '🏘 As a community'}</p>{(selectedProject.takes || []).filter((t: any) => t.kind === takeKind).length > 0 && <select value={takeJoinId} onChange={e => { const id = e.target.value; setTakeJoinId(id); const t = (selectedProject.takes || []).find((x: any) => x.id === id); setTakeEntity(t?.name || ''); if (t?.mine_helper) setProjectCommitment(Number(t.mine_helper.commitment_kes)) }} className="input-premium mt-2"><option value="">— Help an existing take —</option>{(selectedProject.takes || []).filter((t: any) => t.kind === takeKind).map((t: any) => <option key={t.id} value={t.id}>{t.name} · KES {Number(t.total_committed_kes).toLocaleString()}</option>)}</select>}<select value={takeJoinId ? '' : takeEntity} onChange={e => setTakeEntity(e.target.value)} disabled={!!takeJoinId} className="input-premium mt-2"><option value="">{takeJoinId ? 'Helping an existing take' : `— Start a new ${takeKind === 'group' ? 'group' : takeKind === 'department' ? 'department' : 'community'} take —`}</option>{(takeKind === 'group' ? entityOptions.group : takeKind === 'department' ? entityOptions.department : entityOptions.community).filter((n: string) => !(selectedProject.takes || []).some((t: any) => t.kind === takeKind && t.name === n)).map((n: string) => <option key={n} value={n}>{n}</option>)}</select></div>}
          <label className="block mt-4 text-xs font-bold">{takeKind === 'individual' ? 'My commitment (KES)' : takeJoinId ? 'My pledge to help (KES, 0 = helping by hand)' : 'Pledge on behalf (KES)'}<input inputMode="numeric" value={projectCommitment} onChange={e => setProjectCommitment(e.target.value === '' ? '' : Number(e.target.value))} placeholder="e.g. 10000" className="input-premium mt-2" /></label>
          {takeKind === 'individual' && <label className="mt-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={projectReminder} onChange={e => setProjectReminder(e.target.checked)} /> Remind me about this project</label>}
          <button type="button" disabled={projectBusy} onClick={() => takeKind === 'individual' ? void saveParticipation() : void saveTeamTake()} className="btn-primary-lg w-full mt-4 disabled:opacity-60">{projectBusy ? 'Saving…' : takeKind === 'individual' ? 'Save participation' : takeJoinId ? 'Save my help' : 'Take as ' + (takeKind === 'group' ? 'group' : takeKind === 'department' ? 'department' : 'community')}</button><button type="button" onClick={() => { setGivingProject(selectedProject); setSelectedProject(null); setFund('building') }} className="w-full mt-2 py-3 rounded-xl border border-[#E8DEC9] bg-white text-sm font-extrabold">Give toward this project</button></div></div>}

      {tab === 'admin' && isAdmin && <div className="space-y-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7C3AED]">Administration</p><h1 className="text-2xl font-extrabold mt-1">Giving ledger</h1></div>
        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4">
          <h2 className="font-extrabold">Purpose-specific payment methods</h2>
          <p className="text-xs text-[#6B6257] mt-1">Each giving purpose has its own editable payment instructions. These settings never change another purpose's configuration.</p>
          <label className="block mt-3 text-xs font-bold">Giving purpose
            <select value={paymentEditFund} onChange={e => setPaymentEditFund(e.target.value)} className="input-premium mt-1">
              {funds.map((f:any) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          {(() => {
            const cfg = paymentConfigs[paymentEditFund] || { method: 'stk', enabled: true, instructions: '', payment_number: '', account_reference: '' }
            return <div className="mt-3 space-y-3">
              <label className="block text-xs font-bold">Payment method
                <select value={cfg.method || 'stk'} onChange={e => updatePaymentConfig(paymentEditFund, { method: e.target.value })} className="input-premium mt-1">
                  <option value="stk">M-Pesa STK Push</option><option value="paybill">M-Pesa Paybill</option><option value="till">M-Pesa Till</option><option value="bank">Bank transfer</option><option value="manual">Manual instructions</option>
                </select>
              </label>
              {(cfg.method === 'paybill' || cfg.method === 'till') && <label className="block text-xs font-bold">{cfg.method === 'paybill' ? 'Paybill number' : 'Till number'}
                <input value={cfg.payment_number || ''} onChange={e => updatePaymentConfig(paymentEditFund, { payment_number: e.target.value })} maxLength={32} placeholder="Enter official payment number" className="input-premium mt-1" />
              </label>}
              {cfg.method === 'paybill' && <label className="block text-xs font-bold">Account reference
                <input value={cfg.account_reference || ''} onChange={e => updatePaymentConfig(paymentEditFund, { account_reference: e.target.value })} maxLength={40} placeholder={funds.find((f:any)=>f.id===paymentEditFund)?.label || 'Purpose reference'} className="input-premium mt-1" />
              </label>}
              {cfg.method === 'bank' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={cfg.bank_name || ''} onChange={e => updatePaymentConfig(paymentEditFund, { bank_name: e.target.value })} maxLength={120} placeholder="Bank name" className="input-premium" />
                <input value={cfg.bank_account_name || ''} onChange={e => updatePaymentConfig(paymentEditFund, { bank_account_name: e.target.value })} maxLength={120} placeholder="Account name" className="input-premium" />
                <input value={cfg.bank_account_number || ''} onChange={e => updatePaymentConfig(paymentEditFund, { bank_account_number: e.target.value })} maxLength={64} placeholder="Account number" className="input-premium" />
                <input value={cfg.account_reference || ''} onChange={e => updatePaymentConfig(paymentEditFund, { account_reference: e.target.value })} maxLength={40} placeholder="Transfer reference" className="input-premium" />
              </div>}
              <label className="block text-xs font-bold">Instructions shown to members
                <textarea value={cfg.instructions || ''} onChange={e => updatePaymentConfig(paymentEditFund, { instructions: e.target.value })} maxLength={1000} rows={3} placeholder="Explain how to give to this purpose" className="input-premium mt-1" />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={cfg.enabled !== false} onChange={e => updatePaymentConfig(paymentEditFund, { enabled: e.target.checked })} /> Members can give to this purpose</label>
              <button type="button" disabled={paymentSaving} onClick={() => void savePaymentConfigs()} className="btn-primary-lg w-full disabled:opacity-60">{paymentSaving ? 'Saving…' : 'Save payment settings'}</button>
              <p className="text-[10px] text-[#8B8175]">No preview/example payment number is prefilled. M-Pesa API credentials remain server-side.</p>
            </div>
          })()}
        </div>
        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><h2 className="font-extrabold">Manage projects</h2><p className="text-xs text-[#6B6257] mt-0.5">Edit, pause, complete or remove what the family is giving toward.</p>{projects.length === 0 && <p className="text-xs text-[#6B6257] mt-2">No projects yet — create one below.</p>}{projects.map(p => <div key={p.id} className="py-3 border-b last:border-0 border-[#F1E9DA]"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="font-semibold truncate">{p.icon} {p.name} <span className="text-[10px] font-bold uppercase tracking-wide text-[#7C3AED] ml-1">{p.status}</span></p><p className="text-xs text-[#6B6257] mt-0.5">KES {Number(p.raised_kes||0).toLocaleString()} raised of KES {Number(p.goal_kes).toLocaleString()} · {p.participants} participating</p></div><div className="flex flex-col gap-1 shrink-0"><button onClick={()=>setEditingProject(p)} className="px-3 py-1.5 rounded-xl bg-[#F3E8FF] text-[#5B21B6] text-[11px] font-extrabold">Edit</button>{p.status === 'active' && <button onClick={()=>void changeProjectStatus(p,'paused')} className="px-3 py-1.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-[11px] font-extrabold">Pause</button>}{(p.status === 'paused' || p.status === 'upcoming') && <button onClick={()=>void changeProjectStatus(p,'active')} className="px-3 py-1.5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] text-[11px] font-extrabold">Activate</button>}{p.status !== 'completed' && <button onClick={()=>void changeProjectStatus(p,'completed')} className="px-3 py-1.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] text-[11px] font-extrabold">Complete</button>}<button onClick={()=>void removeProject(p)} className="px-3 py-1.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-[11px] font-extrabold">Delete</button></div></div></div>)}</div>
        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><h2 className="font-extrabold">Create project</h2><p className="text-xs text-[#6B6257] mt-1">Projects can be promoted automatically in the Home feed.</p><ProjectAdminForm onCreated={p => setProjects(prev => [p, ...prev])} /></div>
        {editingProject && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={()=>setEditingProject(null)}><div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-[28px] bg-[#FFFBF0] p-5" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between"><h2 className="font-extrabold">Edit project</h2><button onClick={()=>setEditingProject(null)} className="w-9 h-9 rounded-full bg-white border border-[#E8DEC9]">×</button></div><ProjectAdminForm initial={editingProject} onUpdated={p => { setProjects(prev => prev.map(x => x.id === p.id ? p : x)) }} /></div></div>}
        <div className="grid grid-cols-2 gap-3"><div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><p className="text-xs text-[#6B6257]">Completed</p><p className="text-xl font-extrabold">KES {Number(adminData?.totals?.completed_kes||0).toLocaleString()}</p></div><div className="bg-white border border-[#E8DEC9] rounded-2xl p-4"><p className="text-xs text-[#6B6257]">Pending</p><p className="text-xl font-extrabold">{adminData?.totals?.pending_count||0}</p></div></div>
        <div className="bg-white border border-[#E8DEC9] rounded-2xl p-4">{(adminData?.transactions||[]).map(t => <div key={t.id} className="py-3 border-b last:border-0 border-[#F1E9DA]"><div className="flex justify-between gap-3"><p className="font-semibold">KES {Number(t.amount_kes).toLocaleString()} · {t.purpose}</p><span className="text-xs font-bold capitalize">{t.status}</span></div><p className="text-xs text-[#6B6257]">{t.username || 'member'} · {t.receipt_number || 'No receipt yet'}</p></div>)}</div>
      </div>}
    </div>
  )
}
