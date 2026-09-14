import pg from 'pg'
import { getConnectionString } from '@netlify/database'
import dotenv from 'dotenv'
dotenv.config()

// Netlify Database injects NETLIFY_DB_URL; the self-hosted Docker Compose stack
// supplies DATABASE_URL. Only consult the Netlify helper when neither is present.
function resolveConnectionString() {
  const explicit = process.env.NETLIFY_DB_URL || process.env.DATABASE_URL
  if (explicit) return explicit
  try {
    return getConnectionString()
  } catch {
    return null
  }
}

const connectionString = resolveConnectionString()
if (!connectionString) {
  throw new Error('Database connection required: set NETLIFY_DB_URL (Netlify) or DATABASE_URL (self-hosted)')
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
