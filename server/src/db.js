import pg from 'pg'
import { getConnectionString } from '@netlify/database'
import dotenv from 'dotenv'
dotenv.config()

const connectionString = process.env.NETLIFY_DB_URL || getConnectionString()
if (!connectionString) throw new Error('Netlify Database is required: create a Netlify Database for this site')

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
