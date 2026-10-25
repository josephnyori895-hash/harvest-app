import MediaThumbnail from './MediaThumbnail'
import { useState, useEffect, useRef } from 'react'
import { startBackgroundUpload } from '../lib/backgroundUploads'
import { shareStoryToWhatsApp } from '../lib/whatsappShare'
import ImageAdjuster from './ImageAdjuster'
import SocialEditor from './SocialEditor'

import ErrorMessage from './ErrorMessage'
// STORY VIEWER — immersive full-screen, auto-advance to next USER.
// Photo stories advance on a 4s timer; VIDEO stories play in full — the
// progress bar tracks the video itself and the next story loads on 'ended'.
export default function StoryViewer({ idx, setIdx, allStories, users = [], onOpenUser, onDeleted, onViewed }: { idx: number; setIdx: (n: number | null) => void; allStories: any[]; users?: any[]; onOpenUser?: (u: any) => void; onDeleted?: (id: string) => void; onViewed?: (id: string) => void }) {
  const s = allStories[idx]
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [videoState, setVideoState] = useState<'loading' | 'playing' | 'blocked' | 'error'>('loading')
  // Stories start WITH sound (WhatsApp-status behaviour). The story opens on a
  // real tap, so the WebView's user-gesture requirement is satisfied. If the
  // device still refuses unmuted autoplay we retry muted once and surface a
  // speaker toggle so nobody gets a silent video with no explanation.
  const [storyMuted, setStoryMuted] = useState(false)
  const [mediaRetryKey, setMediaRetryKey] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [reply, setReply] = useState('')
  const [replies, setReplies] = useState<any[]>([])
  const [replyBusy, setReplyBusy] = useState(false)
  const [showReplies, setShowReplies] = useState(false)
  const [replySent, setReplySent] = useState(false)
  const [views, setViews] = useState<any[]>([])
  const [viewCount, setViewCount] = useState(0)
  const [showViews, setShowViews] = useState(false)
  const [viewerError, setViewerError] = useState('')
  const [editing, setEditing] = useState(false)
  const [musicPreviewId, setMusicPreviewId] = useState<string | null>(null)
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  const duration = 4000
  const isLastStory = idx >= allStories.length - 1
  const isVideo = Boolean(s?.video)
  const toggleMusic = () => {
    if (!s?.music?.id || isVideo) return
    if (musicPreviewId === s.music.id) { musicAudioRef.current?.pause(); musicAudioRef.current = null; setMusicPreviewId(null); return }
    if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current = null }
    const a = new Audio(s.music.url)
    a.onended = () => { setMusicPreviewId(null); musicAudioRef.current = null }
    musicAudioRef.current = a
    a.play().catch(() => {})
    setMusicPreviewId(s.music.id)
  }
  const me = (() => { try { return localStorage.getItem('harvest_username') || '' } catch { return '' } })()
  const isAdmin = (() => { try { return localStorage.getItem('harvest_role') === 'admin' } catch { return false } })()
  const canDelete = Boolean(s?.id && (s.username === me || isAdmin))
  const canEdit = canDelete
  const isStoryAuthor = Boolean(s?.username && s.username === me)
