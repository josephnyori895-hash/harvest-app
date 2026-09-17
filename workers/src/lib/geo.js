// Harvest congregation centroids (Nyeri). Used to auto-assign new members to
// the nearest location group at registration.
export const GROUP_CENTROIDS = {
  'Harvest Central': [-0.4197, 36.9475],
  'Harvest Ruringu': [-0.432, 36.95],
  'Harvest Skuta': [-0.41, 36.94],
  'Harvest Majengo': [-0.425, 36.945],
  'Harvest Kamakwa': [-0.415, 36.955],
}

export function nearestCommunity(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  let best = null
  let bestD = Infinity
  for (const [name, [clat, clng]] of Object.entries(GROUP_CENTROIDS)) {
    // Approximate planar distance — fine at town scale.
    const d = (clat - lat) ** 2 + ((clng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}
