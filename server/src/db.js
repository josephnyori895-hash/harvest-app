import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

// Connection resolution order:
//   1. NETLIFY_DB_URL — injected automatically by the Netlify Database integration
//   2. DATABASE_URL   — set by the self-hosted Docker Compose stack / VPS deploys
// The @netlify/database helper package is intentionally not imported: it cannot be
// bundled for Lambda (runtime file resolution) and is redundant, since the
// integration provides the same URL via NETLIFY_DB_URL.
const connectionString = process.env.NETLIFY_DB_URL || process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('Database connection required: set NETLIFY_DB_URL (Netlify Database integration) or DATABASE_URL (self-hosted)')
}

const useSsl = String(process.env.DATABASE_SSL || 'true').toLowerCase() === 'true'

export const pool = new pg.Pool({
  connectionString,
  max: Number.parseInt(process.env.DB_POOL_MAX || '5', 10),
  connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
  idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  ssl: useSsl ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' } : undefined,
})

pool.on('error', e => console.error('[netlify-db] pool error', e.message))

export async function query(text, params) {
  return pool.query(text, params)
}
