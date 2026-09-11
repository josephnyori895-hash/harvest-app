import dotenv from 'dotenv'
import { ensureBucket } from './s3.js'
import { buildApp } from './app.js'
import { attachRealtime } from './realtime/io.js'

dotenv.config()

const app = await buildApp()

await ensureBucket().catch(e => {
  app.log.error({ err: e }, '[s3] ensureBucket failed')
  if (process.env.NODE_ENV === 'production') throw e
})

const port = parseInt(process.env.PORT || '3000', 10)
await app.listen({ port, host: '0.0.0.0' })
console.log(`[api] listening :${port}`)

await attachRealtime(app.server)
console.log(`[realtime] socket.io attached :${port}  (coturn 3478 separate)`)
