import { cleanupOrphanedUploads } from '../../src/routes/pending.js'

export default async function handler() {
  try {
    const result = await cleanupOrphanedUploads()
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('[pending] scheduled cleanup failed', error)
    return new Response(JSON.stringify({ ok: false, error: 'cleanup failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

export const config = {
  schedule: '0 * * * *',
}
