# 0008 — Search indexing

## Status

Accepted (Phase 7).

> Numbering note: the phase brief labelled this ADR `0004`, but `0004`–`0007`
> were already taken by earlier phases, so it continues the sequence as `0008`.

## Context

Sent and scheduled emails must be searchable via Elasticsearch. The naive
approach — index inline in the send path — couples sending to Elasticsearch: a
slow or down ES would slow or fail email sends, which is exactly backwards.
Sending is the critical path; search is not.

## Decision

**Indexing runs on a second BullMQ queue, `email-index`, never inline.** The
send worker and API only ever *enqueue* an index job (`{ emailId }`); a separate
`Worker` (`apps/worker/src/index-worker.ts`, same process, own concurrency)
consumes it, reads the row fresh from Postgres, and upserts to ES. So ES latency
back-pressures only indexing, and a down ES just lets index jobs retry — sends
are untouched.

- **Upsert by `_id = email.id`.** Reprocessing a job (a retry, a redelivery, two
  transitions racing) overwrites the same doc, so it's idempotent. Combined with
  BullMQ's retries (5 attempts, exponential backoff) this gives **at-least-once**
  indexing without dedup bookkeeping.
- **Enqueue points:** on campaign creation (API, bulk) and after every status
  transition in the worker (`sending`, `sent`, `queued` on retry, `failed`). The
  index worker always reads current state from Postgres, so whichever transition
  fired, the doc reflects the row as it stands. The QUOTA re-park (which moves
  `scheduled_at` without changing status) is deliberately *not* re-indexed — it's
  cosmetic for search ordering and the next real transition corrects it.
- **Enqueue never breaks a send.** Every enqueue is fire-and-forget with a caught
  rejection; a gap is backfilled by boot reconciliation's transitions or a manual
  `pnpm reindex`.

**Explicit mapping, created at boot.** `recipient` is a `keyword` with a `.text`
subfield (exact filter/sort *and* partial free-text match); `subject`/`body` are
analysed `text`; `status`/`user_id`/`sender_id` are `keyword`;
`scheduled_at`/`sent_at` are `date`. `ensureEmailsIndex` runs in `bootstrap`
(non-fatal if ES is down — matching the existing "never fail boot on a down dep"
rule) and, as a safety net, once in the index worker before its first upsert.
The safety net matters: `es.index` would otherwise **auto-create** the index with
a guessed dynamic mapping if it were missing.

**Search is always user-scoped.** `GET /api/emails/search` builds a `bool` query
whose `filter` *always* carries `term: { user_id }` (`buildSearchBody`, unit-
tested for exactly this invariant), a `multi_match` over subject/body/recipient
for `q`, optional `status` and `scheduled_at` range filters, sorted by date and
paginated.

**Down ES degrades, never 500s.** If `searchEmails` throws (ES unreachable), the
route falls back to a Postgres `ILIKE` over subject/body/recipient
(`searchEmailsPg`) and returns `degraded: true`. Correct but unranked — the flag
lets the dashboard say so.

## Consequences

- Search results can lag the DB by the index-job latency (sub-second normally,
  longer while ES is catching up after downtime). Acceptable: Postgres remains
  the source of truth and the read-model list endpoints are exact.
- `pnpm reindex` (`scripts/reindex.ts`) rebuilds the whole index from Postgres via
  a chunked bulk upsert — used after a mapping change or ES data loss.
- The ILIKE fallback is O(n) per query with no ranking; it exists to keep the
  dashboard alive during an ES outage, not to replace ES.
- `getAllEmailsForIndex` loads every row into memory for the rebuild — fine for
  demo volume, marked `ponytail:` for keyset paging if the table ever grows.
