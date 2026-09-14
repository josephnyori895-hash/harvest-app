import awsLambdaFastify from '@fastify/aws-lambda'
import { withLambda } from '@netlify/aws-lambda-compat'
import { buildApp } from '../../src/app.js'
import { ensureBucket } from '../../src/s3.js'
import { runMigrations } from '../../src/migrate.js'

const app = await buildApp()
await ensureBucket()

// Apply pending SQL migrations on cold start (idempotent — schema_migrations
// tracks applied files, so this is a single fast query once up to date).
try {
  await runMigrations()
} catch (e) {
  console.error('[migrate] failed', e?.message || e)
}

const proxy = awsLambdaFastify(app, {
  decorateRequest: false,
})

await app.ready()

export default withLambda(proxy)

export const config = {
  path: '/api/*',
}
