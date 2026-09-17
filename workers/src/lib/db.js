// D1 helpers — mirrors the pg `query()` surface used across server/src.
// Booleans are stored as 0/1; normalize booleans when reading where it matters.

export async function query(env, sql, params = []) {
  const bound = params.map(p => (p === undefined ? null : p))
  const res = bound.length ? await env.DB.prepare(sql).bind(...bound).all() : await env.DB.prepare(sql).all()
  return { rows: res.results || [], meta: res.meta }
}

// One-shot transaction: D1 batches sequentially and rolls back on first error.
export async function batch(env, statements) {
  return env.DB.batch(statements)
}

export function stmt(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params.map(p => (p === undefined ? null : p)))
}

// pg UUIDs → D1 TEXT UUIDs (generated in JS; lowercases like pg).
export function uuid() {
  return crypto.randomUUID()
}

// now() → ISO timestamp. D1 stores TEXT timestamps; comparisons are lexicographic,
// which is correct for the same ISO format everywhere.
export function nowIso() {
  return new Date().toISOString()
}

// pg interval arithmetic replacements used by the routes.
export function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export function isoHoursAhead(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

// Normalize a D1 row's boolean-ish integer columns to true booleans.
export function bool(row, ...keys) {
  if (!row) return row
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && typeof row[k] !== 'boolean') row[k] = !!row[k]
  return row
}
