export default function Groups({ users, onSelectGroup }: { users: any[]; onSelectGroup?: (g: string) => void }) {
  const groups: Record<string, number> = {}
  users.forEach(u => { const g = u.group || 'Harvest Nyeri'; groups[g] = (groups[g] || 0) + 1 })
  return (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <h3 className="text-sm font-bold px-4 text-white">Harvest Groups by Location</h3>
      <p className="text-xs text-zinc-500 px-4">Auto-grouped by estate • Tap to view members</p>
      <div className="mt-3 space-y-2 px-4">
        {Object.entries(groups).map(([g, c]) => (
          <button key={g} onClick={() => onSelectGroup?.(g)} className="w-full flex justify-between items-center p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-left hover:bg-zinc-800">
            <div><p className="text-sm font-semibold text-white">{g}</p><p className="text-xs text-zinc-400">{c} members</p></div>
            <span className="text-xs bg-white text-black px-3 py-1 rounded-full">{c} 👥</span>
          </button>
        ))}
      </div>
    </div>
  )
}
