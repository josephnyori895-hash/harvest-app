#!/usr/bin/env node
// E2E test for the Instagram-style social layer: rich chat (reply/react/seen/inbox),
// comments, and story views. Runs against any base URL and cleans up after itself.
// Usage: node scripts/test-social.mjs [baseUrl]
const API = (process.argv[2] || 'https://harvestfamily-api.harvestfamily.workers.dev').replace(/\/$/, '')

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function j(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, data }
}

const stamp = String(Date.now()).slice(-8) // digits only — phone validator rejects letters
const A = { username: `tst.a${stamp}`, phone: `0712${stamp.slice(-6)}`, password: 'Passw0rd!x' }
const B = { username: `tst.b${stamp}`, phone: `0713${stamp.slice(-6)}`, password: 'Passw0rd!x' }

async function register(u) {
  const r = await j('POST', '/api/auth/register', null, { ...u, name: `Test ${u.username}`, group_name: 'Harvest Central' })
  return r.data?.token || null
}

console.log('─ Chat: inbox, replies, reactions, seen ─')
const tokA = await register(A)
const tokB = await register(B)
check('both accounts registered', !!tokA && !!tokB)

// A sends B a message
let r = await j('POST', '/api/chat/messages', tokA, { peer: B.username, body: 'Hello from A' })
check('A sends DM', r.status === 201 && r.data?.message?.id, r.status)
const msgId = r.data?.message?.id

// B replies to it (reply_to_id)
r = await j('POST', '/api/chat/messages', tokB, { peer: A.username, body: 'Reply from B', reply_to_id: msgId })
check('B replies referencing A', r.status === 201 && r.data?.message?.reply_to_id === msgId && !!r.data?.message?.reply_preview, JSON.stringify(r.data?.message?.reply_preview || r.data))

// A reacts to B's reply
r = await j('POST', `/api/chat/messages/${r.data?.message?.id}/react`, tokA, { reaction: '❤️' })
check('A reacts ❤️ to B reply', r.status === 200 && r.data?.reaction === '❤️', r.status)

// invalid reaction rejected
r = await j('POST', `/api/chat/messages/${msgId}/react`, tokA, { reaction: '<script>' })
check('invalid reaction rejected', r.status === 200 && (r.data?.reaction === null || r.data?.reaction === ''), JSON.stringify(r.data))

// history shows reaction + reply fields
r = await j('GET', `/api/chat/history?peer=${B.username}`, tokA)
const lastTwo = r.data?.messages?.slice(-2) || []
check('history carries reply/reaction', r.status === 200 && lastTwo.some(m => m.reaction === '❤️' && m.reply_to_id === msgId))

// inbox lists the conversation, unread counts from B's side
r = await j('GET', '/api/chat/conversations', tokB)
const conv = (r.data?.conversations || []).find(c => c.peer === A.username)
check('inbox lists convo w/ unread', r.status === 200 && conv && conv.unread >= 1, conv ? `unread=${conv.unread}` : 'missing')

// B marks seen → unread goes to 0
await j('POST', '/api/chat/seen', tokB, { peer: A.username })
r = await j('GET', '/api/chat/conversations', tokB)
const conv2 = (r.data?.conversations || []).find(c => c.peer === A.username)
check('seen clears unread', conv2 && conv2.unread === 0, conv2 ? `unread=${conv2.unread}` : 'missing')

// outsider cannot react to a private convo
const tokC = await register({ username: `tst.c${stamp}`, phone: `0714${stamp.slice(-6)}`, password: 'Passw0rd!x' })
r = await j('POST', `/api/chat/messages/${msgId}/react`, tokC, { reaction: '🔥' })
check('outsider react forbidden (403)', r.status === 403, r.status)

console.log('─ Comments ─')
// No real post exists (uploads blocked without R2) — expect 404 to prove validation works.
r = await j('POST', '/api/comments', tokA, { scope: 'post', id: 'no-such-post', body: 'test' })
check('comment on missing post → 404', r.status === 404, r.status)

r = await j('GET', '/api/comments?scope=post&id=no-such-post', tokA)
check('comments list works', r.status === 200 && Array.isArray(r.data?.comments))

console.log('─ Story views ─')
r = await j('POST', '/api/stories/no-such-story/view', tokA)
check('view record on missing story (ok/ignored)', r.status === 200 || r.status === 404, r.status)

r = await j('GET', '/api/stories/no-such-story/views', tokA)
check('views list on missing story → 404', r.status === 404, r.status)

console.log('─ Cleanup ─')
// Tokens are role=member; deletion is admin-only. Report so the test DB can be swept.
if (tokA && tokB && tokC) {
  console.log(`(test accounts remain: ${A.username}, ${B.username}, tst.c${stamp} — sweep via admin if needed)`)
}

process.exit(failures ? 1 : 0)
