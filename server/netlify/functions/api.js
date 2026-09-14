import awsLambdaFastify from '@fastify/aws-lambda'
import { buildApp } from '../../src/app.js'
import { ensureBucket } from '../../src/s3.js'

// Lazily build the Fastify app on first invocation (avoids top-level await,
// which is invalid in the CJS output Netlify's function bundler produces).
// No withLambda wrapper: @netlify/aws-lambda-compat double-declares __dirname
// in the bundled output and crashed the function at boot.
let handlerPromise

function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const app = await buildApp()
      await ensureBucket()
      await app.ready()
      return awsLambdaFastify(app, { decorateRequest: false })
    })().catch(err => {
      handlerPromise = undefined
      throw err
    })
  }
  return handlerPromise
}

export async function handler(event, context) {
  const fastifyHandler = await getHandler()
  return fastifyHandler(event, context)
}

export const config = {
  path: '/api/*',
}
