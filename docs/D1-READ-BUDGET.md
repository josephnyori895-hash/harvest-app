# D1 read budget — November 2026 incident

## What happened

On 27 November 2026 the `harvestfamily` D1 database exceeded the free plan's
5,000,000 row-read daily limit. Cloudflare then refused every read from the
Worker binding, so `POST /api/auth/login` failed at its first query
(`loginRateLimit` → `SELECT COUNT(*) FROM login_attempts`) with
`D1_ERROR: ... exceeded D1's free tier daily row read limit` and the API
returned `500`. Reads through the wrangler/admin API still worked, and
`/health` stayed green because it only runs `SELECT 1`, which reads no rows —
both of those made the outage look like a code bug.

The limit resets at 00:00 UTC. There is no way to lift it on the free plan.

## Query-level evidence

Source: Cloudflare GraphQL Analytics, dataset `d1QueriesAdaptiveGroups`
(`sum.rowsRead`, trailing 24 h). Reproduce with an account-scoped token:

```graphql
query {
  viewer {
    accounts(filter: { accountTag: "<account-id>" }) {
      d1QueriesAdaptiveGroups(
        limit: 40
        filter: { datetime_geq: "<iso>", datetime_leq: "<iso>" }
        orderBy: [sum_rowsRead_DESC]
      ) {
        count
        sum { rowsRead rowsWritten }
        dimensions { query error }
      }
    }
  }
}
```

| # | Rows read | Queries | Source |
|---|-----------|---------|--------|
| 1 | 3,041,236 | 7,857 | `/api/chat/conversations` — team inbox (`WITH authorized …`) |
| 2 | 1,126,999 | 7,600 | `/api/chat/conversations` — DM inbox |
| 3 | 550,134 | 3,389 | `/api/users/map` — directory with department subqueries |
| 4 | 176,004 | 824 | `/api/users/map` variant |
| 5 | 116,277 | 3,209 | `/api/groups` — group catalogue (public map data) |
| 6 | 83,378 | 1,260 | `/api/users` directory listing |
| 7 | 57,769 | 202 | cron: `DELETE FROM notifications …` (no index on `created_at`) |
| 8 | 57,261 | 1,097 | notifications list |

Total: **5,775,366 rows read in 166,204 read queries**. Roughly 73% of it was
the two inbox queries.

## Root cause

Not a traffic spike. Three things multiplied the cost of a normal session:

1. **The same inbox endpoint was polled from four places at once** — the Chat
   team rail, the Groups screen, the Departments screen all ran a 3-second
   timer, and the app-level unread bubble ran a 30-second one on top. One
   member sitting on a chat screen produced ~1,200 inbox scans an hour.
2. **Each scan reads every message row** for the viewer's conversations to
   compute the unread count and last message. For an admin, the team query
   covers every department and group conversation.
3. **Cleanup deletes had no usable index**: the 10-minute cron deleted by bare
   timestamp columns, so SQLite scanned whole tables each run.

## Changes in this fix

- Client poll intervals: Chat rail, Groups and Departments 3 s → 20 s;
  directory 30 s → 120 s (admin 15 s → 60 s). Realtime events still refresh
  immediately.
- `GET /api/chat/conversations` reuses a per-member result for 10 s, so
  duplicate pollers and un-updated installed APKs collapse into one query.
  The cache is invalidated for the sender and recipient on every message send.
- Migration `0046_read_budget_indexes.sql` indexes the cron delete predicates.

## Phase 2 (recommended before the next growth step)

The inbox query still scans message history. If daily read volume climbs again:

1. Add `chat_threads(conversation_key PRIMARY KEY, last_at, last_text, last_from)`
   maintained on send, removing the per-conversation message scan for previews.
2. Add `chat_read_cursors(user_id, conversation_key, last_read_at,
   PRIMARY KEY(user_id, conversation_key))` updated by `/api/chat/seen`.
   Unread becomes an indexed count of messages newer than the cursor — usually
   a handful of rows — instead of a join over every message.
3. Cache `/api/users/map` per viewer for 60 s (it is a map, not a live feed).
4. Consider a second D1 database or a read replica only if the free budget
   becomes structurally insufficient.

## Operating rules

- Never diagnose a D1 failure from `/health`; it runs `SELECT 1` and reads no
  rows. Use `wrangler d1 info harvestfamily` (`rows_read_24h`) and the GraphQL
  query above.
- Watch `rows_read_24h` after each release. Budget ~200k rows/hour.
- New polling endpoint? Add a server-side coalescing window in the same PR.
