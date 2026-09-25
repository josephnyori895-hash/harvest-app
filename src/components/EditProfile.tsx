import { useEffect, useState } from 'react'
import { fetchMe, updateProfile } from '../lib/api'
import { getUploads, startBackgroundUpload, subscribeUploads } from '../lib/backgroundUploads'
import { useCongregations } from '../lib/useCongregations'

import ErrorMessage from './ErrorMessage'
// EditProfile — self-service profile editing (name, photo, phone, location,
// faith, congregation). The avatar uploads through the background manager
// (retries on flaky network), then attaches via PATCH /api/me. Text fields
// save directly; the server is the source of truth and echoes back the
// canonical user, which we propagate to the rest of the app via
// 'harvest:profile-updated'.
export default function EditProfile({ onDone }: { onDone: () => void }) {
  const { congregations: GROUPS } = useCongregations()
  const [me, setMe] = useState<any | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [faith, setFaith] = useState('')
  const [groupName, setGroupName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then(d => {
        if (cancelled || !d.user) return
        setMe(d.user)
        setName(d.user.name || '')
        setPhone(d.user.phone || '')
        setLocation(d.user.location || '')
        setFaith(d.user.faith || '')
        setGroupName(d.user.group_name || '')
        setAvatarUrl(d.user.avatar_url || null)
      })
      .catch(() => { if (!cancelled) setNotice('Could not load your profile — check your connection') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => subscribeUploads(() => {
    setAvatarUploading(getUploads().some(u => u.label === 'profile photo' && u.status === 'uploading'))
  }), [])

  const onAvatarFile = (e: any) => {
    const f: File | undefined = e.target.files?.[0]
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setNotice('Profile photo must be a JPG, PNG or WebP image'); return }
    if (f.size > 5 * 1024 * 1024) { setNotice('Profile photo must be under 5 MB'); return }
    setNotice('')
    setAvatarUploading(true)
    setSaved(false)
    void startBackgroundUpload({
      label: 'profile photo',
      successMsg: 'Profile photo updated ✓',
      task: { kind: 'avatar', file: f },
    })
      .then(() => fetchMe().then(d => { if (d.user) setAvatarUrl(d.user.avatar_url || null) }))
      .catch(() => {})
  }

  const removeAvatar = async () => {
    if (busy) return
    setBusy(true)
    try {
      await updateProfile({ avatar_key: null })
      setAvatarUrl(null)
      window.dispatchEvent(new Event('harvest:profile-updated'))
    } catch (e: any) {
      setNotice(e?.message || 'Could not remove the photo')
    } finally { setBusy(false) }
  }

  const save = async () => {
    if (busy || avatarUploading) return
    if (!name.trim()) { setNotice('Your name cannot be empty'); return }
    setBusy(true); setNotice(''); setSaved(false)
    try {
      const d = await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        location: location.trim(),
        faith: faith.trim(),
        group_name: groupName,
      })
      if (d.user) {
        setName(d.user.name || '')
        setPhone(d.user.phone || '')
        setLocation(d.user.location || '')
        setFaith(d.user.faith || '')
        setGroupName(d.user.group_name || '')
      }
      window.dispatchEvent(new Event('harvest:profile-updated'))
      setSaved(true)
      setTimeout(() => onDone(), 700)
    } catch (e: any) {
      setNotice(e?.message || 'Could not save your profile')
    } finally { setBusy(false) }
  }

  const dirty = Boolean(me) && (
    name !== (me?.name || '') ||
    phone !== (me?.phone || '') ||
    location !== (me?.location || '') ||
    faith !== (me?.faith || '') ||
    groupName !== (me?.group_name || '')
  )

  return (
    <div className="bg-[#141210] text-white min-h-[calc(100vh-56px)] pb-8">
      <div className="flex justify-between items-center px-4 h-[56px] border-b border-stone-800 sticky top-0 bg-[#141210] z-10">
        <button onClick={onDone} className="text-xl text-stone-300 px-1">✕</button>
        <p className="font-semibold text-sm">Edit profile</p>
        <button
          onClick={() => void save()}
          disabled={busy || avatarUploading || !dirty}
          className={`font-semibold text-sm ${busy || avatarUploading || !dirty ? 'text-stone-600' : 'text-[#7C3AED]'}`}
        >{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {notice && <div className="mx-4 mt-3"><ErrorMessage message={notice} /></div>}
      {saved && <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-950/60 border border-emerald-900 text-sm text-emerald-300">Profile saved ✓</div>}

      <div className="flex flex-col items-center py-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[3px]">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full rounded-full object-cover border-[3px] border-black" />
            ) : (
              <div className="w-full h-full rounded-full bg-[#141210] flex items-center justify-center font-bold text-xl border-[3px] border-black">
                {(name || me?.username || '?').split(/[\s_.]/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase()}
              </div>
            )}
          </div>
          <label className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center cursor-pointer border-2 border-black" title="Change profile photo">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarFile} className="hidden" />
            <span className="text-sm">📷</span>
          </label>
        </div>
        {avatarUploading && <p className="text-[11px] text-stone-400 mt-2">Uploading photo…</p>}
        {!avatarUploading && avatarUrl && (
          <button onClick={() => void removeAvatar()} disabled={busy} className="text-[11px] text-red-400 mt-2 underline">Remove photo</button>
        )}
        {!avatarUploading && !avatarUrl && <p className="text-[11px] text-stone-500 mt-2">Tap 📷 to add a profile photo</p>}
      </div>

      <div className="px-4 space-y-4">
        <div>
          <label className="text-xs text-stone-400 font-semibold">Name</label>
          <input value={name} onChange={e => { setName(e.target.value); setSaved(false) }} maxLength={120} placeholder="Your full name" className="mt-1 w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-600" />
        </div>
        <div>
          <label className="text-xs text-stone-400 font-semibold">Phone</label>
          <input value={phone} onChange={e => { setPhone(e.target.value); setSaved(false) }} type="tel" inputMode="tel" placeholder="07xx xxx xxx" className="mt-1 w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-600" />
          <p className="text-[11px] text-stone-500 mt-1">Visible to admins only — used for church contact and giving.</p>
        </div>
        <div>
          <label className="text-xs text-stone-400 font-semibold">Location</label>
          <input value={location} onChange={e => { setLocation(e.target.value); setSaved(false) }} maxLength={160} placeholder="e.g. Nyeri Town" className="mt-1 w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-600" />
        </div>
        <div>
          <label className="text-xs text-stone-400 font-semibold">Faith testimony</label>
          <input value={faith} onChange={e => { setFaith(e.target.value); setSaved(false) }} maxLength={160} placeholder="A short line about your faith" className="mt-1 w-full bg-stone-900 border border-stone-800 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-600" />
        </div>
        <div>
          <label className="text-xs text-stone-400 font-semibold">Congregation</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {GROUPS.map(g => (
              <button key={g} onClick={() => { setGroupName(g); setSaved(false) }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${groupName === g ? 'bg-white text-black border-white' : 'bg-stone-900 text-stone-300 border-stone-800'}`}>
                {groupName === g ? `✓ ${g}` : g}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
