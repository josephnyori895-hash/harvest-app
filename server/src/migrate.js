import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(__dirname, '../migrations')

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const files = (await fs.readdir(migrationsDir))
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort()

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE id=$1', [file])
    if (applied.rowCount) continue

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`[migrate] applied ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`migration ${file} failed: ${err.message}`)
    } finally {
      client.release()
    }
  }
  return files.length
}

// CLI mode: `node src/migrate.js` applies migrations then exits. When imported
// by the Lambda function, runMigrations() is invoked explicitly and the shared
// pool stays open.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  try {
    await runMigrations()
    console.log('[migrate] complete')
  } finally {
    await pool.end()
  }
}
