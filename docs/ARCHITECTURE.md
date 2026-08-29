# Architecture

Email scheduler service and dashboard. This document explains *why* and *how*;
the README covers *what* and *how to run it*.

> **Fill this in as you build, not at the end.** Sections 3–6 are the ones a
> reviewer reads closest — they map directly to the assignment's stated
> non-negotiables. Replace every `<...>` placeholder and delete this note before
> submitting.

---

## 1. Overview

<Two or three sentences: what the system does end to end.>

Three processes, one repo.

| Process | Responsibility | Why separate |
|---|---|---|
| `api` | REST endpoints, OAuth callbacks, Bull Board | Stateless. Restarting it doesn't touch the schedule. |
| `worker` | Consumes delayed jobs, enforces limits, sends, indexes | Scales independently; proves the schedule lives in Redis, not in the web process |
| `web` | Next.js dashboard | Thin client over the typed API |

Backing services: **Postgres** (source of truth), **Redis** (durable schedule +
rate-limit state), **Elasticsearch** (search index). External: **Ethereal** (SMTP),
**Slack** (notifications), **Google** (auth).

The API/worker split is load-bearing rather than cosmetic: kill the API and the
worker keeps sending; kill the worker and jobs accumulate in Redis and drain when
it returns. Neither would hold if scheduling lived in the web server's memory.

---

## 2. Data flow

```
compose form
  → POST /api/campaigns
  → INSERT campaign + N email rows (status=scheduled)   [transaction commits]
  → addBulk, jobId = email-{id}, delay = scheduledAt − now
  → BullMQ parks the job in a Redis sorted set
  → at fire time the worker picks it up
       → Lua: check throttle + hourly quota, reserve atomically
       → over quota  → moveToDelayed(next window + seq offset) + Slack notify
       → under quota → claim row (guarded UPDATE) → send via Ethereal
                     → status=sent, store messageId + previewUrl
                     → enqueue index job → Elasticsearch
```

**Why the DB commit precedes the enqueue:** a job whose row hasn't committed yet
is a race — the worker can pick it up and find nothing (or the transaction rolls
back and the row never exists). The reverse failure (row committed, enqueue lost)
is recoverable by the boot reconciler re-adding it under the same deterministic
job id; a job pointing at a nonexistent row is not. So `POST /api/campaigns`
commits the transaction, then calls `enqueueEmailSends`
(`apps/api/src/routes.ts`, `packages/queue/src/index.ts`).

**Redis carries two unrelated concerns**, worth separating in your head:

- The durable schedule — a sorted set keyed by fire timestamp. This is what
  survives restarts.
- Rate-limit state — `throttle:{senderId}` and `quota:{senderId}:{window}`,
  mutated only through the Lua script.

Postgres is the source of truth; Redis is derived state. That asymmetry is what
makes reconciliation possible.

---

## 3. Scheduling, and why there is no cron

No OS crontab, no node-cron / agenda / node-schedule, and no setInterval-based
scheduling loop anywhere in the codebase. (`cron-parser` appears as a transitive
dependency of BullMQ's repeatable-jobs feature, which we do not use — we use only
delayed jobs.)

Scheduling is BullMQ delayed jobs. `enqueueEmailSends`
(`packages/queue/src/index.ts`) adds each job with `delay = scheduledAt − now`;
BullMQ stores it in a Redis sorted set keyed by fire timestamp and a worker
promotes it when due. The schedule is therefore durable state in Redis, not a
timer living in a Node process.

**The one timer-adjacent thing in the codebase** is the boot reconciler at
`<file:line>`. <Explain that it runs once at startup, not on a recurring interval,
so it is crash recovery rather than a cron in disguise.>

---

## 4. Persistence across restarts

**Schema** (`packages/db/schema.ts`, migration `drizzle/0000_*.sql`):
`users`, `senders`, `slack_integrations`, `campaigns`, `emails`. All timestamps
are `timestamptz`, stored UTC. `POST /api/campaigns` inserts the campaign plus one
`emails` row per deduped recipient in a single transaction, with
`scheduled_at = start_at + seq · delay_ms` and status `scheduled` — it does not
enqueue (Phase 3 does). Every email/campaign write goes through
`packages/db/emails.ts`; route handlers never touch the tables directly.

Two choices worth flagging:

- **`emails.sender_id` is nullable.** A sender is chosen when the worker claims
  the job (Phase 3), so a merely-scheduled row has none yet. `ON DELETE set null`
  keeps history if a sender is later removed. See `docs/DECISIONS/0002-*`.
- **Identity is a verified HS256 JWT** (`packages/shared/jwt.ts`), `sub` = user id.
  Phase 6's Google OAuth mints it via `ensureUser` (upsert by `google_sub`); the
  API only verifies. No mock auth. See `docs/DECISIONS/0001-*`.



| Failure | Outcome | Mechanism |
|---|---|---|
| API restarts | No impact on the schedule | Schedule lives in Redis, not the API process |
| Worker restarts | In-flight sends finish, then jobs resume | SIGTERM → `worker.close()`; delayed jobs untouched |
| Redis restarts | Nothing lost | AOF persistence (`--appendonly yes`) |
| Redis data lost entirely | Fully recovered | Boot reconciler rebuilds from Postgres |
| Worker killed mid-send | Row recovered, not duplicated | Stalled-`sending` sweep, bounded by `attempts` |

**Boot reconciliation** (`<file:line>`) runs two passes:

1. <Re-enqueue every row with status `scheduled` or `queued`, using the same
   deterministic job IDs. Duplicates are no-ops, which is what makes re-running
   safe. Overdue rows enqueue with zero delay and drain subject to the rate
   limiter — deliberate, since an outage shouldn't silently drop mail.>
2. <Reset rows stuck in `sending` past `STALLED_SEND_THRESHOLD_MS` with no
   `message_id`, provided `attempts < 3`.>

**Verified by:** `scripts/demo-restart.ts` — <describe the drill and the result.>

---

## 5. Idempotency

Three independent layers. Any one failing still doesn't produce a duplicate send.

1. **Deterministic job ID** — `email-{row.id}` (`enqueueEmailSends`,
   `packages/queue/src/index.ts`). BullMQ refuses a second job with an existing
   jobId, so reconciliation can run any number of times without double-scheduling.
   (BullMQ forbids `:` in a custom jobId, so the `email:{id}` convention uses `-`;
   the id is a UUID, so determinism is unaffected.)
2. **Guarded claim** — `UPDATE emails SET status='sending', attempts=attempts+1 ...
   WHERE id=$1 AND status IN ('scheduled','queued') RETURNING *` (`claimForSending`,
   `packages/db/src/emails.ts`). A single atomic statement, so with concurrency > 1
   exactly one worker claims a row. Zero rows returned means someone else has it (or
   it's already sent), and the processor returns successfully rather than throwing.
3. **Unique constraint** — `UNIQUE(campaign_id, recipient)`. Stops duplicates at
   the source: re-submitting the same CSV can't create a second row.

**Retry interplay:** a send failure would otherwise leave the row stuck in
`sending`, and the guarded claim (step 2) would no-op every BullMQ retry. So the
processor calls `resetForRetry` (`sending`→`queued`) before re-throwing, and only
the final `failed` event (attempts exhausted) writes `failed` + `last_error`.

---

## 6. Concurrency, throttling and rate limiting

All knobs come from env, parsed through zod in `packages/shared/env.ts`. None are
hardcoded.

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY` | 5 | Jobs processed in parallel per worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | 2000 | Minimum spacing between sends from one sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 200 | Hourly quota per sender |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | 1000 | Optional global cap |
| `RATE_LIMIT_WINDOW_MS` | 3600000 | Window length; shortened in `.env.demo` |

**Why a Lua script** (`packages/queue/rate-limit.lua`): <GET → decide → INCR is a
read-modify-write race across workers. A single EVAL makes check-and-reserve
atomic, since Redis executes scripts serially. Registered via `defineCommand` so
it's cached by SHA rather than re-sent per call.>

**Keys:** `throttle:{senderId}` holds the last send timestamp;
`quota:{senderId}:{window}` is a counter with a TTL of twice the window, where
`window = floor(now / RATE_LIMIT_WINDOW_MS)`.

**Why `moveToDelayed` rather than throwing:** <a thrown error consumes a retry
attempt and eventually marks the job failed, but the spec requires rate-limited
jobs are never dropped or permanently failed. `job.moveToDelayed()` followed by
`DelayedError` re-parks the job without touching the attempt count.>

**Order preservation:** <rescheduled jobs get `seq * MIN_DELAY_BETWEEN_EMAILS_MS`
as an offset into the next window. State honestly that this is approximate —
BullMQ gives no cross-worker ordering guarantee for jobs due in the same
millisecond.>

**Sender selection:** <quota-aware — pick the active sender with the most
remaining quota this window, so a large campaign spreads across senders instead of
exhausting the first.>

---

## 7. Behaviour under load

Scenario: **1000+ emails scheduled for the same instant.**

<Walk through with your real numbers. Shape: 1000 emails, 3 senders, 200/hr/sender,
2s min delay → 600 send in the first window with each sender spaced ≥2s apart, 400
re-park into the next window preserving seq order, one Slack notification per
sender per window. Nothing dropped. Total drain ≈ 2 hours. Worker memory stays flat
because delayed jobs live in Redis, not in process.>

**Measured:** <what `scripts/load-test.ts` actually did — queue depth over time,
memory, drain rate. Reference the Bull Board screenshot in `docs/images/`.>

---

## 8. Search indexing

<Explain the second-queue design: indexing runs on `email-index`, never inline in
the send path, so a slow or down Elasticsearch cannot slow or fail a send. Upsert
by `_id = email.id` makes retries and reprocessing harmless, and BullMQ's retries
give at-least-once indexing. Note the Postgres ILIKE fallback with the `degraded`
flag, and that search is always filtered by the authenticated user.>

---

## 9. Slack integration

<OAuth v2 with the incoming-webhook scope, token stored per user. The three
behaviours the spec calls for:>

- **Not connected** → <silent no-op, no crash.>
- **Connected later** → <works with no redeploy, because the webhook is read from
  the DB on every call rather than cached at boot.>
- **Many rate-limited jobs** → <one message, not hundreds: dedupe via
  `SET slack:notified:{userId}:{senderId}:{window} NX EX <window>`.>

<Also: the whole call is wrapped in try/catch, so a dead webhook can never fail an
email job.>

---

## 10. Security notes

<Session cookie httpOnly and SameSite; Bull Board behind basic auth; every list and
search endpoint scoped to the authenticated user; SMTP credentials stored
server-side only and never returned to the client; OAuth state parameter signed
with a short TTL.>

---

## 11. Trade-offs and known limitations

Be specific. Reviewers trust a candidate who names their own gaps.

- <Ordering within a rescheduled window is approximate, not guaranteed.>
- <OAuth client credentials are committed to this private repo for evaluation
  convenience; they'll be rotated afterwards.>
- <Sender SMTP credentials are stored unencrypted; production would use a KMS.>
- <Elasticsearch runs single-node with security disabled — local dev only.>
- <No dead-letter queue UI; failed jobs are visible in Bull Board only.>

---

## 12. What I'd do next with more time

<Three or four items, ordered. This section signals engineering judgement more than
any feature you could have added instead.>
