import assert from 'node:assert/strict'
import { presignedPost } from '../src/lib/media.js'

const env = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  MEDIA_BUCKET_NAME: 'harvest-media',
}

const result = await presignedPost(env, {
  type: 'story',
  contentType: 'image/jpeg',
  bytes: 1024,
  ownerId: 'user-123',
})

assert.equal(result.method, 'PUT')
assert.match(result.url, /^https:\/\/0123456789abcdef0123456789abcdef\.r2\.cloudflarestorage\.com\/harvest-media\/originals\/story\//)
assert.equal(result.fields['Content-Type'], 'image/jpeg')
assert.equal(result.fields['x-amz-meta-ownerid'], 'user-123')
assert.match(result.url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/)
assert.match(result.url, /X-Amz-Signature=[0-9a-f]+/)
assert.match(result.url, /X-Amz-SignedHeaders=content-type%3Bhost%3Bx-amz-meta-ownerid/)

await assert.rejects(
  () => presignedPost(env, { type: 'story', contentType: 'image/jpeg', bytes: 31 * 1024 * 1024, ownerId: 'user-123' }),
  /bytes/
)

console.log('Media presigned PUT contract tests passed.')
