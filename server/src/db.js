import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.DB_POOL_MAX || '20', 10),
  connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
  idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  ssl: useSsl ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' } : undefined,
})

pool.on('error', e => console.error('[pg] pool error', e.message))

export async function query(text, params) {
  return pool.query(text, params)
}
