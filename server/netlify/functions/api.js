import awsLambdaFastify from '@fastify/aws-lambda'
import { withLambda } from '@netlify/aws-lambda-compat'
import { buildApp } from '../../src/app.js'
import { ensureBucket } from '../../src/s3.js'

const app = await buildApp()
await ensureBucket()

const proxy = awsLambdaFastify(app, {
  decorateRequest: false,
})

await app.ready()

export default withLambda(proxy)

export const config = {
  path: '/api/*',
}
