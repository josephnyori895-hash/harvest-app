import { createClient } from 'redis'
import dotenv from 'dotenv'
dotenv.config()

if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required')

export const redis = createClient({ url: process.env.REDIS_URL })
redis.on('error', err => console.error('[redis] client error', err.message))

await redis.connect()

export async function closeRedis() {
  if (redis.isOpen) await redis.quit()
}
