// rank.js — JS mirror of SQL scoring for unit tests / fallback
// score = 0.45*exp(-h/72) +0.25*engNorm +0.20*affinity +0.10*verified + pinnedBoost

export function scoreOne({ created_at, likes=0, comments=0, group_name, constituency, faith, verified=false, is_pinned=false }, viewer, maxEngRaw) {
  const h = (Date.now() - new Date(created_at).getTime())/3600000
  const recency = Math.exp(-h/72)
  const engRaw = Math.log(1 + likes + comments*3)
  const engNorm = maxEngRaw>0 ? engRaw / maxEngRaw : 0
  const affinity = group_name && viewer?.group_name && group_name===viewer.group_name ? 0.5
    : constituency && viewer?.constituency && constituency===viewer.constituency ? 0.3
    : faith && viewer?.faith && faith===viewer.faith ? 0.2 : 0
  const pinnedBoost = is_pinned ? 1000 : 0
  return 0.45*recency + 0.25*engNorm + 0.20*affinity + 0.10*(verified?1:0) + pinnedBoost
}

export function rankFeed(items, viewer) {
  if (!items.length) return []
  const maxEngRaw = Math.max(...items.map(i=> Math.log(1+(i.likes||0)+(i.comments||0)*3)), 0)
  return [...items].map(i=> ({...i, _h:(Date.now()-new Date(i.created_at).getTime())/3600000, rank_score: scoreOne(i, viewer, maxEngRaw)}))
    .sort((a,b)=> b.rank_score - a.rank_score || new Date(b.created_at)-new Date(a.created_at))
}
