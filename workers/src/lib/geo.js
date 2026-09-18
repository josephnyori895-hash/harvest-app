// Group → location matching for registration auto-assignment.
// Group locations are admin-editable (groups.lat/lng, migration 0006) and are
// read live from D1. These built-in Nyeri centroids are only the fallback for
// groups that have not been given a location by the admin yet.
export const GROUP_CENTROIDS = {
  'Harvest Central': [-0.4197, 36.9475],
  'Harvest Ruringu': [-0.432, 36.95],
  'Harvest Skuta': [-0.41, 36.94],
  'Harvest Majengo': [-0.425, 36.945],
  'Harvest Kamakwa': [-0.415, 36.955],
}

// Nearest group among admin-located groups (D1 rows with lat/lng set).
// Returns the group NAME, or null when no located groups / bad coords.
export function nearestFromRows(rows, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(rows)) return null
  let best = null
  let bestD = Infinity
  for (const r of rows) {
    const glat = Number(r.lat)
    const glng = Number(r.lng)
    if (!Number.isFinite(glat) || !Number.isFinite(glng)) continue
    // Approximate planar distance — fine at town scale.
    const d = (glat - lat) ** 2 + ((glng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bestD) { bestD = d; best = r.name }
  }
  return best
}

// Legacy centroid fallback (groups without an admin-set location).
export function nearestCommunity(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  let best = null
  let bestD = Infinity
  for (const [name, [clat, clng]] of Object.entries(GROUP_CENTROIDS)) {
    const d = (clat - lat) ** 2 + ((clng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}
