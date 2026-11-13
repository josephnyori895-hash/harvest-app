// Avatar initials — one rule for the four call sites (Comments, Home, EditProfile,
// FeedCard) whose copies disagreed on hyphens, @-handles and empty fallback:
//   "Mary-Jane"  -> "MJ"   (hyphens split — the divergent case)
//   "@nyorii"    -> "NY"   (leading handle stripped; single word still yields 2 chars)
//   "a.b.you"    -> "AB"   (dots split)
//   "Solo"       -> "SO"   (single word: first two characters)
//   ""           -> "?"    (empty never renders blank)

export function initials(name: string): string {
  const parts = String(name || '').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean)
  let out = parts.map(p => p[0]).slice(0, 2).join('').toUpperCase()
  if (out.length < 2 && parts[0] && parts[0].length > 1) out = parts[0].slice(0, 2).toUpperCase()
  return out || '?'
}
