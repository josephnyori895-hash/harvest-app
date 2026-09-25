  const heroSubtitle = content.hero_subtitle || 'Get one saved, keep one saved, get another saved.'
  const verseText = content.verse_text || 'Let us consider how we may spur one another on toward love and good deeds.'
  const verseRef = content.verse_ref || 'Hebrews 10:24 · Grow together'
  // The pastor account the 'Pray with Pastor' card opens (admin sets it in
  // Admin → Home text as `pastor_username`). Resolved against the member
  // directory; an empty/unset username means the popup is shown instead.
  const pastorUsername = String(content.pastor_username || '').trim()
  // Tolerant match: admins type this by hand, so accept case differences, a
  // leading @, or the member's display name as well as the exact username.
  const normName = (s: string) => s.trim().toLowerCase().replace(/^@/, '')
  const wanted = normName(pastorUsername)
  const configuredPastor = wanted
    ? (users.find((u: any) => normName(String(u.username || '')) === wanted)
      ?? users.find((u: any) => normName(String(u.name || '')) === wanted))
    : null
  // If the account was created after the home screen was configured, recover
  // automatically when exactly one directory entry identifies itself as pastor.
  const pastorMatches = users.filter((u: any) => /(^|[ ._-])pastor([ ._-]|$)/i.test(
    `${u.name || ''} ${u.username || ''}`,
  ))
  const pastorUser = configuredPastor ?? (pastorMatches.length === 1 ? pastorMatches[0] : null)
  const openPastorChat = () => {
    if (pastorUser && onOpenDm) onOpenDm(pastorUser.username, pastorUser.name || pastorUser.username)
    else setShowNoPastor(true)
  }