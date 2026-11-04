import { useEffect, useState } from 'react'
import { fetchMe, updateProfile } from '../lib/api'
import { getUploads, startBackgroundUpload, subscribeUploads } from '../lib/backgroundUploads'
import { useCongregations } from '../lib/useCongregations'
import { Icon } from '../ui'

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
    if (!/^image\//.test(f.type)) { setNotice('Profile photo must be an image'); return }
    if (f.size > 40 * 1024 * 1024) { setNotice('That photo is too large to read — pick a smaller one'); return }
    setNotice('')
    setAvatarUploading(true)
    setSaved(false)
    void startBackgroundUpload({
      label: 'profile photo',
      successMsg: 'Profile photo updated',
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
  const initials = (name || me?.username || '?').split(/[\s_.]/).filter(Boolean).map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()
  const FIELD = 'mt-1 min-h-11 w-full rounded-xl border border-line bg-surface-raised px-4 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent focus:ring-2 focus:ring-accent/20'

  return (
    <div className="min-h-[calc(100vh-56px)] bg-surface pb-8 text-ink">
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-3">
        <button onClick={onDone} aria-label="Close profile editor" className="grid h-11 w-11 place-items-center rounded-full text-ink-muted hover:bg-surface-sunken">
          <Icon name="close" size={19} />
        </button>
        <p className="text-sm font-extrabold">Edit profile</p>
        <button
          onClick={() => void save()}
          disabled={busy || avatarUploading || !dirty}
          className={`min-h-11 rounded-xl px-3 text-sm font-extrabold ${busy || avatarUploading || !dirty ? 'text-ink-subtle' : 'text-accent'}`}
        >{busy ? 'Saving…' : 'Save'}</button>
      </div>

      {notice && <div className="mx-4 mt-3"><ErrorMessage message={notice} /></div>}
      {saved && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-success bg-success-soft p-3 text-sm font-semibold text-success">
          <Icon name="check" size={16} /> Profile saved
        </div>
      )}

      <div className="flex flex-col items-center py-6">
        <div className="relative">
          <div className="h-24 w-24 rounded-full bg-gradient-to-tr from-accent to-accent-strong p-[3px]">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full rounded-full border-[3px] border-surface object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full border-[3px] border-surface bg-surface-sunken text-xl font-extrabold">
                {initials}
              </div>
            )}
          </div>
          <label className="absolute -bottom-1 -right-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-surface bg-accent text-white" title="Change profile photo">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatarFile} className="hidden" />
            <Icon name="camera" size={16} />
          </label>
        </div>
        {avatarUploading && <p className="mt-2 text-2xs text-ink-muted">Uploading photo…</p>}
        {!avatarUploading && avatarUrl && (
          <button onClick={() => void removeAvatar()} disabled={busy} className="mt-2 text-2xs font-bold text-danger underline">Remove photo</button>
        )}
        {!avatarUploading && !avatarUrl && <p className="mt-2 text-2xs text-ink-subtle">Tap the camera to add a profile photo</p>}
      </div>

      <div className="space-y-4 px-4">
        <div>
          <label className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Name</label>
          <input value={name} onChange={e => { setName(e.target.value); setSaved(false) }} maxLength={120} placeholder="Your full name" className={FIELD} />
        </div>
        <div>
          <label className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Phone</label>
          <input value={phone} onChange={e => { setPhone(e.target.value); setSaved(false) }} type="tel" inputMode="tel" placeholder="07xx xxx xxx" className={FIELD} />
          <p className="mt-1 text-2xs text-ink-subtle">Visible to admins only — used for church contact and giving.</p>
        </div>
        <div>
          <label className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Location</label>
          <input value={location} onChange={e => { setLocation(e.target.value); setSaved(false) }} maxLength={160} placeholder="e.g. Nyeri Town" className={FIELD} />
        </div>
        <div>
          <label className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Faith testimony</label>
          <input value={faith} onChange={e => { setFaith(e.target.value); setSaved(false) }} maxLength={160} placeholder="A short line about your faith" className={FIELD} />
        </div>
        <div>
          <label className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Congregation</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {GROUPS.map(g => (
              <button
                key={g}
                onClick={() => { setGroupName(g); setSaved(false) }}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${groupName === g ? 'border-accent bg-accent text-white' : 'border-line bg-surface-raised text-ink-muted'}`}
              >
                {groupName === g && <Icon name="check" size={13} />} {g}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
