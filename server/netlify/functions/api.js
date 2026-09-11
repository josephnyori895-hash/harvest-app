import awsLambdaFastify from '@fastify/aws-lambda'
import { buildApp } from '../../src/app.js'

const app = await buildApp()
const proxy = awsLambdaFastify(app, {
  decorateRequest: false,
})

await app.ready()

export const handler = proxy
