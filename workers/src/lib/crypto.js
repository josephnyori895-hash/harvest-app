// WebCrypto replacements for jsonwebtoken / bcryptjs / node:crypto HMAC.
// JWT format is wire-compatible with the Node implementation (HS256).
// Password hashing: PBKDF2-SHA256 (FIPS-approved in Workers; bcrypt is not available).

const enc = new TextEncoder()

function b64urlFromBytes(bytes) {
  let s = ''
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64FromBytes(bytes) {
  let s = ''
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s)
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── JWT (HS256, jsonwebtoken-compatible claims: exp, iat) ──

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function b64urlJson(obj) {
  return b64urlFromBytes(enc.encode(JSON.stringify(obj)))
}

export async function jwtSign(payload, secret, expiresIn = '24h') {
  const m = String(expiresIn).match(/^(\d+)([smhd])$/)
  if (!m) throw new Error('bad expiresIn')
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]
  const iat = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = { ...payload, iat, exp: iat + Number(m[1]) * mult }
  const unsigned = `${b64urlJson(header)}.${b64urlJson(body)}`
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(unsigned))
  return `${unsigned}.${b64urlFromBytes(new Uint8Array(sig))}`
}

export async function jwtVerify(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) throw new Error('invalid token')
  const [h, p, s] = parts
  const key = await hmacKey(secret)
  const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(s), enc.encode(`${h}.${p}`))
  if (!valid) throw new Error('signature verification failed')
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('jwt expired')
  return payload
}

// ── PBKDF2 password hashing (format: pbkdf2$<iter>$<salt b64>$<hash b64>) ──

async function pbkdf2Bits(password, saltBytes, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, base, 256)
}

export async function pbkdf2Hash(password, iterations = 100000) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await pbkdf2Bits(String(password), salt, iterations)
  return `pbkdf2$${iterations}$${b64FromBytes(salt)}$${b64FromBytes(new Uint8Array(bits))}`
}

export async function pbkdf2Verify(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored || '').split('$')
    if (scheme !== 'pbkdf2') return false
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
    const bits = await pbkdf2Bits(String(password), salt, Number(iterStr))
    const a = new Uint8Array(bits)
    const b = Uint8Array.from(atob(hashB64), c => c.charCodeAt(0))
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
  } catch {
    return false
  }
}

// ── HMAC-SHA256 base64url (media URL signing, timing-safe compare) ──

export async function hmacSign(secret, message) {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return b64urlFromBytes(new Uint8Array(sig))
}

export async function timingSafeEqualStr(a, b) {
  const ea = enc.encode(String(a))
  const eb = enc.encode(String(b))
  if (ea.length !== eb.length) return false
  const key = await crypto.subtle.importKey('raw', new Uint8Array(ea.length), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigA = await crypto.subtle.sign('HMAC', key, ea)
  const sigB = await crypto.subtle.sign('HMAC', key, eb)
  const va = new Uint8Array(sigA)
  const vb = new Uint8Array(sigB)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}
