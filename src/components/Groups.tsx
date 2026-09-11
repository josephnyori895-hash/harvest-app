export default function Groups({ users, onSelectGroup }: { users: any[]; onSelectGroup?: (g: string) => void }) {
  const groups: Record<string, number> = {}
  users.forEach(u => { const g = u.group || 'Harvest Nyeri'; groups[g] = (groups[g] || 0) + 1 })
  const current = users.find(u => u.me) || users[0] || {}
  const verified = !!current.verified
  const role = current.role === 'admin' ? 'admin' : 'member'
  const initials = (current.name || 'Harvest Family').split(' ').map((x: string) => x[0]).join('').slice(0, 2).toUpperCase()
  const life = [
    { icon: '👥', title: 'My Groups', text: current.group || 'Join a Harvest group', action: current.group ? 'Open group' : 'Find a group', group: current.group },
    { icon: '⛪', title: 'Ministry involvement', text: verified ? 'Your trusted creator and ministry access' : 'Discover a place to serve', action: 'Explore ministry' },
    { icon: '🙏', title: 'Prayer', text: 'Prayer requests and people you are standing with', action: 'Open prayer' },
    { icon: '📖', title: 'Testimonies', text: 'Stories of what God is doing in our church family', action: 'View testimonies' },
    { icon: '📅', title: 'Events', text: 'Services, groups, worship and church gatherings', action: 'View events' },
    { icon: '🤲', title: 'Giving', text: 'Support the work of Harvest Family Church', action: 'Give' },
  ]

  return (
    <section className="harvest-profile-replacement bg-[#FFFBF0] text-[#29251F] min-h-[calc(100vh-49px)]">
      <style>{`
        .bg-black.text-white:has(.harvest-profile-replacement) > div:first-child,
        .bg-black.text-white:has(.harvest-profile-replacement) > div:nth-child(2),
        .bg-black.text-white:has(.harvest-profile-replacement) > div:nth-child(3),
        .bg-black.text-white:has(.harvest-profile-replacement) > button,
        .bg-black.text-white:has(.harvest-profile-replacement) > p,
        .bg-black.text-white:has(.harvest-profile-replacement) > div:nth-last-child(3),
        .bg-black.text-white:has(.harvest-profile-replacement) > .grid { display:none !important; }
        .bg-black.text-white:has(.harvest-profile-replacement) { background:#FFFBF0 !important; color:#29251F !important; }
      `}</style>

      <div className="sticky top-0 z-10 bg-[#FFFBF0]/95 backdrop-blur border-b border-[#E8DEC9] px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7C3AED]">Harvest Family</p>
          <h1 className="text-xl font-extrabold tracking-tight">My church life</h1>
        </div>
        <button type="button" onClick={() => { const target = document.querySelector('.bg-black.text-white > div:first-child > button') as HTMLElement | null; target?.click() }} className="h-11 w-11 rounded-full bg-white border border-[#E8DEC9] shadow-sm flex items-center justify-center font-extrabold text-[#7C3AED]" aria-label="Open account switcher">
          {initials}
        </button>
      </div>

      <div className="px-4 py-5 space-y-4">
        <div className="rounded-[24px] bg-white border border-[#E8DEC9] shadow-[0_8px_24px_rgba(41,37,31,0.06)] p-5">
          <div className="flex items-start gap-4">
            <div className="h-20 w-20 shrink-0 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#F59E0B] p-[3px]">
              <div className="h-full w-full rounded-full bg-[#FFFBF0] flex items-center justify-center text-xl font-extrabold text-[#7C3AED]">{initials}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold truncate">{current.name || 'Harvest Family'}</h2>
                {verified && <span className="rounded-full bg-[#EDE9FE] px-2 py-1 text-[10px] font-bold text-[#6D28D9]">✓ Verified</span>}
                {role === 'admin' && <span className="rounded-full bg-[#FEF3C7] px-2 py-1 text-[10px] font-bold text-[#92400E]">Admin</span>}
              </div>
              <p className="text-sm text-[#6B6258] mt-1">Harvest Family Church · Nyeri</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="rounded-full bg-[#F5F0E6] px-3 py-1 text-xs font-semibold">📍 {current.location || 'Nyeri'}</span>
                <span className="rounded-full bg-[#E6F4F1] px-3 py-1 text-xs font-semibold text-[#0F766E]">👥 {current.group || 'Choose a group'}</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => { const target = document.querySelector('.bg-black.text-white > div:first-child > button') as HTMLElement | null; target?.click() }} className="mt-4 w-full min-h-11 rounded-xl border border-[#E8DEC9] bg-[#FFFBF0] px-4 text-sm font-bold text-[#29251F]">Switch account</button>
        </div>

        <div className="rounded-[20px] bg-gradient-to-br from-[#EDE9FE] via-white to-[#FFF7DE] border border-[#E8DEC9] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#7C3AED]">Your Harvest journey</p>
          <h2 className="text-lg font-extrabold mt-1">Grow. Pray. Serve. Give.</h2>
          <p className="text-sm text-[#6B6258] mt-1">Your profile is more than posts — it is your place in the church family.</p>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-xl bg-white/80 p-3"><p className="text-lg font-extrabold">{groups[current.group || ''] || 0}</p><p className="text-[10px] text-[#6B6258]">group members</p></div>
            <div className="rounded-xl bg-white/80 p-3"><p className="text-lg font-extrabold">{verified ? 'Trusted' : 'Member'}</p><p className="text-[10px] text-[#6B6258]">community status</p></div>
            <div className="rounded-xl bg-white/80 p-3"><p className="text-lg font-extrabold">Nyeri</p><p className="text-[10px] text-[#6B6258]">church home</p></div>
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between mb-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0F766E]">Church life</p><h2 className="text-lg font-extrabold">Stay connected</h2></div>
            <span className="text-xs text-[#6B6258]">6 ways to grow</span>
          </div>
          <div className="grid gap-3">
            {life.map(item => (
              <button key={item.title} type="button" onClick={() => item.group ? onSelectGroup?.(item.group) : item.title === 'Giving' ? (document.querySelector('button:has([aria-label="give"])') as HTMLElement | null)?.click() : undefined} className="text-left rounded-2xl bg-white border border-[#E8DEC9] p-4 shadow-[0_4px_16px_rgba(41,37,31,0.04)] hover:border-[#C4B5FD] transition">
                <div className="flex items-center gap-3">
                  <span className="h-11 w-11 rounded-xl bg-[#F5F0E6] flex items-center justify-center text-xl">{item.icon}</span>
                  <div className="flex-1"><p className="font-extrabold">{item.title}</p><p className="text-xs text-[#6B6258] mt-0.5">{item.text}</p></div>
                  <span className="text-[#7C3AED] text-lg">→</span>
                </div>
                <p className="mt-3 text-xs font-bold text-[#7C3AED]">{item.action}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-[#29251F] text-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#F59E0B]">My groups</p>
          <div className="mt-3 space-y-2">
            {Object.entries(groups).map(([g, count]) => (
              <button key={g} type="button" onClick={() => onSelectGroup?.(g)} className="w-full min-h-11 rounded-xl bg-white/10 px-4 flex items-center justify-between text-left">
                <span><span className="block text-sm font-bold">{g}</span><span className="block text-xs text-white/60">{count} members</span></span>
                <span className="text-[#F59E0B]">→</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#E8DEC9] bg-white p-4">
          <p className="text-sm font-extrabold">Giving with purpose</p>
          <p className="text-xs text-[#6B6258] mt-1">Support ministry, community care and the mission of Harvest Family Church.</p>
          <button type="button" onClick={() => (document.querySelector('button:has([aria-label="give"])') as HTMLElement | null)?.click()} className="mt-3 min-h-11 rounded-xl bg-[#7C3AED] px-4 text-sm font-bold text-white">Open giving</button>
        </div>

        <p className="text-center text-xs text-[#8A8075] pb-4">Harvest Family Church · Nyeri · A place to belong, grow and serve.</p>
      </div>
    </section>
  )
}
