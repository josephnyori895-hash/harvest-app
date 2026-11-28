import { useCallback, useEffect, useRef, useState } from 'react'
import AdminMedia from './AdminMedia'
import { useCongregations } from '../lib/useCongregations'
import { shareAnnouncementToWhatsApp } from '../lib/whatsappShare'
import { timeAgo } from '../lib/time'

import ErrorMessage from './ErrorMessage'
import { Icon } from '../ui'
import { showToast } from './Toast'
import { runAction } from '../lib/actionFeedback'
import { apiGet, presign, uploadToMinio } from '../lib/api'
import GivingFundsEditor from './GivingFundsEditor'
import GivingPaymentEditor, { parsePayments, paymentProblem } from './GivingPaymentEditor'
import PublishingCalendar from './PublishingCalendar'
import { VerifiedBadge } from './VerifiedBadge'
import { parseFunds, parseQuick } from '../lib/givingDefaults'
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
// The installed app always uses the API. The old VITE_USE_API gate silently
// disabled this whole screen in production builds.
const USE_API = true
// Example shape shown in the advanced advert editor.
const ADVERT_EXAMPLE = JSON.stringify([{
  id: 'harvest-bookshop',
  title: 'Harvest Bookshop',
  body: 'Bibles, devotionals and Sunday-school books at the church entrance.',
  cta_url: 'https://example.com/bookshop',
  enabled: true,
  advertise_from: '2026-10-30T00:00:00Z',
  advertise_until: '2026-12-24T23:59:59Z',
}], null, 2)

type Tab = 'dashboard' | 'moderation' | 'media' | 'accounts' | 'announce' | 'audit' | 'support' | 'devices' | 'home' | 'give' | 'chat' | 'adverts' | 'content' | 'ministries' | 'publishing'

// The admin is organised around six destinations an administrator can hold in
// their head, not fourteen feature screens. Each destination keeps its own
// sub-sections, and every existing screen underneath is unchanged — this is a
// reorganisation of entry points, not a second admin system.
type Workspace = 'dashboard' | 'people' | 'content' | 'giving' | 'community' | 'settings'

const WORKSPACES: { id: Workspace; label: string; icon: 'home' | 'users' | 'bookmark' | 'coins' | 'chat' | 'shield'; blurb: string; sections: [Tab, string][] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', blurb: 'What needs attention, activity and system health', sections: [['dashboard', 'Overview']] },
  { id: 'people', label: 'People & Structure', icon: 'users', blurb: 'Members, approvals, ministries and church structure', sections: [['accounts', 'Members'], ['moderation', 'Approvals'], ['ministries', 'Ministries']] },
  { id: 'content', label: 'Content & Publishing', icon: 'bookmark', blurb: 'Announcements, sermons, banners, text, media and schedule', sections: [['publishing', 'Schedule'], ['announce', 'Announcements'], ['home', 'Banners'], ['content', 'All text'], ['media', 'Media']] },
  { id: 'giving', label: 'Giving & Finance', icon: 'coins', blurb: 'Giving purposes, payment instructions and records', sections: [['give', 'Giving setup']] },
  { id: 'community', label: 'Community', icon: 'chat', blurb: 'Chat moderation, sponsored adverts and community controls', sections: [['chat', 'Chats'], ['adverts', 'Adverts']] },
  { id: 'settings', label: 'App Settings & Security', icon: 'shield', blurb: 'Audit trail, health checks, devices and system access', sections: [['audit', 'Audit'], ['devices', 'Devices'], ['support', 'Health & help']] },
]

const workspaceOf = (tab: Tab): Workspace =>
  WORKSPACES.find(w => w.sections.some(([id]) => id === tab))?.id || 'dashboard'

type Props = {
  onBack: () => void
  users: any[]
  setUsers: (u: any[]) => void
  onOpenGroups?: () => void
  onOpenDepartments?: () => void
  onOpenSermons?: () => void
  onOpenMusic?: () => void
  onOpenGive?: () => void
  onOpenMap?: () => void
}

// One church-text field, rendered the same way everywhere an admin edits copy:
// plain name, where members see it, what is live right now, and the raw key for
// support. Shared by the Everything editor and the Give screen so no setting
// ends up as an unexplained box on one screen but not another.
type FieldGuide = { label: string; where: string; sample?: string }
function AdminContentField({ id, keyName, guide, value, saved, limit, rows, mono, onChange }: {
  id: string
  keyName: string
  guide?: FieldGuide
  value: string
  saved: string
  limit: number
  rows?: number
  mono?: boolean
  onChange: (value: string) => void
}) {
  const dirty = value !== saved
  return (
    <div className="rounded-card border border-line bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={id} className="min-w-0 text-[13px] font-extrabold leading-5 text-ink">
          {guide?.label || keyName.replace(/_/g, ' ')}
        </label>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {dirty
            ? <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold text-gold-strong">Unsaved</span>
            : !saved
              ? <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-ink-subtle">Not set</span>
              : null}
          <span className="text-[10px] text-ink-subtle">{value.length}/{limit}</span>
          <span className="max-w-28 truncate font-mono text-[10px] text-ink-subtle" title={keyName}>{keyName}</span>
        </div>
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
        {guide?.where || 'No description yet — a key added for a new surface.'}
      </p>
      {rows !== undefined ? (
        <textarea
          id={id}
          value={value}
          onChange={e => onChange(e.target.value.slice(0, limit))}
          rows={rows}
          spellCheck={false}
          placeholder={guide?.sample || 'Type what members should read…'}
          className={`mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-ink-subtle ${mono ? 'font-mono text-xs' : ''}`}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value.slice(0, limit))}
          placeholder={guide?.sample || 'Type what members should read…'}
          className="input-base mt-1.5"
        />
      )}
      <p className="mt-1 text-[11px] leading-4 text-ink-subtle">
        {saved
          ? <>Live now: “{saved.length > 140 ? `${saved.slice(0, 140)}…` : saved}”{dirty ? ' — your change is not saved yet.' : ''}</>
          : dirty
            ? 'Nothing saved yet — this change is not live.'
            : 'Nothing saved — members see the app’s built-in wording.'}
      </p>
    </div>
  )
}

export default function Admin({ onBack, users, setUsers, onOpenGroups, onOpenDepartments, onOpenSermons, onOpenMusic, onOpenGive, onOpenMap }: Props) {
  const { congregations: GROUPS } = useCongregations()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const token = () => localStorage.getItem('harvest_token') || ''

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 2500) }

  // Every admin action reports out loud: errors become a red toast with the real
  // server message, confirmations a green one. The inline banner stays too, but
  // an admin who scrolled far down the Everything editor never misses it.
  useEffect(() => { if (error) showToast(error, 'error', 6000) }, [error])
  useEffect(() => { if (notice) showToast(notice, 'success') }, [notice])

  // ── Daily operations dashboard ──
  const [dashboard, setDashboard] = useState({ pending: 0, members: 0, groups: 0, departments: 0, online: 0, verified: 0, content: [] as any[], chats: [] as any[], audit: [] as any[], health: null as any })
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  // ── Moderation state ──
  const [pending, setPending] = useState<any[]>([])
  const [status, setStatus] = useState<'pending' | 'rejected' | 'transcoding'>('pending')
  const [cleanupBusy, setCleanupBusy] = useState(false)

  // ── Accounts state ──
  const [accounts, setAccounts] = useState<any[]>(() => (Array.isArray(users) ? users : []))
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [accountFilter, setAccountFilter] = useState<'all' | 'verified' | 'admin' | 'inactive'>('all')
  // Ministries (departments) power both the ministry manager and the per-member
  // "Ministry" selector. One list, one source of truth.
  const [departments, setDepartments] = useState<any[]>([])
  const [newMinistry, setNewMinistry] = useState('')
  const [ministryNames, setMinistryNames] = useState<Record<string, string>>({})
  const [newUser, setNewUser] = useState({ username: '', name: '', pin: '', group_name: GROUPS[0] })
  const [showCreate, setShowCreate] = useState(false)
  const [createMenu, setCreateMenu] = useState(false)
  const [restoreName, setRestoreName] = useState('')
  // PIN resets and permanent deletion are done inline, not through browser
  // prompt/confirm dialogs that look like a developer tool on a phone.
  const [pinResets, setPinResets] = useState<Record<string, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // ── Chat moderation state ──
  const [chatConversations, setChatConversations] = useState<any[]>([])
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [selectedChat, setSelectedChat] = useState('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingChatMessages, setLoadingChatMessages] = useState(false)

  // ── Audit state ──
  const [audit, setAudit] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  // ── Signed-in admin devices ──
  const [devices, setDevices] = useState<any[]>([])
  const [deviceLimit, setDeviceLimit] = useState(2)
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [revokeDevice, setRevokeDevice] = useState<string | null>(null)

  // ── Support and operational health ──
  const [health, setHealth] = useState<{ status: string; checked_at?: string; checks: any[] } | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(false)

  // ── Home content state (hero banner + weekly verse) ──
  const [content, setContent] = useState<Record<string, string>>({})
  const [contentBusy, setContentBusy] = useState(false)
  // Everything editor: the server decides which keys are editable, the admin
  // edits them all in one place instead of hunting through six tabs.
  const [editable, setEditable] = useState<Record<string, number>>({})
  const [customLimit, setCustomLimit] = useState(1000)
  const [contentDraft, setContentDraft] = useState<Record<string, string> | null>(null)
  const [contentQuery, setContentQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const contentValue = (k: string) => contentDraft?.[k] ?? content[k] ?? ''
  const setContentValue = (k: string, v: string) => setContentDraft(d => ({ ...(d ?? content), [k]: v }))
  const CONTENT_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'hero_kicker', label: 'Small heading (top of banner)', hint: 'e.g. Karibu, family', max: 120 },
    { key: 'hero_title', label: 'Main banner title', hint: 'e.g. Compel. Raise. Release.', max: 120 },
    { key: 'hero_subtitle', label: 'Banner subtitle', hint: 'e.g. Get one saved, keep one saved, get another saved.', max: 300, textarea: true },
    { key: 'verse_text', label: 'This week’s encouragement — verse', hint: 'The quote shown mid-screen', max: 300, textarea: true },
    { key: 'verse_ref', label: 'Verse reference', hint: 'e.g. Hebrews 10:24 · Grow together', max: 120 },
    { key: 'pastor_usernames', label: 'Pastors’ usernames (Pray with Pastor)', hint: 'One username per line or comma-separated. Leave empty until pastors join.', max: 600, textarea: true },
  ]
  // ── Church details ──
  // These public details were previously reachable only through the raw
  // "All text" list. They are first-class controls here because the church
  // administrator should not have to hunt through developer-looking keys.
  const CHURCH_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'church_name', label: 'Church name', hint: 'e.g. Harvest Family Church', max: 120 },
    { key: 'church_tagline', label: 'Church tagline', hint: 'e.g. Compel · Raise · Release', max: 200 },
    { key: 'service_times', label: 'Service times', hint: 'e.g. Sunday 8:00am & 10:30am', max: 400, textarea: true },
    { key: 'church_address', label: 'Church address', hint: 'Where members should come', max: 300, textarea: true },
    { key: 'church_phone', label: 'Church phone', hint: 'e.g. 0712 345 678', max: 60 },
    { key: 'church_email', label: 'Church email', hint: 'e.g. hello@harvestfamily.or.ke', max: 120 },
    { key: 'community_rules', label: 'Community rules', hint: 'What members agree to when they post', max: 1200, textarea: true },
    { key: 'announcement_banner', label: 'Announcement banner', hint: 'A short notice at the top of Home; leave empty to hide it', max: 400, textarea: true },
  ]
  // ── Give section fields ──
  const GIVE_FIELDS: { key: string; label: string; hint: string; max: number; textarea?: boolean }[] = [
    { key: 'giving_title', label: 'Giving headline', hint: 'e.g. Give with purpose', max: 120 },
    { key: 'giving_subtitle', label: 'Giving sub-text', hint: 'e.g. Secure M-Pesa giving for Harvest Family Church.', max: 300, textarea: true },
    { key: 'paybill_number', label: 'Fallback Paybill / Till number', hint: 'e.g. 4138895', max: 20 },
    { key: 'paybill_name', label: 'Fallback account name', hint: 'e.g. Harvest Family Church', max: 120 },
    { key: 'giving_min_kes', label: 'Minimum gift (KES)', hint: 'e.g. 1', max: 10 },
    { key: 'giving_max_kes', label: 'Largest single gift the app accepts (KES)', hint: 'e.g. 1000000', max: 10 },
    { key: 'giving_note', label: 'Note under the give button', hint: 'e.g. Giving is secure and receipted by the church treasurer.', max: 300, textarea: true },
    { key: 'giving_history_title', label: '“My giving” heading', hint: 'e.g. My giving', max: 120 },
  ]
  // The Give screen is grouped by what the admin is changing, not by key order:
  // the words members read, then the limits the app enforces, then the details
  // used only when a purpose has none of its own.
  const GIVE_SECTIONS: { title: string; blurb: string; keys: string[] }[] = [
    { title: 'Words on the screen', blurb: 'Headings and the closing note a member reads on the Give screen and in their giving history.', keys: ['giving_title', 'giving_subtitle', 'giving_note', 'giving_history_title'] },
    { title: 'Amounts the app accepts', blurb: 'A gift outside this range is refused before any payment request is sent.', keys: ['giving_min_kes', 'giving_max_kes'] },
    { title: 'M-Pesa details used as a fallback', blurb: 'Only shown while online giving is off, and only for a purpose that has no till, paybill or bank details of its own.', keys: ['paybill_number', 'paybill_name'] },
  ]
  // The server owns the list of editable keys; this map supplies the human half
  // so no field is ever a bare slug. Every entry says what the setting is, where
  // a member actually sees it and, where useful, a sample of the intended text.
  type ContentGuide = { label: string; where: string; sample?: string; group: ContentGroup }
  type ContentGroup = 'Home banner' | 'Welcome & identity' | 'App pages' | 'Community & chat' | 'Giving' | 'Images' | 'Social links' | 'Advanced (JSON)' | 'Everything else'
  const CONTENT_GROUPS: { title: ContentGroup; blurb: string }[] = [
    { title: 'Home banner', blurb: 'The first thing every member sees: the hero lines and the weekly verse.' },
    { title: 'Welcome & identity', blurb: 'Who the church is, where it meets and how to reach it.' },
    { title: 'App pages', blurb: 'Headings on the Sermons, Music and Reels screens.' },
    { title: 'Community & chat', blurb: 'Messages shown in the feed, the chat screen and the rules page.' },
    { title: 'Giving', blurb: 'Titles, limits and the M-Pesa fallback the give screen uses.' },
    { title: 'Images', blurb: 'Public photo links the landing page loads.' },
    { title: 'Social links', blurb: 'The three icons in the landing footer.' },
    { title: 'Advanced (JSON)', blurb: 'Structured data normally edited on the Giving and Adverts screens. Change it here only if you know the shape.' },
    { title: 'Everything else', blurb: 'Keys added later, or ones without a description yet.' },
  ]
  const CONTENT_GUIDE: Record<string, ContentGuide> = {
    hero_kicker: { group: 'Home banner', label: 'Small line above the banner title', where: 'Landing page, top of the welcome card', sample: 'Welcome to Harvest Family Church — Nyeri' },
    hero_title: { group: 'Home banner', label: 'Main banner title', where: 'The largest line on the landing page', sample: 'Compel. Raise. Release.' },
    hero_subtitle: { group: 'Home banner', label: 'Banner subtitle', where: 'Directly under the main title', sample: 'Get one saved; keep one saved; get another saved.' },
    verse_text: { group: 'Home banner', label: 'This week’s verse', where: 'The quote card in the middle of the Home screen', sample: 'Let your gentle spirit be known to all people…' },
    verse_ref: { group: 'Home banner', label: 'Verse reference', where: 'Under the verse quote', sample: 'Philippians 4:5 AMP' },

    welcome_title: { group: 'Welcome & identity', label: 'Welcome card heading', where: 'The “A family to belong to” card on the landing page', sample: 'KARIBU · NYERI' },
    welcome_body: { group: 'Welcome & identity', label: 'Welcome card paragraph', where: 'Under the welcome heading', sample: 'Come as you are. Worship with us and grow in a congregation.' },
    church_name: { group: 'Welcome & identity', label: 'Church name', where: 'Page titles, share cards and the landing header', sample: 'Harvest Family Church Nyeri' },
    church_tagline: { group: 'Welcome & identity', label: 'Church tagline', where: 'Small line under the church name', sample: 'A family to belong to' },
    service_times: { group: 'Welcome & identity', label: 'Service times', where: 'Landing page and the “This Sunday” card on member Home', sample: 'Sunday 9:00am & 11:00am · Wednesday 5:30pm' },
    church_address: { group: 'Welcome & identity', label: 'Church address', where: 'Landing page contact block and the “This Sunday” card', sample: 'Nyeri town, next to …' },
    church_phone: { group: 'Welcome & identity', label: 'Church phone', where: 'Contact line, and the call button on member Home', sample: '0708 776 732' },
    church_email: { group: 'Welcome & identity', label: 'Church email', where: 'Contact line on the landing page', sample: 'info@harvestfamily.co.ke' },

    sermons_title: { group: 'App pages', label: 'Sermons screen heading', where: 'Top of the Sermons screen', sample: 'Sermons' },
    sermons_subtitle: { group: 'App pages', label: 'Sermons screen subtitle', where: 'Under the Sermons heading', sample: 'Listen again, any day of the week' },
    music_title: { group: 'App pages', label: 'Music screen heading', where: 'Top of the Music screen', sample: 'Worship' },
    music_subtitle: { group: 'App pages', label: 'Music screen subtitle', where: 'Under the Music heading', sample: 'Songs from our services' },
    reels_title: { group: 'App pages', label: 'Reels screen heading', where: 'Top of the Reels screen', sample: 'Harvest reels' },

    chat_welcome: { group: 'Community & chat', label: 'Chat welcome message', where: 'First message in an empty chat', sample: 'Karibu! Say hello to the family.' },
    feed_empty: { group: 'Community & chat', label: 'Empty feed message', where: 'Shown when there are no posts yet', sample: 'No posts yet — be the first to share.' },
    announcement_banner: { group: 'Community & chat', label: 'Announcement banner', where: 'Top of the Home screen, above the welcome card', sample: 'Sunday service starts at 9:00am' },
    community_rules: { group: 'Community & chat', label: 'Community rules', where: 'The rules screen linked from the feed', sample: 'Be kind. No politics. No advertising without permission.' },
    pastor_username: { group: 'Community & chat', label: 'Pastor username (single, legacy)', where: 'The “Pray with Pastor” card — use the list below instead', sample: 'pst.simon' },
    pastor_usernames: { group: 'Community & chat', label: 'Pastors for “Pray with Pastor”', where: 'The prayer card opens a chat with the first pastor listed', sample: 'pst.simon, pst.anne' },

    giving_title: { group: 'Giving', label: 'Give screen heading', where: 'Top of the Give screen', sample: 'Be blessed as you give.' },
    giving_subtitle: { group: 'Giving', label: 'Give screen subtitle', where: 'Under the Give heading', sample: 'Giving fulfils God’s laws of prosperity.' },
    giving_note: { group: 'Giving', label: 'Note under the give button', where: 'Bottom of the Give screen', sample: 'Giving is secure and receipted by the church treasurer.' },
    giving_history_title: { group: 'Giving', label: '“My giving” heading', where: 'Heading of a member’s giving history', sample: 'My giving' },
    giving_min_kes: { group: 'Giving', label: 'Smallest gift accepted (KES)', where: 'The amount field rejects anything smaller', sample: '1' },
    giving_max_kes: { group: 'Giving', label: 'Largest gift accepted (KES)', where: 'The amount field rejects anything larger', sample: '1000000' },
    paybill_name: { group: 'Giving', label: 'Fallback account name', where: 'Only when online giving is off and a purpose has no number of its own', sample: 'Harvest Family Church' },
    paybill_number: { group: 'Giving', label: 'Fallback Paybill / Till number', where: 'Only when online giving is off and a purpose has no number of its own', sample: '4505860' },
    giving_fallback_method: { group: 'Giving', label: 'Fallback M-Pesa method', where: 'Chooses whether the fallback above is a Paybill or a Till', sample: 'paybill' },
    giving_payment_methods: { group: 'Advanced (JSON)', label: 'Till / paybill per purpose', where: 'Where each purpose’s money goes — usually edited on Giving setup', sample: '{"tithe":{"method":"till","payment_number":"4505860"}}' },

    logo_url: { group: 'Images', label: 'Church logo link', where: 'Landing header, app nav and share cards', sample: 'https://…/logo.png' },
    landing_hero_url: { group: 'Images', label: 'Hero photo link', where: 'The picture inside the welcome card (not the background)', sample: 'https://…/hero.jpg' },
    landing_background_url: { group: 'Images', label: 'Background photos', where: 'Rotates behind the whole landing page — up to 8 links, comma separated', sample: 'https://…/one.jpg, https://…/two.jpg' },
    social_instagram_url: { group: 'Social links', label: 'Instagram profile', where: 'Instagram icon in the landing footer', sample: 'https://instagram.com/harvestfamily' },
    social_youtube_url: { group: 'Social links', label: 'YouTube channel', where: 'YouTube icon in the landing footer', sample: 'https://youtube.com/@harvestfamily' },
    social_tiktok_url: { group: 'Social links', label: 'TikTok profile', where: 'TikTok icon in the landing footer', sample: 'https://tiktok.com/@harvestfamily' },

    giving_funds: { group: 'Advanced (JSON)', label: 'Giving purposes', where: 'The list of funds members choose from — usually edited on Giving setup', sample: '[{"id":"tithe","label":"Tithe","sub":"10% of income","icon":"10"}]' },
    giving_quick: { group: 'Advanced (JSON)', label: 'Quick amount buttons', where: 'The amount shortcuts on the Give screen — usually edited on Giving setup', sample: '[50,100,250,500,1000,5000]' },

    sponsor_adverts: { group: 'Advanced (JSON)', label: 'Sponsored adverts', where: 'Posts interleaved in the home feed — usually edited on Adverts', sample: '[{"id":"bookshop","title":"Harvest Bookshop","body":"Bibles at the entrance","enabled":true}]' },
    advert_settings: { group: 'Advanced (JSON)', label: 'Advert placement', where: 'How often an advert appears in the feed — usually edited on Adverts', sample: '{"placement":"feed","interval":6,"daily_cap":2}' },
  }
  const contentGroupOf = (key: string): ContentGroup => CONTENT_GUIDE[key]?.group || 'Everything else'

  // Funds and quick amounts are edited as real rows (GivingFundsEditor), never
  // as JSON in a textarea. Both write into the same draft as every other field.
  const adminFunds = parseFunds(contentValue('giving_funds'))
  const adminQuick = parseQuick(contentValue('giving_quick'))
  // Where each purpose's money goes (till / paybill / bank), keyed by fund id.
  const adminPayments = parsePayments(contentValue('giving_payment_methods'))
  // ── Sponsored adverts in the Home feed ──
  // Stored as JSON in site_content; the feed worker interleaves them and caps
  // appearances per member per day, so saving here goes live on next refresh.
  const advertsJson = (() => { try { return JSON.stringify(JSON.parse(content.sponsor_adverts || '[]'), null, 2) } catch { return (content.sponsor_adverts || '[]') } })()
  const settingsJson = (() => { try { return JSON.stringify(JSON.parse(content.advert_settings || '{}'), null, 2) } catch { return (content.advert_settings || '{}') } })()
  const [advertsDraft, setAdvertsDraft] = useState<string | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<string | null>(null)
  const [advertConfirm, setAdvertConfirm] = useState(false)
  // Friendly advert controls write the same JSON the server already validates.
  // The raw JSON stays behind an Advanced disclosure for power users only.
  const advertSettings = (() => {
    try {
      const parsed = JSON.parse(settingsDraft ?? settingsJson)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      return {
        placement: parsed.placement === 'none' ? 'none' : 'feed',
        interval: Math.min(20, Math.max(3, Number(parsed.interval) || 6)),
        daily_cap: Math.min(10, Math.max(1, Number(parsed.daily_cap) || 2)),
      }
    } catch { return { placement: 'feed', interval: 6, daily_cap: 2 } }
  })()
  const setAdvertSetting = (patch: Partial<typeof advertSettings>) => {
    setSettingsDraft(JSON.stringify({ ...advertSettings, ...patch }, null, 2))
    setAdvertConfirm(false)
  }
  const advertsList = (() => {
    try {
      const parsed = JSON.parse(advertsDraft ?? advertsJson)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  })()
  const setAdvertsList = (list: any[]) => {
    setAdvertsDraft(JSON.stringify(list, null, 2))
    setAdvertConfirm(false)
  }
  const updateAdvert = (index: number, patch: Record<string, unknown>) => {
    setAdvertsList(advertsList.map((advert: any, i: number) => i === index ? { ...advert, ...patch } : advert))
  }
  // Photo composer: adverts should be made with a picture, not a pasted URL.
  const [adTitle, setAdTitle] = useState('')
  const [adBody, setAdBody] = useState('')
  const [adCta, setAdCta] = useState('')
  const [adPhoto, setAdPhoto] = useState<File | null>(null)
  const [adBusy, setAdBusy] = useState(false)
  const addAdvertWithPhoto = async () => {
    if (adBusy) return
    if (!adTitle.trim()) { setError('Give the advert a title'); return }
    if (!adPhoto) { setError('Choose a photo for this advert'); return }
    setError('')
    setAdBusy(true)
    const photo = adPhoto
    const res = await runAction('Uploading advert photo', async () => {
      const pre = await presign({
        type: 'post',
        contentType: photo.type || 'image/jpeg',
        bytes: photo.size,
        ext: (photo.name.split('.').pop() || 'jpg').toLowerCase(),
      })
      await uploadToMinio(pre.url, pre.fields, photo)
      return pre.key
    }, 'Photo uploaded')
    if (!res.ok || !res.data) {
      setError(res.error?.message || 'Could not upload the photo')
      setAdBusy(false)
      return
    }
    let current: any[] = []
    try { current = JSON.parse((advertsDraft ?? advertsJson) || '[]') } catch { current = [] }
    const baseSlug = adTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    const id = baseSlug || `advert-${Date.now()}`
    const next = [...current, {
      id: current.some(a => a?.id === id) ? `${id}-${Date.now().toString(36).slice(-4)}` : id,
      title: adTitle.trim().slice(0, 80),
      body: adBody.trim().slice(0, 400),
      image_key: res.data,
      cta_url: adCta.trim() || window.location.origin,
      enabled: true,
    }]
    setAdvertsDraft(JSON.stringify(next, null, 2))
    setAdvertConfirm(false)
    setAdTitle(''); setAdBody(''); setAdCta(''); setAdPhoto(null)
    flash('Advert added — press Save below to publish it')
    setAdBusy(false)
  }
  useEffect(() => {
    fetch(`${API}/api/content`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        setContent(d?.content || {})
        if (d?.editable && typeof d.editable === 'object') setEditable(d.editable)
        if (Number(d?.customLimit) > 0) setCustomLimit(Number(d.customLimit))
      })
      .catch(() => { /* empty form is fine — placeholders show defaults */ })
  }, [])
  const saveContent = async (extra?: Record<string, string>) => {
    if (contentBusy) return
    // Send only what actually changed. The old panel PUT the whole content map
    // on every save; once the church had more than 40 copy rows the worker
    // rejected the request outright, which is why admin edits never landed.
    const draft: Record<string, string> = { ...(contentDraft || {}), ...(extra || {}) }
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => String(content[k] ?? '') !== String(v)))
    if (!Object.keys(changed).length) { flash('Nothing has changed yet'); return }
    setContentBusy(true)
    setError('')
    const res = await runAction('Saving changes', async () => {
      const r = await fetch(`${API}/api/content`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
      return d
    }, 'Saved — live for everyone')
    if (res.ok) {
      const d: any = res.data
      setContent(d.content || {})
      if (d.editable) setEditable(d.editable)
      setAdvertsDraft(null); setSettingsDraft(null); setContentDraft(null)
      flash(`Saved ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? '' : 's'} — live for everyone`)
      // Screens already mounted (Home, Give…) hold the content they loaded at
      // startup. Announce the new values so they repaint without a reload.
      if (d?.content) window.dispatchEvent(new CustomEvent('harvest:content-updated', { detail: d.content }))
    } else {
      setError(res.error?.message || 'Could not save')
    }
    setContentBusy(false)
  }

  // ── Announce state ──
  const [annText, setAnnText] = useState('')
  const [annGroup, setAnnGroup] = useState<string>('')
  const [annBusy, setAnnBusy] = useState(false)
  const [annCount, setAnnCount] = useState<number | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true); setError('')
    try {
      // apiGet bounds each request and retries once, so one lost packet cannot
      // hang the whole dashboard on a spinner (Promise.all waits for all).
      const [p,u,g,d,feed,ch,a,h] = await Promise.all([
        apiGet<any>('/api/pending?status=pending'),
        apiGet<any>('/api/users/map'),
        apiGet<any>('/api/groups'),
        apiGet<any>('/api/departments'),
        apiGet<any>('/api/feed?limit=8'),
        apiGet<any>('/api/chat/conversations'),
        apiGet<any>('/api/admin/audit?limit=8'),
        apiGet<any>('/api/admin/health').catch(() => null),
      ])
      setDashboard({
        pending: (p.pending || []).length,
        members: (u.users || []).filter((member: any) => {
          const created = member.created_at ? new Date(member.created_at).getTime() : 0
          return created > Date.now() - 7 * 24 * 60 * 60 * 1000
        }).length,
        online: (u.users || []).filter((member: any) => member.online).length,
        verified: (u.users || []).filter((member: any) => member.verified).length,
        groups: (g.groups || []).length,
        departments: (d.departments || []).length,
        content: (feed.posts || feed.items || feed.reels || []).slice(0, 8),
        chats: (ch.team_conversations || []).slice(0, 8),
        audit: (a.audit || []).slice(0, 8),
        health: h,
      })
    } catch (e: any) { setError(e?.message || 'Unable to load dashboard') } finally { setLoadingDashboard(false) }
  }, [])

  const loadPending = useCallback(async () => {
    if (!USE_API) { setPending([]); return }
    try {
      setError('')
      const data = await apiGet<any>(`/api/pending?status=${status}`)
      setPending(data.pending || [])
    } catch (e: any) {
      setError(e?.message || 'Unable to load moderation queue')
    }
  }, [status])

  // The directory App already loaded is the same member data, so the panel can
  // paint immediately instead of showing a spinner until a second copy arrives.
  useEffect(() => {
    if (!accounts.length && users?.length) setAccounts(users)
  }, [users, accounts.length])

  const accountsRequest = useRef(0)
  const accountsBusy = useRef(false)
  const loadAccounts = useCallback(async () => {
    if (accountsBusy.current) return
    if (!USE_API) { setLoadingAccounts(false); return }
    accountsBusy.current = true
    const request = ++accountsRequest.current
    setLoadingAccounts(true)
    try {
      setError('')
      // Members render the moment they arrive. The ministry list only powers
      // the per-member select and the ministries tab, so waiting for it here
      // kept the whole Members panel on "Loading members…" whenever the
      // slower departments call stalled or retried.
      const data = await apiGet<any>('/api/users/map')
      if (request !== accountsRequest.current) return
      setAccounts(data.users || [])
      setLoadingAccounts(false)
      const deps = await apiGet<any>('/api/departments').catch(() => ({ departments: [] }))
      if (request !== accountsRequest.current) return
      setDepartments(deps.departments || [])
    } catch (e: any) {
      if (request !== accountsRequest.current) return
      setError(e?.message || 'Unable to load accounts')
      setLoadingAccounts(false)
    } finally { accountsBusy.current = false }
  }, [])

  const loadChatConversations = useCallback(async () => {
    setLoadingChats(true); setError('')
    try {
      const d = await apiGet<any>('/api/chat/conversations')
      const team = (d.conversations || []).filter((x: any) => x.key?.startsWith('group:') || x.key?.startsWith('department:'))
      setChatConversations(team)
      if (!selectedChat && team[0]?.key) setSelectedChat(team[0].key)
    } catch (e: any) { setError(e?.message || 'Unable to load conversations') } finally { setLoadingChats(false) }
  }, [selectedChat])

  const loadChatMessages = useCallback(async () => {
    if (!selectedChat) return
    setLoadingChatMessages(true); setError('')
    try {
      const prefix = selectedChat.startsWith('group:') ? 'group' : 'department'
      const slug = selectedChat.slice(prefix.length + 1)
      const d = await apiGet<any>('/api/chat/history?' + prefix + '=' + encodeURIComponent(slug) + '&limit=100')
      setChatMessages(d.messages || [])
    } catch (e: any) { setError(e?.message || 'Unable to load messages') } finally { setLoadingChatMessages(false) }
  }, [selectedChat])

  const loadAudit = useCallback(async () => {
    if (!USE_API) return
    setLoadingAudit(true)
    try {
      setError('')
      const data = await apiGet<any>('/api/admin/audit?limit=60')
      setAudit(data.audit || [])
    } catch (e: any) {
      setError(e?.message || 'Unable to load audit log')
    } finally { setLoadingAudit(false) }
  }, [])

  const loadHealth = useCallback(async () => {
    if (!USE_API) return
    setLoadingHealth(true)
    try {
      setError('')
      const data = await apiGet<any>('/api/admin/health')
      setHealth({ status: data.status || 'error', checked_at: data.checked_at, checks: data.checks || [] })
    } catch (e: any) {
      setError(e?.message || 'Unable to run operational checks')
      setHealth(null)
    } finally { setLoadingHealth(false) }
  }, [])

  const loadDevices = useCallback(async () => {
    if (!USE_API) return
    setLoadingDevices(true)
    try {
      setError('')
      const data = await apiGet<any>('/api/auth/admin/devices')
      setDevices(Array.isArray(data.devices) ? data.devices : [])
      setDeviceLimit(Number(data.limit) || 2)
    } catch (e: any) {
      setError(e?.message || 'Unable to load signed-in devices')
    } finally { setLoadingDevices(false) }
  }, [])

  const signOutDevice = async (id: string) => {
    if (busy) return
    setBusy(`device:${id}`); setError('')
    try {
      const response = await fetch(`${API}/api/auth/admin/devices/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token()}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not sign that device out')
      if (Array.isArray(data.devices)) setDevices(data.devices)
      setRevokeDevice(null)
      flash('Device signed out')
    } catch (e: any) {
      setError(e?.message || 'Could not sign that device out')
    } finally { setBusy(null) }
  }

  // The hero counters must be real on arrival, not zero until Overview is
  // visited for the first time.
  useEffect(() => { void loadDashboard() }, [loadDashboard])

  useEffect(() => {
    if (tab === 'dashboard') void loadDashboard()
    if (tab === 'moderation') void loadPending()
    if (tab === 'accounts' || tab === 'ministries') void loadAccounts()
    if (tab === 'chat') void loadChatConversations()
    if (tab === 'chat') void loadChatMessages()
    if (tab === 'audit') void loadAudit()
    if (tab === 'devices') void loadDevices()
    if (tab === 'support') void loadHealth()
  }, [tab, loadDashboard, loadPending, loadAccounts, loadChatConversations, loadChatMessages, loadAudit, loadDevices, loadHealth])

  // Dashboard counts go stale when a group is created/deleted elsewhere —
  // re-pull whenever the groups table changes.
  useEffect(() => {
    const onGroupsChanged = () => { if (tab === 'dashboard') void loadDashboard() }
    window.addEventListener('harvest:groups-changed', onGroupsChanged)
    return () => window.removeEventListener('harvest:groups-changed', onGroupsChanged)
  }, [tab, loadDashboard])

  const moderate = async (id: string, action: 'approve' | 'reject') => {
    if (busy) return
    setBusy(id); setError('')
    try {
      const body = action === 'reject' ? { reason: 'Rejected by Harvest admin' } : undefined
      const response = await fetch(`${API}/api/pending/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `Unable to ${action} media`)
      setPending(items => items.filter(item => String(item.id) !== String(id)))
      flash(action === 'approve' ? 'Published to the church feed' : 'Rejected')
      window.dispatchEvent(new Event('harvest:approved'))
    } catch (e: any) {
      setError(e?.message || `Unable to ${action} media`)
    } finally { setBusy(null) }
  }

  const cleanup = async () => {
    if (cleanupBusy) return
    setCleanupBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/pending/cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Cleanup failed')
      flash('Orphaned uploads cleaned')
      await loadPending()
    } catch (e: any) {
      setError(e?.message || 'Cleanup failed')
    } finally { setCleanupBusy(false) }
  }

  const patchUser = async (username: string, body: Record<string, any>) => {
    if (busy) return
    setBusy(username); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Update failed')
      const updated = data.user
      setAccounts(list => list.map(u => u.username === username ? { ...u, ...updated } : u))
      setUsers(users.map(u => u.username === username ? { ...u, verified: updated.verified, role: updated.role, group: updated.group_name } : u))
      flash(`${username} updated`)
    } catch (e: any) {
      setError(e?.message || 'Unable to update account')
    } finally { setBusy(null) }
  }

  const createUser = async () => {
    if (busy) return
    const uname = newUser.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (!uname || !newUser.name.trim() || !/^\d{4,6}$/.test(newUser.pin.trim())) {
      setError('Username, full name and a 4–6 digit PIN are required')
      return
    }
    setBusy('create'); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ username: uname, name: newUser.name.trim(), pin: newUser.pin.trim(), role: 'member', group_name: newUser.group_name }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to create account')
      setNewUser({ username: '', name: '', pin: '', group_name: GROUPS[0] })
      setShowCreate(false)
      flash(`Account ${uname} created — share the PIN privately`)
      await loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Unable to create account')
    } finally { setBusy(null) }
  }

  const restoreUser = async () => {
    const uname = restoreName.trim().toLowerCase()
    if (!uname || busy) return
    setBusy('restore'); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(uname)}/restore`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Restore failed')
      setRestoreName('')
      flash(`${uname} restored`)
      await loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Restore failed')
    } finally { setBusy(null) }
  }

  const moderateChatMessage = async (message: any) => {
    if (busy || !message?.id) return
    if (!window.confirm('Remove this message for everyone?')) return
    setBusy(String(message.id)); setError('')
    try {
      const r = await fetch(API + '/api/chat/messages/' + encodeURIComponent(message.id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token() } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Unable to remove message')
      setChatMessages(list => list.map(x => String(x.id) === String(message.id) ? { ...x, deleted_at: new Date().toISOString(), text: 'This message was deleted' } : x))
      flash('Message removed for everyone')
    } catch (e: any) { setError(e?.message || 'Unable to remove message') } finally { setBusy(null) }
  }

  const sendAnnounce = async () => {
    const text = annText.trim()
    if (annBusy) return
    if (text.length < 2) { setError('Write the announcement first (at least 2 characters)'); return }
    const scope = annGroup || 'ALL members'
    if (!window.confirm(`Send this announcement to ${scope}?\n\n${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`)) return
    setAnnBusy(true); setError('')
    try {
      const response = await fetch(`${API}/api/admin/announce`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, ...(annGroup ? { target_group: annGroup } : {}) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Announce failed')
      setAnnCount(data.recipients || 0)
      setAnnText('')
      setAnnGroup('')
      flash(`Delivered to ${data.recipients} member${data.recipients === 1 ? '' : 's'}`)
    } catch (e: any) {
      setError(e?.message || 'Announce failed')
    } finally { setAnnBusy(false) }
  }

  const removeUser = async (username: string) => {
    if (busy) return
    setBusy(username); setError('')
    try {
      const response = await fetch(`${API}/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Delete failed')
      setAccounts(list => list.filter(u => u.username !== username))
      flash(`${username} deleted`)
    } catch (e: any) {
      setError(e?.message || 'Delete failed')
    } finally { setBusy(null) }
  }

  const filteredAccounts = accounts.filter(u => {
    const needle = q.trim().toLowerCase()
    if (needle && !`${u.username} ${u.name} ${u.group_name} ${u.department_name || ''}`.toLowerCase().includes(needle)) return false
    if (accountFilter === 'verified') return Boolean(u.verified)
    if (accountFilter === 'admin') return u.role === 'admin'
    if (accountFilter === 'inactive') return u.active === false
    return true
  })

  // Move a member between ministries (or out of every ministry). The admin API
  // treats a transfer as authoritative, so this works even when the member was
  // already serving somewhere else.
  const changeMinistry = async (u: any, slug: string) => {
    if (busy) return
    if ((u.department_slug || '') === slug) return
    setBusy(u.username); setError('')
    try {
      if (!slug) {
        const r = await fetch(`${API}/api/departments/${encodeURIComponent(u.department_slug)}/members/${encodeURIComponent(u.username)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token()}` },
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not remove ministry')
      } else {
        const r = await fetch(`${API}/api/departments/${encodeURIComponent(slug)}/members`, {
          method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u.username, role: 'member' }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not change ministry')
      }
      const dep = departments.find((x: any) => x.slug === slug)
      setAccounts(list => list.map(x => x.username === u.username ? { ...x, department_slug: slug || null, department_name: dep?.name || null } : x))
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`${u.username} is now in ${dep?.name || 'no ministry'}`)
      // Refresh the ministry counts in the background (the member row already
      // updated optimistically above, so nothing flickers).
      void loadAccounts()
    } catch (e: any) {
      setError(e?.message || 'Could not change ministry')
    } finally { setBusy(null) }
  }

  const createMinistry = async () => {
    const name = newMinistry.trim()
    if (!name || busy === 'ministry-create') return
    setBusy('ministry-create'); setError('')
    try {
      const r = await fetch(`${API}/api/departments`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not create ministry')
      setNewMinistry('')
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry “${name}” created`)
    } catch (e: any) { setError(e?.message || 'Could not create ministry') } finally { setBusy(null) }
  }

  const renameMinistry = async (dep: any) => {
    const name = (ministryNames[dep.slug] ?? dep.name ?? '').trim()
    if (!name || name === dep.name || busy === `ministry-${dep.slug}`) return
    setBusy(`ministry-${dep.slug}`); setError('')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(dep.slug)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not rename ministry')
      setMinistryNames(prev => { const next = { ...prev }; delete next[dep.slug]; return next })
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry renamed to “${name}”`)
    } catch (e: any) { setError(e?.message || 'Could not rename ministry') } finally { setBusy(null) }
  }

  const toggleMinistryVisibility = async (dep: any) => {
    if (busy === `ministry-vis-${dep.slug}`) return
    const next = !dep.is_public
    setBusy(`ministry-vis-${dep.slug}`); setError('')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(dep.slug)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not change ministry visibility')
      setDepartments(list => list.map(x => x.slug === dep.slug ? { ...x, is_public: next } : x))
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`“${dep.name}” is now ${next ? 'visible in' : 'hidden from'} the ministry directory`)
    } catch (e: any) { setError(e?.message || 'Could not change ministry visibility') } finally { setBusy(null) }
  }

  const deleteMinistry = async (dep: any) => {
    if (busy === `ministry-del-${dep.slug}`) return
    if (!window.confirm(`Delete the ministry “${dep.name}”? Members are released from it and this cannot be undone.`)) return
    setBusy(`ministry-del-${dep.slug}`); setError('')
    try {
      const r = await fetch(`${API}/api/departments/${encodeURIComponent(dep.slug)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not delete ministry')
      await loadAccounts()
      window.dispatchEvent(new Event('harvest:departments-updated'))
      flash(`Ministry “${dep.name}” deleted`)
    } catch (e: any) { setError(e?.message || 'Could not delete ministry') } finally { setBusy(null) }
  }

  // Pagination: render one page of member cards at a time. Rendering the full
  // directory (each card = 10+ controls) janks past a few hundred members on
  // low-end phones. Page size 30 keeps scroll weight bounded; search and
  // pagination compose (page resets to 1 on query change).
  const ACCOUNTS_PAGE_SIZE = 30
  const [accountsPage, setAccountsPage] = useState(1)
  const accountsPages = Math.max(1, Math.ceil(filteredAccounts.length / ACCOUNTS_PAGE_SIZE))
  const safeAccountsPage = Math.min(accountsPage, accountsPages)
  const pagedAccounts = filteredAccounts.slice((safeAccountsPage - 1) * ACCOUNTS_PAGE_SIZE, safeAccountsPage * ACCOUNTS_PAGE_SIZE)
  // Reset to the first page whenever the search or filter changes. Without the
  // filter dependency a page from the previous view could stay selected; the
  // safe page clamped the rows, but Prev still looked active and needed several
  // taps before the visible page moved.
  useEffect(() => { setAccountsPage(1) }, [q, accountFilter])

  return (
    <div className="min-h-[70vh] bg-surface text-ink" data-testid="admin-shell">
      {/* ── Hero ── */}
      <header className="relative overflow-hidden border-b border-line bg-ink px-4 pb-4 pt-4 text-white">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-start gap-3">
          <button onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-white" aria-label="Back to profile">
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-gold">Harvest admin</p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">Control centre</h1>
            <p className="mt-1 text-xs text-white/60">People, ministries, content, money and messages — saved changes publish immediately.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateMenu(open => !open)}
            aria-expanded={createMenu}
            aria-haspopup="menu"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-gold px-3 text-2xs font-extrabold text-[#2b1c0b]"
          >
            <Icon name="plus" size={14} /> Create
          </button>
        </div>
        {createMenu && (
          <div role="menu" aria-label="Create" className="relative z-10 mt-3 grid gap-1.5 rounded-2xl border border-white/15 bg-[#191222] p-2 shadow-xl sm:grid-cols-2">
            {([
              ['Announcement', 'Send or schedule a church announcement', () => setTab('announce')],
              ['Sermon', 'Upload and publish a sermon', () => onOpenSermons?.()],
              ['Event', 'Create a church event on the schedule', () => setTab('publishing')],
              ['Homepage banner', 'Update a welcome or promotional banner', () => setTab('home')],
              ['Member account', 'Create a member account', () => { setTab('accounts'); setShowCreate(true) }],
              ['Giving purpose', 'Add or edit a giving purpose', () => setTab('give')],
            ] as [string, string, () => void][]).map(([label, hint, action]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={() => { setCreateMenu(false); action() }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-white transition active:scale-[0.99]"
              >
                <span className="block text-2xs font-extrabold">{label}</span>
                <span className="mt-0.5 block text-[10px] text-white/55">{hint}</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setTab('moderation')} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums">{dashboard.pending}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/60">Awaiting review</p>
          </button>
          <button type="button" onClick={() => setTab('accounts')} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums">{accounts.length || users.length}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/60">Members</p>
          </button>
          <button type="button" onClick={() => onOpenMap?.()} className="rounded-2xl border border-success/30 bg-success/15 px-3 py-2.5 text-left backdrop-blur">
            <p className="text-xl font-extrabold leading-none tabular-nums text-emerald-300">{dashboard.online}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200/70">Active now</p>
          </button>
        </div>
      </header>

      {/* ── Six destinations ── */}
      <nav className="sticky top-0 z-20 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur" data-testid="admin-nav" aria-label="Administration destinations">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="tablist" aria-label="Administration destinations">
          {WORKSPACES.map(w => {
            const active = workspaceOf(tab) === w.id
            return (
              <button
                key={w.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(w.sections[0][0])}
                className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-2xs font-extrabold transition ${active ? 'bg-ink text-white shadow-sm' : 'border border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
              >
                <Icon name={w.icon} size={15} className={active ? 'text-gold' : 'text-accent'} />
                <span className="min-w-0 truncate">{w.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <main className="space-y-4 p-4 pb-24">
        {/* One workspace at a time, with its own sub-sections. The universal
            pattern is list → select → detail → edit, and these pills only
            switch which list is open inside the same workspace. */}
        {(() => {
          const active = WORKSPACES.find(w => w.id === workspaceOf(tab)) || WORKSPACES[0]
          return (
            <div data-testid="admin-workspace">
              <h2 className="text-sm font-extrabold text-ink">{active.label}</h2>
              <p className="mt-0.5 text-2xs text-ink-muted">{active.blurb}</p>
              {active.sections.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label={`${active.label} sections`}>
                  {active.sections.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-2xs font-extrabold transition ${tab === value ? 'bg-ink text-white shadow-sm' : 'border border-line bg-surface-raised text-ink-muted hover:text-ink'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
        {error && <ErrorMessage message={error} />}
        {notice && <div role="status" className="rounded-2xl border border-success/30 bg-success-soft p-3 text-sm font-semibold text-success">{notice}</div>}
        {!USE_API && <div className="rounded-2xl border border-gold/40 bg-gold-soft p-4 text-sm">Admin tools require the server API. Enable VITE_USE_API=true in production.</div>}

        {/* ── Overview ── */}
        {tab === 'dashboard' && (
          <div className="space-y-3" data-testid="admin-dashboard">
            {loadingDashboard ? (
              <div className="rounded-card border border-line bg-surface-raised p-8 text-center text-sm text-ink-muted">Loading today’s operations…</div>
            ) : (
              <>
                {dashboard.health && dashboard.health.status !== 'ok' && (
                  <button type="button" onClick={() => setTab('support')} className="flex w-full items-center gap-3 rounded-card border border-danger/30 bg-danger-soft p-4 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger"><Icon name="shield" size={19} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-ink">Operational check needs attention</span>
                      <span className="block text-2xs text-ink-muted">Open Health & help for the exact service and safe next action.</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="shrink-0 text-danger" />
                  </button>
                )}

                {dashboard.pending > 0 && (
                  <button type="button" onClick={() => setTab('moderation')} className="flex w-full items-center gap-3 rounded-card border border-gold/40 bg-gold-soft p-4 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/20 text-gold-strong"><Icon name="alert" size={19} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-ink">{dashboard.pending} item{dashboard.pending === 1 ? '' : 's'} waiting for approval</span>
                      <span className="block text-2xs text-ink-muted">Members are waiting for their post to reach the church feed.</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="shrink-0 text-gold-strong" />
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['Awaiting review', dashboard.pending, 'moderation', 'alert'],
                    ['Verified members', dashboard.verified, 'accounts', 'check'],
                    ['New members · 7d', dashboard.members, 'accounts', 'users'],
                    ['Ministries', dashboard.departments, 'ministries', 'building'],
                  ] as const).map(([label, count, target, icon]) => (
                    <button key={label} type="button" onClick={() => setTab(target as Tab)} className="rounded-card border border-line bg-surface-raised p-4 text-left transition hover:border-accent/40 hover:bg-surface-sunken">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent-strong"><Icon name={icon} size={17} /></span>
                      <p className="mt-2 text-2xl font-extrabold leading-none tabular-nums">{count}</p>
                      <p className="mt-1 text-2xs font-bold text-ink-muted">{label}</p>
                    </button>
                  ))}
                </div>

                <div className="rounded-card border border-line bg-surface-raised p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-extrabold">Quick actions</h2>
                    <button onClick={() => void loadDashboard()} className="min-h-8 rounded-full px-2 text-2xs font-extrabold text-accent">Refresh</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => setTab('moderation')} className="min-h-11 rounded-xl bg-accent text-xs font-extrabold text-white">Review approvals</button>
                    <button onClick={() => setTab('accounts')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Manage members</button>
                    <button onClick={() => setTab('ministries')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Ministries</button>
                    <button onClick={() => onOpenMap?.()} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Live member map</button>
                    <button onClick={() => setTab('announce')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Send announcement</button>
                    <button onClick={() => setTab('content')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Church wording</button>
                    <button onClick={() => setTab('support')} className="min-h-11 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink">Health & help</button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <h2 className="mb-2 text-sm font-extrabold">Recent content</h2>
                    {dashboard.content.length ? dashboard.content.map((x: any) => (
                      <div key={x.id} className="border-b border-line py-2 last:border-0">
                        <p className="truncate text-xs font-bold">{x.caption || x.title || x.username || 'Content'}</p>
                        <p className="text-[10px] text-ink-muted">{x.type || 'post'} · {x.created_at ? timeAgo(x.created_at) : ''}</p>
                      </div>
                    )) : <p className="py-3 text-xs text-ink-muted">No recent content.</p>}
                  </div>
                  <div className="rounded-card border border-line bg-surface-raised p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-extrabold">Recent admin actions</h2>
                      <button onClick={() => setTab('audit')} className="text-2xs font-extrabold text-accent">View all</button>
                    </div>
                    {dashboard.audit.length ? dashboard.audit.map((x: any) => (
                      <div key={x.id} className="border-b border-line py-2 last:border-0">
                        <p className="text-xs font-bold capitalize">{String(x.action || '').replace(/_/g, ' ')}</p>
                        <p className="text-[10px] text-ink-muted">{x.actor_username || 'system'} → {x.target_type} · {new Date(x.created_at).toLocaleString()}</p>
                      </div>
                    )) : <p className="py-3 text-xs text-ink-muted">No admin actions recorded yet.</p>}
                  </div>
                </div>

                <div className="rounded-card border border-line bg-surface-raised p-4">
                  <h2 className="mb-2 text-sm font-extrabold">Recent chat activity</h2>
                  {dashboard.chats.length ? dashboard.chats.map((x: any) => (
                    <div key={x.conversation_key} className="border-b border-line py-2 last:border-0">
                      <p className="text-xs font-bold">{x.name}</p>
                      <p className="truncate text-[10px] text-ink-muted">{x.last_from ? '@' + x.last_from + ' · ' : ''}{x.last_text || 'No messages'} · {x.unread || 0} unread</p>
                    </div>
                  )) : <p className="py-3 text-xs text-ink-muted">No recent team chat activity.</p>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Members ── */}
        {tab === 'accounts' && (
          <div className="space-y-3" data-testid="admin-accounts">
            <div className="rounded-card border border-line bg-surface-raised p-3">
              <div className="flex gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
                  <Icon name="search" size={16} className="shrink-0 text-ink-subtle" />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Search name, username or ministry…"
                    aria-label="Search members"
                    className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
                  />
                </div>
                <button onClick={() => setShowCreate(v => !v)} className="min-h-11 shrink-0 rounded-xl bg-accent px-3.5 text-xs font-extrabold text-white">
                  {showCreate ? 'Close' : '＋ New'}
                </button>
              </div>
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {([
                  ['all', `All ${accounts.length}`],
                  ['verified', `Verified ${accounts.filter(u => u.verified).length}`],
                  ['admin', 'Admins'],
                  ['inactive', 'Inactive'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setAccountFilter(value)}
                    className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${accountFilter === value ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {showCreate && (
              <div className="space-y-2 rounded-card border border-line bg-surface-raised p-4">
                <p className="text-sm font-extrabold">Create member account</p>
                <p className="text-2xs text-ink-muted">Share the PIN privately. New accounts start unverified until you verify them.</p>
                <div className="flex gap-2">
                  <input value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} placeholder="username" aria-label="New member username" className="input-base min-w-0 flex-1" />
                  <input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Full name" aria-label="New member full name" className="input-base min-w-0 flex-1" />
                </div>
                <div>
                  <input value={newUser.pin} onChange={e => setNewUser(u => ({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="PIN (4–6 digits)" inputMode="numeric" aria-label="New member PIN" className="input-base" />
                  <p className="mt-1 text-[10px] text-ink-muted">New accounts join as members. Give ministry powers after they sign in — there is only one admin account.</p>
                </div>
                <select value={newUser.group_name} onChange={e => setNewUser(u => ({ ...u, group_name: e.target.value }))} aria-label="New member congregation" className="input-base">
                  {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <button onClick={() => void createUser()} disabled={busy === 'create'} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">
                  {busy === 'create' ? 'Creating…' : 'Create account'}
                </button>
              </div>
            )}

            {loadingAccounts && !accounts.length ? (
              <p className="py-10 text-center text-sm text-ink-muted">Loading members…</p>
            ) : filteredAccounts.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong"><Icon name="users" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">No members match this view</p>
                <p className="mt-1 text-xs text-ink-muted">Clear the search or pick another filter.</p>
              </div>
            ) : pagedAccounts.map(u => (
              <div key={u.username} className={`rounded-card border bg-surface-raised ${u.active === false ? 'border-danger/30 opacity-80' : 'border-line'}`}>
                <button onClick={() => setExpanded(expanded === u.username ? null : u.username)} aria-expanded={expanded === u.username} className="flex w-full items-center gap-3 p-3 text-left">
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-sm font-extrabold text-white">
                    {String(u.name || u.username || '?')[0].toUpperCase()}
                    {u.online && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface-raised bg-success" aria-label="Active now" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-sm font-extrabold">
                      <span className="truncate">{u.name || u.username}</span>
                      {u.verified && <VerifiedBadge size={17} />}
                    </span>
                    <span className="block truncate text-2xs text-ink-muted">@{u.username} · {u.group_name || 'No group'}{u.department_name ? ` · ${u.department_name}` : ''}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <span className={`badge ${u.verified ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-muted'}`}>{u.verified ? 'Verified' : 'Unverified'}</span>
                      {u.role === 'admin' && <span className="badge bg-accent-soft text-accent-strong">Admin</span>}
                      {u.active === false && <span className="badge bg-danger-soft text-danger">Inactive</span>}
                      {u.online && <span className="badge bg-success-soft text-success">Active now</span>}
                    </span>
                  </span>
                  <Icon name="chevron-down" size={16} className={`shrink-0 text-ink-subtle transition ${expanded === u.username ? 'rotate-180' : ''}`} />
                </button>

                {expanded === u.username && (
                  <div className="border-t border-line p-3">
                    <div className="space-y-3">
                      <div>
                        <label htmlFor={`ministry-${u.username}`} className="label-caps mb-1 block">Ministry / department</label>
                        <select
                          id={`ministry-${u.username}`}
                          data-testid="member-ministry"
                          value={u.department_slug || ''}
                          disabled={busy === u.username}
                          onChange={e => void changeMinistry(u, e.target.value)}
                          className="input-base"
                        >
                          <option value="">No ministry</option>
                          {departments.map((d: any) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
                        </select>
                        <p className="mt-1 text-[10px] text-ink-muted">Changing this transfers the member straight away — you do not need them to leave first.</p>
                      </div>

                      <div className="flex gap-2">
                        <select value={u.group_name || GROUPS[0]} onChange={e => void patchUser(u.username, { group_name: e.target.value })} disabled={busy === u.username} aria-label={`${u.username} congregation`} className="input-base min-w-0 flex-1">
                          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <div className="flex min-h-11 w-32 items-center justify-center rounded-xl border border-line bg-surface-sunken px-2 text-center text-[11px] font-extrabold text-ink-muted">
                          {u.role === 'admin' ? 'Account owner' : 'Member'}
                        </div>
                      </div>

                      {u.role !== 'admin' && (
                        <div>
                          <p className="label-caps mb-1.5">Leader powers</p>
                          <div className="flex flex-wrap gap-1.5">
                            {([
                              ['post_media', 'Post media'],
                              ['create_groups', 'Create groups'],
                              ['manage_groups', 'Manage groups'],
                              ['create_departments', 'Create departments'],
                              ['manage_communities', 'Manage communities'],
                              ['delete_media', 'Delete media'],
                              ['moderate_chat', 'Moderate chats'],
                              ['manage_sermons', 'Manage sermons'],
                            ] as const).map(([cap, label]) => {
                              const on = (u.grants || '').split(',').filter(Boolean).includes(cap)
                              return (
                                <button
                                  key={cap}
                                  disabled={busy === u.username}
                                  onClick={() => void patchUser(u.username, { grants: on ? (u.grants || '').split(',').filter((g: string) => g && g !== cap) : [...(u.grants || '').split(',').filter(Boolean), cap] })}
                                  className={`min-h-8 rounded-full px-2.5 text-[10px] font-extrabold ${on ? 'bg-accent text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                          <p className="mt-1.5 text-[10px] text-ink-muted">Sermon Manager gives full control of the Sermons tab; each other grant unlocks its own area.</p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                        <button
                          data-testid="member-verify"
                          disabled={busy === u.username}
                          onClick={() => void patchUser(u.username, { verified: !u.verified })}
                          className={`min-h-10 rounded-xl text-xs font-extrabold disabled:opacity-50 ${u.verified ? 'border border-line bg-surface-sunken text-ink-muted' : 'bg-accent text-white'}`}
                        >
                          {busy === u.username ? 'Saving…' : u.verified ? 'Remove verification' : 'Verify member'}
                        </button>
                        <button disabled={busy === u.username} onClick={() => void patchUser(u.username, { active: u.active === false })} className="min-h-10 rounded-xl border border-line bg-surface-sunken text-xs font-extrabold text-ink-muted disabled:opacity-50">{u.active === false ? 'Reactivate account' : 'Deactivate account'}</button>
                        {deleteConfirm === u.username ? (
                          <div className="flex min-h-10 items-center justify-center rounded-xl border border-danger/40 bg-danger-soft px-2 text-center text-[10px] font-extrabold text-danger">Confirm below</div>
                        ) : (
                          <button disabled={busy === u.username} onClick={() => setDeleteConfirm(u.username)} className="min-h-10 rounded-xl border border-danger/30 bg-danger-soft text-xs font-extrabold text-danger disabled:opacity-50">Delete permanently</button>
                        )}
                      </div>

                      <div className="rounded-xl border border-line bg-surface-sunken p-2.5">
                        <p className="label-caps mb-1.5">Reset sign-in PIN</p>
                        <div className="flex gap-2">
                          <input
                            value={pinResets[u.username] || ''}
                            onChange={e => setPinResets(p => ({ ...p, [u.username]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                            placeholder="New 4–6 digit PIN"
                            inputMode="numeric"
                            aria-label={`New PIN for ${u.username}`}
                            className="input-base min-w-0 flex-1"
                          />
                          <button
                            disabled={busy === u.username || !/^\d{4,6}$/.test(pinResets[u.username] || '')}
                            onClick={() => { const pin = pinResets[u.username]; void patchUser(u.username, { pin_reset: pin }); setPinResets(p => ({ ...p, [u.username]: '' })) }}
                            className="min-h-11 shrink-0 rounded-xl bg-accent px-3 text-xs font-extrabold text-white disabled:opacity-40"
                          >Set PIN</button>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">Use this when a member forgets their PIN. Share the new PIN privately; they can sign in with it immediately.</p>
                      </div>

                      {deleteConfirm === u.username && (
                        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft p-2.5">
                          <p className="min-w-0 flex-1 text-[11px] font-semibold leading-4 text-danger">Permanently delete @{u.username}? This removes the account and cannot be undone.</p>
                          <button onClick={() => setDeleteConfirm(null)} className="min-h-9 shrink-0 rounded-lg border border-line bg-surface-raised px-3 text-[11px] font-extrabold text-ink">Cancel</button>
                          <button disabled={busy === u.username} onClick={() => { setDeleteConfirm(null); void removeUser(u.username) }} className="min-h-9 shrink-0 rounded-lg bg-danger px-3 text-[11px] font-extrabold text-white disabled:opacity-50">Delete</button>
                        </div>
                      )}
                      <p className="text-[10px] text-ink-muted">Every change is written to the audit log. Verification unlocks posts, reels, music and sermon uploads.</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {!loadingAccounts && filteredAccounts.length > ACCOUNTS_PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between gap-3 px-1">
                <button onClick={() => setAccountsPage(Math.max(1, safeAccountsPage - 1))} disabled={safeAccountsPage <= 1} className="min-h-9 rounded-full border border-line bg-surface-raised px-4 text-xs font-extrabold text-ink-muted disabled:opacity-40">← Prev</button>
                <p className="text-xs font-semibold text-ink-muted">Page {safeAccountsPage} of {accountsPages}</p>
                <button onClick={() => setAccountsPage(Math.min(accountsPages, safeAccountsPage + 1))} disabled={safeAccountsPage >= accountsPages} className="min-h-9 rounded-full border border-line bg-surface-raised px-4 text-xs font-extrabold text-ink-muted disabled:opacity-40">Next →</button>
              </div>
            )}

            <div className="rounded-card border border-line bg-surface-raised p-4">
              <p className="text-sm font-extrabold">Restore a deactivated account</p>
              <p className="mt-1 text-xs text-ink-muted">Deactivated members cannot sign in until restored.</p>
              <div className="mt-2 flex gap-2">
                <input value={restoreName} onChange={e => setRestoreName(e.target.value)} placeholder="username" aria-label="Username to restore" className="input-base min-w-0 flex-1" />
                <button onClick={() => void restoreUser()} disabled={busy === 'restore'} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-50">{busy === 'restore' ? '…' : 'Restore'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Ministries ── */}
        {tab === 'ministries' && (
          <div className="space-y-3" data-testid="admin-ministries">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Ministry teams</h2>
              <p className="mt-1 text-xs text-ink-muted">Rename a ministry (for example to HYP), choose whether it appears in the member directory, create a new one, or delete one. Members keep their place when a ministry is renamed.</p>
              <div className="mt-3 flex gap-2">
                <input value={newMinistry} onChange={e => setNewMinistry(e.target.value)} placeholder="New ministry name" aria-label="New ministry name" className="input-base min-w-0 flex-1" />
                <button onClick={() => void createMinistry()} disabled={busy === 'ministry-create' || !newMinistry.trim()} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-extrabold text-white disabled:opacity-50">
                  {busy === 'ministry-create' ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>

            {loadingAccounts && !departments.length ? (
              <p className="py-10 text-center text-sm text-ink-muted">Loading ministries…</p>
            ) : !departments.length ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-10 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong"><Icon name="building" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">No ministries yet</p>
                <p className="mt-1 text-xs text-ink-muted">Create the first team above, then assign members from the Members tab.</p>
              </div>
            ) : departments.map((d: any) => (
              <div key={d.slug} className="rounded-card border border-line bg-surface-raised p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`ministry-rename-${d.slug}`} className="label-caps mb-1 block">Ministry name</label>
                    <input
                      id={`ministry-rename-${d.slug}`}
                      value={ministryNames[d.slug] ?? d.name ?? ''}
                      onChange={e => setMinistryNames(prev => ({ ...prev, [d.slug]: e.target.value }))}
                      className="input-base"
                    />
                    <p className="mt-1 text-[10px] text-ink-muted">{d.member_count} serving · {d.slug}</p>
                  </div>
                  <button
                    onClick={() => void renameMinistry(d)}
                    disabled={busy === `ministry-${d.slug}` || !String(ministryNames[d.slug] ?? d.name ?? '').trim() || (ministryNames[d.slug] ?? d.name) === d.name}
                    className="min-h-11 shrink-0 rounded-xl bg-ink px-3 text-xs font-extrabold text-white disabled:opacity-40"
                  >
                    {busy === `ministry-${d.slug}` ? 'Saving…' : 'Save name'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleMinistryVisibility(d)}
                    disabled={busy === `ministry-vis-${d.slug}`}
                    aria-pressed={d.is_public !== false}
                    className={`min-h-9 rounded-full border px-3 text-[10px] font-extrabold disabled:opacity-50 ${d.is_public !== false ? 'border-success/30 bg-success-soft text-success' : 'border-line bg-surface-sunken text-ink-muted'}`}
                  >
                    {busy === `ministry-vis-${d.slug}` ? 'Saving…' : d.is_public !== false ? 'Shown to members' : 'Hidden from members'}
                  </button>
                  <button onClick={() => void deleteMinistry(d)} disabled={busy === `ministry-del-${d.slug}`} className="min-h-9 rounded-full border border-danger/30 bg-danger-soft px-3 text-[10px] font-extrabold text-danger disabled:opacity-50">
                    {busy === `ministry-del-${d.slug}` ? 'Deleting…' : 'Delete ministry'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Approvals ── */}
        {tab === 'moderation' && (
          <div className="space-y-3" data-testid="admin-moderation">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(['pending', 'transcoding', 'rejected'] as const).map(value => (
                <button key={value} onClick={() => setStatus(value)} className={`min-h-9 shrink-0 rounded-full px-3.5 text-2xs font-extrabold capitalize ${status === value ? 'bg-ink text-white' : 'border border-line bg-surface-raised text-ink-muted'}`}>{value}</button>
              ))}
              <button onClick={() => void cleanup()} disabled={cleanupBusy} className="ml-auto min-h-9 shrink-0 rounded-full border border-line bg-surface-sunken px-3 text-2xs font-extrabold text-ink-muted disabled:opacity-50">
                {cleanupBusy ? 'Cleaning…' : 'Clean uploads'}
              </button>
            </div>
            {pending.length === 0 ? (
              <div className="rounded-card border border-line bg-surface-raised px-5 py-12 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success-soft text-success"><Icon name="check" size={22} /></span>
                <p className="mt-3 text-sm font-extrabold">Nothing {status}</p>
                <p className="mt-1 text-xs text-ink-muted">All caught up — new uploads appear here for review.</p>
              </div>
            ) : pending.map(item => (
              <div key={item.id} className="rounded-card border border-line bg-surface-raised p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="badge bg-accent-soft capitalize text-accent-strong">{item.type}</span>
                  <span className="text-[10px] text-ink-muted">{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm font-extrabold">{item.name || item.username || 'Harvest member'}</p>
                <p className="mt-1 text-sm text-ink-muted">{item.caption || 'No caption'}</p>
                {item.thumb_url && <img src={item.thumb_url} alt="Pending media" className="mt-3 max-h-72 w-full rounded-2xl bg-surface-sunken object-cover" />}
                {status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'approve')} className="min-h-11 flex-1 rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">{busy === String(item.id) ? 'Working…' : 'Approve & publish'}</button>
                    <button disabled={busy === String(item.id)} onClick={() => void moderate(String(item.id), 'reject')} className="min-h-11 flex-1 rounded-xl border border-danger/30 bg-danger-soft text-sm font-extrabold text-danger disabled:opacity-50">Reject</button>
                  </div>
                )}
                {status === 'rejected' && item.reject_reason && <p className="mt-3 text-xs text-danger">Reason: {item.reject_reason}</p>}
              </div>
            ))}
          </div>
        )}

        {/* ── Publishing calendar ── */}
        {tab === 'publishing' && <PublishingCalendar />}

        {/* ── Announce ── */}
        {tab === 'announce' && (
          <div className="space-y-3" data-testid="admin-announce">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Announce to members</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Lands as a direct message in every member’s chat with an unread badge. Members can reply straight back to you.</p>
              </div>
              <div>
                <label htmlFor="ann-group" className="label-caps mb-1 block">Audience</label>
                <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button onClick={() => setAnnGroup('')} className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${annGroup === '' ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}>All members</button>
                  {GROUPS.map(g => (
                    <button key={g} onClick={() => setAnnGroup(g)} className={`min-h-8 shrink-0 rounded-full px-3 text-2xs font-extrabold ${annGroup === g ? 'bg-ink text-white' : 'border border-line bg-surface-sunken text-ink-muted'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="ann-body" className="label-caps mb-1 block">Announcement</label>
                <textarea
                  id="ann-body"
                  value={annText}
                  onChange={e => setAnnText(e.target.value.slice(0, 2000))}
                  rows={5}
                  placeholder="e.g. Sunday service starts 9:00 AM at Harvest Central. Come with a friend!"
                  className="input-base resize-y"
                />
                <p className="mt-1 text-right text-[10px] text-ink-muted">{annText.length}/2000</p>
              </div>
              {annText.trim().length >= 2 && (
                <div className="rounded-xl border border-line bg-surface-sunken p-3">
                  <p className="label-caps">Preview</p>
                  <p className="mt-1 flex items-start gap-1.5 whitespace-pre-wrap break-words text-sm"><Icon name="bell" size={14} className="mt-0.5 shrink-0" />{annText.trim()}</p>
                </div>
              )}
              <button
                onClick={sendAnnounce}
                disabled={annBusy || annText.trim().length < 2}
                className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50"
              >
                {annBusy ? 'Sending…' : annGroup ? `Send to ${annGroup}` : 'Send to all members'}
              </button>
              {annCount !== null && <p className="flex items-center justify-center gap-1.5 text-center text-xs font-bold text-success"><Icon name="check" size={13} /> Last announcement delivered to {annCount} members</p>}
              {annText.trim().length >= 2 && (
                <button onClick={() => shareAnnouncementToWhatsApp(annText.trim())} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-extrabold text-white">
                  Share this on WhatsApp
                </button>
              )}
              <p className="text-[10px] text-ink-muted">Every send is recorded in the Audit tab. This reaches the whole church — use responsibly.</p>
            </div>
          </div>
        )}

        {/* ── Chats ── */}
        {tab === 'chat' && (
          <div className="space-y-3" data-testid="admin-chat">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Chat moderation</h2>
              <p className="mt-1 text-xs text-ink-muted">Review and remove messages from church group and department conversations.</p>
              {loadingChats ? <p className="py-4 text-xs">Loading conversations…</p> : (
                <select value={selectedChat} onChange={e => setSelectedChat(e.target.value)} aria-label="Conversation to moderate" className="input-base mt-3">
                  <option value="">Choose a conversation</option>
                  {chatConversations.map((x: any) => <option key={x.key} value={x.key}>{x.name || x.key}</option>)}
                </select>
              )}
            </div>
            {selectedChat && (loadingChatMessages ? <p className="py-8 text-center text-xs">Loading messages…</p> : chatMessages.length === 0 ? <p className="py-8 text-center text-xs text-ink-muted">No messages in this conversation.</p> : (
              <div className="space-y-2">
                {chatMessages.map((m: any) => (
                  <div key={m.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-raised p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-ink-muted">@{m.from} · {m.at || ''}</p>
                      <p className={m.deleted_at ? 'text-xs italic text-ink-subtle' : 'text-sm'}>{m.text}</p>
                    </div>
                    {!m.deleted_at && <button disabled={busy === String(m.id)} onClick={() => void moderateChatMessage(m)} className="min-h-9 shrink-0 rounded-xl border border-danger/30 bg-danger-soft px-3 text-xs font-extrabold text-danger">Remove</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Support and operational health ── */}
        {tab === 'support' && (
          <div className="space-y-3" data-testid="admin-support">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold">Health & help</h2>
                  <p className="mt-1 text-xs text-ink-muted">A read-only check of the systems the church app depends on. Nothing here changes data.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadHealth()}
                  disabled={loadingHealth}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 text-2xs font-extrabold text-ink-muted disabled:opacity-50"
                >
                  <Icon name="retry" size={14} /> {loadingHealth ? 'Checking…' : 'Run checks'}
                </button>
              </div>
              {health && (
                <div className={`mt-3 rounded-xl border p-3 ${health.status === 'ok' ? 'border-success/30 bg-success-soft' : health.status === 'warning' ? 'border-gold/40 bg-gold-soft' : 'border-danger/30 bg-danger-soft'}`}>
                  <p className={`text-xs font-extrabold ${health.status === 'ok' ? 'text-success' : health.status === 'warning' ? 'text-gold-strong' : 'text-danger'}`}>
                    {health.status === 'ok' ? 'Everything the app needs is working.' : health.status === 'warning' ? 'Some items need attention.' : 'A core service needs attention.'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-muted">Checked {health.checked_at ? new Date(health.checked_at).toLocaleString() : 'just now'} · counts contain no member data.</p>
                </div>
              )}
            </div>

            {loadingHealth && !health ? (
              <p className="py-10 text-center text-sm text-ink-muted">Running operational checks…</p>
            ) : health ? (
              <div className="space-y-2">
                {health.checks.map((check: any) => (
                  <div key={check.id} className="rounded-card border border-line bg-surface-raised p-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${check.status === 'ok' ? 'bg-success-soft text-success' : check.status === 'warning' ? 'bg-gold-soft text-gold-strong' : 'bg-danger-soft text-danger'}`}>
                        <Icon name={check.status === 'ok' ? 'check' : 'alert'} size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold">{check.label}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{check.detail}</p>
                        {check.action?.tab && (
                          <button
                            type="button"
                            onClick={() => setTab(check.action.tab as Tab)}
                            className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-full bg-ink px-3 text-2xs font-extrabold text-white"
                          >
                            {check.action.label || 'Open'} <Icon name="chevron-right" size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-line bg-surface-raised p-5 text-center">
                <p className="text-sm font-extrabold">Checks could not run</p>
                <p className="mt-1 text-xs text-ink-muted">The app could not reach the admin health endpoint. Check the connection and try again.</p>
                <button type="button" onClick={() => void loadHealth()} className="mt-3 min-h-10 rounded-xl bg-accent px-4 text-xs font-extrabold text-white">Try again</button>
              </div>
            )}

            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">If something stays red</h2>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-5 text-ink-muted">
                <li>Open the workflow linked above and retry the action once.</li>
                <li>Refresh this page. A recovered service should turn green on the next run.</li>
                <li>Do not repeatedly save money or publishing changes while the database is red.</li>
                <li>If it remains red, copy the diagnostic report and send it to the app maintainer.</li>
              </ol>
              <button
                type="button"
                disabled={!health}
                onClick={() => {
                  if (!health) return
                  const report = JSON.stringify({ status: health.status, checked_at: health.checked_at, checks: health.checks }, null, 2)
                  navigator.clipboard?.writeText(report)
                    .then(() => showToast('Diagnostic report copied — it contains status and counts only', 'success'))
                    .catch(() => showToast('Could not copy the report. Take a screenshot of this page instead.', 'error'))
                }}
                className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface-sunken px-3.5 text-xs font-extrabold text-ink disabled:opacity-40"
              >
                <Icon name="copy" size={15} /> Copy diagnostic report
              </button>
              <p className="mt-2 text-[10px] text-ink-subtle">The report contains service states and counts, never names, phone numbers, tokens or payment details.</p>
            </div>
          </div>
        )}

        {/* ── Audit ── */}
        {tab === 'audit' && (
          <div className="space-y-2" data-testid="admin-audit">
            {loadingAudit ? <p className="py-10 text-center text-sm text-ink-muted">Loading audit log…</p> : audit.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">No admin activity recorded yet.</p> : (
              <ol className="relative ml-3 border-l border-line pl-4">
                {audit.map(entry => (
                  <li key={entry.id} className="relative pb-4">
                    <span className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
                    <div className="rounded-xl border border-line bg-surface-raised px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-extrabold capitalize">{String(entry.action || '').replace(/_/g, ' ')}</p>
                        <span className="shrink-0 text-[10px] text-ink-muted">{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{entry.actor_username || 'system'} → {entry.target_type} {String(entry.target_id || '').slice(0, 8)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* ── Devices that hold an admin session ── */}
        {tab === 'devices' && (
          <div className="space-y-3" data-testid="admin-devices">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Devices signed in as admin</h2>
              <p className="mt-1 text-2xs text-ink-muted">
                The account trusts {deviceLimit} devices. Each phone or browser keeps one entry, even after signing
                out and back in — the same device is never listed twice. Signing one out here ends its session
                immediately, on its next request.
              </p>
            </div>
            {loadingDevices ? (
              <p className="py-10 text-center text-sm text-ink-muted">Checking devices…</p>
            ) : devices.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-muted">No devices are signed in.</p>
            ) : (
              <ul className="space-y-2">
                {devices.map(d => (
                  <li key={d.id} className="rounded-card border border-line bg-surface-raised p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Icon name={d.kind === 'mobile' ? 'phone' : 'globe'} size={14} className="shrink-0 text-ink-muted" />
                          <p className="truncate text-sm font-extrabold">{d.label}</p>
                          {d.current && (
                            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-accent-strong">This device</span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-ink-muted">
                          {d.kind === 'mobile' ? 'Phone' : 'Browser'}
                          {d.details?.screen ? ` · ${d.details.screen}` : ''}
                          {d.last_ip ? ` · ${d.last_ip}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-subtle">
                          Last used {timeAgo(d.last_seen_at) || 'unknown'} · added {d.created_at ? new Date(d.created_at).toLocaleDateString() : 'unknown'}
                        </p>
                      </div>
                      {!d.current && (
                        revokeDevice === d.id ? (
                          <div className="flex shrink-0 gap-1.5">
                            <button type="button" onClick={() => void signOutDevice(d.id)} disabled={busy === `device:${d.id}`} className="min-h-11 rounded-lg bg-danger px-3 text-xs font-extrabold text-white disabled:opacity-60">
                              {busy === `device:${d.id}` ? 'Signing out…' : 'Sign out'}
                            </button>
                            <button type="button" onClick={() => setRevokeDevice(null)} className="min-h-11 rounded-lg border border-line px-3 text-xs font-bold">Cancel</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setRevokeDevice(d.id)} className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-danger">
                            Sign out
                          </button>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Everything: every editable display string, one editor ── */}
        {tab === 'content' && (
          <div className="space-y-3" data-testid="admin-content">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Every word the church reads</h2>
              <p className="mt-1 text-2xs text-ink-muted">
                Every setting says what it changes, where members see it, and what is live right now. Fields are grouped
                by screen instead of listed as raw keys. One save publishes all of it.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5">
                <Icon name="search" size={16} className="text-ink-subtle" />
                <input value={contentQuery} onChange={e => setContentQuery(e.target.value)} placeholder="Find a setting, e.g. giving or chat" aria-label="Find a content setting" className="min-h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-subtle" />
                {contentDraft && <span className="shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-extrabold text-gold-strong">{Object.keys(contentDraft).length} edited</span>}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-ink-subtle">
                Tip: an empty field is not broken — the app then shows the wording it shipped with. “Live now” under a
                field is exactly what members are reading this second.
              </p>
            </div>

            {(() => {
              const allKeys = [...new Set([...Object.keys(editable), ...Object.keys(content), ...Object.keys(contentDraft || {})])]
              const needle = contentQuery.trim().toLowerCase()
              const order = Object.keys(CONTENT_GUIDE)
              const visible = allKeys.filter(k => {
                if (!needle) return true
                const guide = CONTENT_GUIDE[k]
                return `${k} ${guide?.label || ''} ${guide?.where || ''} ${guide?.group || ''}`.toLowerCase().includes(needle)
              })
              const groups = CONTENT_GROUPS
                .map(g => ({
                  ...g,
                  keys: visible
                    .filter(k => contentGroupOf(k) === g.title)
                    .sort((a, b) => {
                      const ai = order.indexOf(a), bi = order.indexOf(b)
                      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b)
                    }),
                }))
                .filter(g => g.keys.length)
              if (!groups.length) {
                return <p className="py-10 text-center text-sm text-ink-muted">No setting matches “{contentQuery.trim()}”. Clear the search to see everything.</p>
              }
              return (
                <div className="space-y-5">
                  {groups.map(group => (
                    <section key={group.title} className="space-y-2">
                      <div>
                        <h3 className="text-2xs font-extrabold uppercase tracking-[0.16em] text-ink-subtle">{group.title} <span className="font-bold normal-case tracking-normal text-ink-subtle">· {group.keys.length}</span></h3>
                        <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{group.blurb}</p>
                      </div>
                      {group.keys.map(k => {
                        const limit = editable[k] || customLimit
                        const value = contentValue(k)
                        const isJson = /^(giving_funds|giving_quick|giving_payment_methods|sponsor_adverts|advert_settings)$/.test(k)
                        return (
                          <AdminContentField
                            key={k}
                            id={`all-${k}`}
                            keyName={k}
                            guide={CONTENT_GUIDE[k]}
                            value={value}
                            saved={content[k] ?? ''}
                            limit={limit}
                            rows={isJson ? 5 : value.length > 90 ? 4 : 2}
                            mono={isJson}
                            onChange={v => setContentValue(k, v)}
                          />
                        )
                      })}
                    </section>
                  ))}
                </div>
              )
            })()}

            <div className="rounded-card border border-line bg-surface-raised p-3">
              <label htmlFor="new-content-key" className="text-2xs font-extrabold uppercase tracking-[0.12em] text-ink-muted">Add a new key</label>
              <div className="mt-2 flex gap-2">
                <input id="new-content-key" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="copy_new_heading" className="input-base min-w-0 flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    const k = newKey.trim().toLowerCase()
                    if (!/^(copy|app)_[a-z0-9_]{1,40}$/.test(k)) { setError('Custom keys must start with copy_ or app_ (a–z, 0–9, _)'); return }
                    setError('')
                    setContentValue(k, '')
                    setNewKey('')
                    flash(`${k} added — edit it above, then save`)
                  }}
                  className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-2xs font-extrabold text-white"
                >Add</button>
              </div>
              <p className="mt-1.5 text-[10px] text-ink-muted">Use this for new surfaces so no wording ever waits on a code change.</p>
            </div>

            <button onClick={() => void saveContent()} disabled={contentBusy} data-testid="admin-content-save" className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50">
              {contentBusy ? 'Saving…' : 'Save every change — live for everyone'}
            </button>
          </div>
        )}

        {/* ── Home text ── */}
        {tab === 'home' && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Home screen text</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Edits what every member sees at the top of the Community screen — the banner and the weekly encouragement. Changes go live immediately.</p>
              </div>
              {CONTENT_FIELDS.map(f => (
                <div key={f.key}>
                  <label htmlFor={`ct-${f.key}`} className="label-caps mb-1 block">{f.label}</label>
                  {f.key === 'pastor_usernames' ? (
                    <div>
                      <textarea id={`ct-${f.key}`} value={contentValue(f.key) || content.pastor_username || ''}
                        onChange={e => setContentValue('pastor_usernames', e.target.value.slice(0, f.max))}
                        rows={3} placeholder={f.hint}
                        className="input-base resize-y" />
                      <p className="mt-1 text-[10px] text-ink-muted">Use real usernames, not display names. Multiple pastors are supported.</p>
                    </div>
                  ) : f.textarea ? (
                    <textarea id={`ct-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} rows={2} placeholder={f.hint} className="input-base resize-y" />
                  ) : (
                    <input id={`ct-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} placeholder={f.hint} className="input-base" />
                  )}
                  <p className="mt-0.5 text-right text-[10px] text-ink-muted">{contentValue(f.key).length}/{f.max}</p>
                </div>
              ))}
              <div className="space-y-2 border-t border-line pt-3">
                <div>
                  <h3 className="text-sm font-extrabold">Church details and public information</h3>
                  <p className="mt-0.5 text-[10px] text-ink-muted">These are the details members see on the landing page and around the app. Leave a field empty to use the shipped wording.</p>
                </div>
                {CHURCH_FIELDS.map(f => (
                  <div key={f.key}>
                    <label htmlFor={`church-${f.key}`} className="label-caps mb-1 block">{f.label}</label>
                    {f.textarea ? (
                      <textarea id={`church-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} rows={3} placeholder={f.hint} className="input-base resize-y" />
                    ) : (
                      <input id={`church-${f.key}`} value={contentValue(f.key)} onChange={e => setContentValue(f.key, e.target.value.slice(0, f.max))} placeholder={f.hint} className="input-base" />
                    )}
                    <p className="mt-0.5 text-right text-[10px] text-ink-muted">{contentValue(f.key).length}/{f.max}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => void saveContent()} disabled={contentBusy} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
                {contentBusy ? 'Saving…' : 'Save home text — live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Clear a field to fall back to the shipped wording. Saved changes reach every open screen immediately.</p>
            </div>

            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4" data-testid="admin-brand-images">
              <div>
                <h2 className="text-sm font-extrabold">Church logo and landing photos</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Paste a public HTTPS image link. The hero photo and the page background photo are two different pictures and never swap: changing one does not change the other.</p>
              </div>
              <div>
                <label htmlFor="brand-logo-url" className="label-caps mb-1 block">Church logo URL</label>
                <input id="brand-logo-url" value={contentValue('logo_url')} onChange={e => setContentValue('logo_url', e.target.value.slice(0, 500))} placeholder="https://…/logo.png" inputMode="url" className="input-base" />
                {contentValue('logo_url') && (
                  <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-surface-sunken p-2">
                    <img src={contentValue('logo_url')} alt="Logo preview" className="h-12 w-12 rounded-xl border border-line object-contain" />
                    <p className="text-[10px] text-ink-muted">Preview — check the logo is clear on both light and dark backgrounds.</p>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="landing-hero-url" className="label-caps mb-1 block">Hero photo — inside the welcome card</label>
                <input id="landing-hero-url" value={contentValue('landing_hero_url')} onChange={e => setContentValue('landing_hero_url', e.target.value.slice(0, 500))} placeholder="https://…/hero.jpg" inputMode="url" className="input-base" />
                <p className="mt-1 text-[10px] text-ink-muted">The picture behind “A family to belong to.” Leave empty for the shipped hero photo.</p>
                {contentValue('landing_hero_url') && <img src={contentValue('landing_hero_url')} alt="Hero photo preview" className="mt-2 h-32 w-full rounded-xl border border-line object-cover" />}
              </div>
              <div>
                <label htmlFor="landing-background-url" className="label-caps mb-1 block">Background photos — rotating behind the whole landing page</label>
                <textarea id="landing-background-url" value={contentValue('landing_background_url')} onChange={e => setContentValue('landing_background_url', e.target.value.slice(0, 1400))} placeholder="https://…/one.jpg, https://…/two.jpg" rows={2} className="input-base resize-none" />
                <p className="mt-1 text-[10px] text-ink-muted">Separate several public photo links with commas and the page cross-fades through them every few seconds. Leave empty to use the photos shipped in the app (background01.jpg … background08.jpg), or the dark gradient when none exist. This is not the hero photo.</p>
                {contentValue('landing_background_url').split(/[,\n]/).map(u => u.trim()).filter(Boolean).slice(0, 8).map((u, i) => (
                  <img key={`${u}-${i}`} src={u} alt="Background photo preview" className="mt-2 h-32 w-full rounded-xl border border-line object-cover" />
                ))}
              </div>
              <button onClick={() => void saveContent()} disabled={contentBusy} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
                {contentBusy ? 'Saving…' : 'Save artwork — live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Only http(s) links are accepted. The app never uploads or copies the image; it loads the public link you provide.</p>
            </div>

            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4" data-testid="admin-social-links">
              <div>
                <h2 className="text-sm font-extrabold">Social media links</h2>
                <p className="mt-0.5 text-xs text-ink-muted">These become round icons at the bottom of the landing page, above the church name. Each icon opens the church page in a new tab. A blank field still shows its icon, opening the platform’s home page until you add the church’s own link.</p>
              </div>
              {([
                {
                  key: 'social_instagram_url',
                  label: 'Instagram',
                  placeholder: 'https://instagram.com/harvestfamily or @harvestfamily',
                  base: 'https://instagram.com/',
                  steps: 'On the church Instagram profile tap the ⋯ menu at the top right, then Share profile / Copy profile link. Paste that link here, or just type the handle with the @.',
                },
                {
                  key: 'social_youtube_url',
                  label: 'YouTube',
                  placeholder: 'https://youtube.com/@harvestfamily or @harvestfamily',
                  base: 'https://youtube.com/@',
                  steps: 'Open the church channel, tap Customise channel, then Copy channel link (it looks like youtube.com/@name). Paste it here, or just type the @name.',
                },
                {
                  key: 'social_tiktok_url',
                  label: 'TikTok',
                  placeholder: 'https://tiktok.com/@harvestfamily or @harvestfamily',
                  base: 'https://tiktok.com/@',
                  steps: 'Open the church profile, tap Share profile, then Copy link (it looks like tiktok.com/@name). Paste it here, or just type the @name.',
                },
              ] as const).map(f => {
                const raw = contentValue(f.key).trim()
                const href = !raw ? '' : (/^https?:\/\//i.test(raw) ? raw : f.base + raw.replace(/^@/, ''))
                return (
                  <div key={f.key}>
                    <label htmlFor={`social-${f.key}`} className="label-caps mb-1 block">{f.label} page link</label>
                    <input
                      id={`social-${f.key}`}
                      value={contentValue(f.key)}
                      onChange={e => setContentValue(f.key, e.target.value.slice(0, 300))}
                      placeholder={f.placeholder}
                      inputMode="url"
                      autoCapitalize="none"
                      className="input-base"
                    />
                    <p className="mt-1 text-[10px] leading-4 text-ink-muted">{f.steps}</p>
                    {href && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-accent-strong">
                        <span aria-hidden="true">↗</span>
                        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">Opens {href}</a>
                      </p>
                    )}
                    <p className="mt-0.5 text-right text-[10px] text-ink-muted">{contentValue(f.key).length}/300</p>
                  </div>
                )
              })}
              <button onClick={() => void saveContent()} disabled={contentBusy} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
                {contentBusy ? 'Saving…' : 'Save social links — live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Check the “Opens …” line before saving: it is exactly the address the icon will use. A full link and a @handle both work.</p>
            </div>
          </div>
        )}

        {/* ── Giving copy ── */}
        {tab === 'give' && (
          <div className="space-y-3">
            <div className="rounded-card border border-line bg-surface-raised p-4">
              <h2 className="text-sm font-extrabold">Give screen</h2>
              <p className="mt-1 text-2xs text-ink-muted">
                What a member sees when they tap Give. Each card says where it appears and what is live right now; an
                empty field means the app uses its built-in wording. Saves go live for everyone immediately.
              </p>
            </div>
            {GIVE_SECTIONS.map(section => (
              <section key={section.title} className="space-y-2">
                <div>
                  <h3 className="text-2xs font-extrabold uppercase tracking-[0.16em] text-ink-subtle">{section.title}</h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{section.blurb}</p>
                </div>
                {section.title === 'M-Pesa details used as a fallback' && (
                  <div className="rounded-card border border-line bg-surface-raised p-3">
                    <label htmlFor="gv-giving_fallback_method" className="label-caps mb-1 block">Fallback method</label>
                    <select
                      id="gv-giving_fallback_method"
                      value={contentValue('giving_fallback_method') === 'till' ? 'till' : 'paybill'}
                      onChange={e => setContentValue('giving_fallback_method', e.target.value)}
                      className="input-base"
                    >
                      <option value="paybill">M-Pesa Paybill (Business Number)</option>
                      <option value="till">M-Pesa Till (Buy Goods)</option>
                    </select>
                    <p className="mt-1 text-[10px] leading-4 text-ink-muted">The number below is read as this option when a purpose has no destination of its own.</p>
                  </div>
                )}
                {section.keys.map(key => {
                  const field = GIVE_FIELDS.find(f => f.key === key)
                  if (!field) return null
                  return (
                    <AdminContentField
                      key={key}
                      id={`gv-${key}`}
                      keyName={key}
                      guide={CONTENT_GUIDE[key]}
                      value={contentValue(key)}
                      saved={content[key] ?? ''}
                      limit={field.max}
                      rows={field.textarea ? 2 : undefined}
                      onChange={v => setContentValue(key, v)}
                    />
                  )
                })}
              </section>
            ))}
            <section className="space-y-2">
              <div>
                <h3 className="text-2xs font-extrabold uppercase tracking-[0.16em] text-ink-subtle">Where each purpose’s money goes</h3>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
                  Give each purpose its own till or paybill number, bank account, or online M-Pesa prompt. Members see
                  exactly that destination on the Give screen, and one purpose never borrows another’s number.
                </p>
              </div>
              <GivingPaymentEditor
                funds={adminFunds}
                configs={adminPayments}
                onChange={next => setContentValue('giving_payment_methods', JSON.stringify(next))}
              />
            </section>
            <section className="space-y-2">
              <div>
                <h3 className="text-2xs font-extrabold uppercase tracking-[0.16em] text-ink-subtle">Purposes members can give to</h3>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
                  Each purpose has its own name, icon and payment steps, shown as a card on the Give screen. The quick
                  amounts under them are the shortcuts a member taps instead of typing a figure.
                </p>
              </div>
              <GivingFundsEditor
                funds={adminFunds}
                quick={adminQuick}
                onChange={(nextFunds, nextQuick) => {
                  setContentValue('giving_funds', JSON.stringify(nextFunds))
                  setContentValue('giving_quick', JSON.stringify(nextQuick))
                }}
              />
            </section>
            <button onClick={() => {
              const problem = paymentProblem(adminFunds, adminPayments)
              if (problem) { flash(problem); return }
              void saveContent()
            }} disabled={contentBusy || !contentDraft} className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-40">
              {contentBusy ? 'Saving…' : 'Save giving changes — live for everyone'}
            </button>
            <p className="text-[10px] text-ink-muted">These settings change what members see. The M-Pesa STK push itself is controlled by the server’s Daraja keys, not here.</p>
          </div>
        )}

        {/* ── Adverts ── */}
        {tab === 'adverts' && (
          <div className="space-y-3">
            <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
              <div>
                <h2 className="text-sm font-extrabold">Sponsored adverts</h2>
                <p className="mt-0.5 text-xs text-ink-muted">Third-party adverts shown inside the Community feed. Each member sees an advert at most “daily cap” times a day — counted on the server, so refreshing cannot show it more.</p>
              </div>
              {(() => {
                let live: any[] = []
                try { const parsed = JSON.parse(content.sponsor_adverts || '[]'); live = Array.isArray(parsed) ? parsed : [] } catch { live = [] }
                const shown = live.filter((a: any) => a && a.enabled !== false).length
                let liveSettings = { interval: 6, daily_cap: 2, off: false }
                try {
                  const parsed = JSON.parse(content.advert_settings || '{}')
                  liveSettings = { interval: Number(parsed.interval) || 6, daily_cap: Number(parsed.daily_cap) || 2, off: parsed.placement === 'none' }
                } catch { /* shipped defaults */ }
                const pending = advertsDraft !== null || settingsDraft !== null
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[11px] leading-4 text-ink-muted" data-testid="advert-live-summary">
                    <b className="text-ink">Live now:</b>{' '}
                    {liveSettings.off
                      ? 'adverts are switched off for everyone.'
                      : <>{shown} advert{shown === 1 ? '' : 's'} visible{live.length !== shown ? ` (${live.length - shown} switched off)` : ''} · one after every {liveSettings.interval} posts · at most {liveSettings.daily_cap} per member per day.</>}
                    {pending && <span className="font-bold text-gold-strong"> Edits below are not live until you save.</span>}
                  </div>
                )
              })()}
              <div className="space-y-2">
                <label htmlFor="ad-placement" className="label-caps block">Where adverts appear</label>
                <select id="ad-placement" value={advertSettings.placement} onChange={e => setAdvertSetting({ placement: e.target.value === 'none' ? 'none' : 'feed' })} className="input-base">
                  <option value="feed">Inside the Community feed</option>
                  <option value="none">Off — hide every advert</option>
                </select>
                <p className="text-[10px] text-ink-muted">“Off” hides every advert everywhere, without deleting any of them — switch back to “Inside the feed” when you are ready.</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="ad-interval" className="label-caps mb-1 block">Posts between adverts</label>
                    <input id="ad-interval" type="number" min={3} max={20} step={1} value={advertSettings.interval} onChange={e => setAdvertSetting({ interval: Math.min(20, Math.max(3, Number(e.target.value) || 6)) })} className="input-base" />
                    <p className="mt-1 text-[10px] leading-4 text-ink-muted">3–20. A lower number places adverts closer together in the scroll.</p>
                  </div>
                  <div>
                    <label htmlFor="ad-cap" className="label-caps mb-1 block">Max per member / day</label>
                    <input id="ad-cap" type="number" min={1} max={10} step={1} value={advertSettings.daily_cap} onChange={e => setAdvertSetting({ daily_cap: Math.min(10, Math.max(1, Number(e.target.value) || 2)) })} className="input-base" />
                    <p className="mt-1 text-[10px] leading-4 text-ink-muted">1–10. Each member sees one advert no more than this many times in a day.</p>
                  </div>
                </div>
                <p className="text-[10px] text-ink-muted">The server enforces both limits, so refreshing the feed cannot show an advert more often.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="label-caps">Adverts in this rotation</p>
                  <span className="text-[10px] font-bold text-ink-subtle">{advertsList.length}/20</span>
                </div>
                {advertsList.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line bg-surface p-3 text-xs text-ink-muted">No adverts yet. Add one with a photo above.</p>
                ) : advertsList.map((advert: any, index: number) => (
                  <div key={`${advert.id || 'advert'}-${index}`} className="space-y-2 rounded-xl border border-line bg-surface p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <input value={String(advert.title || '')} onChange={e => updateAdvert(index, { title: e.target.value.slice(0, 80) })} aria-label={`Advert ${index + 1} headline`} placeholder="Advert headline" className="input-base" />
                        <p className="mt-1 truncate text-[10px] text-ink-subtle">{advert.id || 'no id'}</p>
                      </div>
                      <button type="button" onClick={() => setAdvertsList(advertsList.filter((_: any, i: number) => i !== index))} className="min-h-10 shrink-0 rounded-full border border-danger/20 bg-danger-soft px-3 text-2xs font-extrabold text-danger">Remove</button>
                    </div>
                    <textarea value={String(advert.body || '')} onChange={e => updateAdvert(index, { body: e.target.value.slice(0, 400) })} aria-label={`Advert ${index + 1} body`} rows={2} placeholder="One or two lines about the offer" className="input-base resize-y" />
                    <input value={String(advert.cta_url || '')} onChange={e => updateAdvert(index, { cta_url: e.target.value })} aria-label={`Advert ${index + 1} link`} placeholder="Link (https://…)" inputMode="url" className="input-base" />
                    <label className="inline-flex items-center gap-2 text-2xs font-bold text-ink-muted">
                      <input type="checkbox" checked={advert.enabled !== false} onChange={e => updateAdvert(index, { enabled: e.target.checked })} className="h-4 w-4 rounded border-line accent-accent" />
                      Show this advert
                    </label>
                  </div>
                ))}
              </div>
              <details className="rounded-xl border border-line bg-surface p-3">
                <summary className="cursor-pointer text-2xs font-extrabold text-ink-muted">Advanced: edit advert data as JSON</summary>
                <p className="mt-1 text-[10px] text-ink-muted">Only needed for optional fields such as dates and audience. The normal controls above are enough for everyday changes.</p>
                <label htmlFor="ad-list" className="label-caps mb-1 mt-2 block">Advert list</label>
                <textarea id="ad-list" value={advertsDraft ?? advertsJson} onChange={e => { setAdvertsDraft(e.target.value); setAdvertConfirm(false) }} rows={10} placeholder={ADVERT_EXAMPLE} className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs outline-none focus:border-accent" />
                <p className="mt-1 text-[10px] leading-4 text-ink-muted">Max 20 adverts. Required: <b>id</b> (a–z, 0–9, - or _), <b>title</b> (80 chars), <b>cta_url</b> (http/https). Optional: <b>body</b> (400), <b>image_key</b>, <b>image_url</b>, <b>enabled</b>, <b>audience</b>, <b>advertise_from</b> / <b>advertise_until</b>.</p>
              </details>
              <div className="rounded-2xl border border-line bg-surface p-3" data-testid="advert-photo-composer">
                <p className="text-2xs font-extrabold uppercase tracking-[0.14em] text-accent">New advert with a photo</p>
                <p className="mt-1 text-[10px] text-ink-muted">Upload a picture straight from your phone — no hosting or link needed. It is added to the list below for you to review.</p>
                <label htmlFor="ad-photo" className="mt-2 flex min-h-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-sunken">
                  {adPhoto
                    ? <img src={URL.createObjectURL(adPhoto)} alt="Selected advert" className="h-24 w-full object-cover" />
                    : <span className="flex items-center gap-2 text-2xs font-bold text-ink-muted"><Icon name="camera" size={18} /> Choose a photo</span>}
                  <input id="ad-photo" type="file" accept="image/*" className="hidden" onChange={e => { setAdPhoto(e.target.files?.[0] || null); e.target.value = '' }} />
                </label>
                <input value={adTitle} onChange={e => setAdTitle(e.target.value.slice(0, 80))} placeholder="Headline (e.g. Harvest Bookshop)" className="input-base mt-2" aria-label="Advert headline" />
                <textarea value={adBody} onChange={e => setAdBody(e.target.value.slice(0, 400))} rows={2} placeholder="One or two lines about the offer" className="input-base mt-2 resize-y" aria-label="Advert body" />
                <input value={adCta} onChange={e => setAdCta(e.target.value)} placeholder="Link (optional — defaults to the church site)" className="input-base mt-2" aria-label="Advert link" />
                <button type="button" onClick={() => void addAdvertWithPhoto()} disabled={adBusy || !adPhoto || !adTitle.trim()} className="mt-2 min-h-11 w-full rounded-xl bg-ink text-2xs font-extrabold text-white disabled:opacity-40">
                  {adBusy ? 'Uploading photo…' : 'Add this advert'}
                </button>
              </div>
              <button
                onClick={() => {
                  if (!advertConfirm) { setAdvertConfirm(true); return }
                  let adverts: unknown
                  let settings: unknown
                  try { adverts = JSON.parse((advertsDraft ?? advertsJson) || '[]') } catch { setError('Adverts must be valid JSON'); return }
                  try { settings = JSON.parse((settingsDraft ?? settingsJson) || '{}') } catch { setError('Advert settings must be valid'); return }
                  setError('')
                  void (async () => {
                    setContentBusy(true)
                    try {
                      const r = await fetch(`${API}/api/content`, {
                        method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sponsor_adverts: JSON.stringify(adverts), advert_settings: JSON.stringify(settings) }),
                      })
                      const d = await r.json().catch(() => ({}))
                      if (!r.ok) throw new Error(d?.error || `Could not save (${r.status})`)
                      setContent(d.content || content); setAdvertsDraft(null); setSettingsDraft(null); setAdvertConfirm(false)
                      flash('Adverts published — live on the next feed refresh')
                    } catch (e: any) { setError(e?.message || 'Could not save adverts') } finally { setContentBusy(false) }
                  })()
                }}
                disabled={contentBusy}
                className="min-h-11 w-full rounded-xl bg-accent text-sm font-extrabold text-white disabled:opacity-50"
              >
                {contentBusy ? 'Saving…' : advertConfirm ? 'Tap again to publish' : 'Save — goes live for everyone'}
              </button>
              <p className="text-[10px] text-ink-muted">Leave the list as <b>[]</b> to switch sponsored adverts off. Adverts are always labelled Sponsored and never styled as church posts.</p>
            </div>
          </div>
        )}

        {/* ── Studio ── */}
        {tab === 'media' && <AdminMedia onBack={() => setTab('moderation')} />}
      </main>

      {/* Unsaved work stays visible wherever the admin has scrolled to. */}
      {contentDraft && Object.keys(contentDraft).length > 0 && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ink bg-ink px-3 py-1.5 text-white shadow-card">
            <span className="text-2xs font-extrabold">{Object.keys(contentDraft).length} unsaved change{Object.keys(contentDraft).length === 1 ? '' : 's'}</span>
            <button type="button" onClick={() => void saveContent()} disabled={contentBusy} className="min-h-9 rounded-full bg-gold px-3.5 text-2xs font-extrabold text-ink disabled:opacity-40">
              {contentBusy ? 'Saving…' : 'Save now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
