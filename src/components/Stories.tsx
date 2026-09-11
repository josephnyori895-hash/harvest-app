import { useCallback, useEffect, useRef, useState } from 'react'

type Story = {
  id?: string | number
  name?: string
  img?: string
  video?: string
  caption?: string
  music?: { cover?: string; title?: string; artist?: string; url?: string }
}

type User = { username?: string; role?: string }

const STORY_DURATION_MS = 4000

// STORY VIEWER — defensive, deterministic viewer. Never assumes optional story/user data exists.
export default function StoryViewer({ idx, setIdx, allStories, users = [] }: { idx: number; setIdx: (n: number | null) => void; allStories: Story[]; users?: User[] }) {
  const [progress, setProgress] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hooks must run on every render. Do not return before hooks: the story list can change while the viewer is open.
  const safeStories = Array.isArray(allStories) ? allStories : []
  const safeIdx = Number.isInteger(idx) && idx >= 0 && idx < safeStories.length ? idx : -1
  const current = safeIdx >= 0 ? safeStories[safeIdx] : null
  const isLast = safeIdx >= 0 && safeIdx === safeStories.length - 1

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setIdx(null)
  }, [setIdx])

  useEffect(() => {
    if (safeIdx < 0) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setIdx(safeIdx < safeStories.length - 1 ? safeIdx + 1 : null)
    }, STORY_DURATION_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [safeIdx, safeStories.length, setIdx])

  useEffect(() => {
    if (safeIdx < 0 || isPaused) return
    const started = Date.now()
    const interval = setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - started) / STORY_DURATION_MS) * 100))
    }, 50)
    return () => clearInterval(interval)
  }, [safeIdx, isPaused])

  if (!current) return null

  const storyName = typeof current.name === 'string' && current.name.trim() ? current.name : 'Harvest'
  const matchedUser = users.find(u => u?.username === storyName)
  const role = matchedUser?.role
  const go = (next: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (next < 0 || next >= safeStories.length) close()
    else {
      setIsPaused(false)
      setIdx(next)
    }
  }

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < rect.width / 3) go(safeIdx - 1)
    else if (x > rect.width * 2 / 3) go(safeIdx + 1)
    else setIsPaused(p => !p)
  }

  return (
    <div className="story-viewer" onClick={handleTap} role="dialog" aria-label="Story viewer">
      <div className="story-progress" aria-hidden="true">
        {safeStories.map((story, i) => (
          <span key={story.id ?? i} style={{ width: `${i < safeIdx ? 100 : i === safeIdx ? progress : 0}%` }} />
        ))}
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); close() }} aria-label="Close story">×</button>
      <div className="story-content">
        {current.video ? <video src={current.video} autoPlay muted playsInline /> : <img src={current.img} alt={current.caption || storyName} />}
        {current.caption && <p>{current.caption}</p>}
        <div className="story-meta">
          <strong>{storyName}</strong>
          {role && <span>{role}</span>}
        </div>
      </div>
      {isLast && <span className="story-end" aria-hidden="true" />}
    </div>
  )
}
