import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://harvest:harvest@localhost:5432/harvest',
  max: 10,
})

pool.on('error', e => console.error('[pg] pool error', e.message))

export async function query(text, params) {
  return pool.query(text, params)
}
