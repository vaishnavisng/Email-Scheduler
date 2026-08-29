# 0006 — Rate limiting and throttling

## Status

Accepted (Phase 5).

> Numbering note: the phase brief labelled this ADR `0003`, but `0003`–`0005`
> were already taken by earlier phases, so it continues the sequence as `0006`.

## Context

Each sender must respect a minimum spacing between sends
(`MIN_DELAY_BETWEEN_EMAILS_MS`) and an hourly quota
(`MAX_EMAILS_PER_HOUR_PER_SENDER`, overridable per sender via `senders.hourlyLimit`,
with an optional `MAX_EMAILS_PER_HOUR_GLOBAL` cap). The service runs multiple
worker instances (and `WORKER_CONCURRENCY > 1` within each), so the limit has to
hold across processes, not just within one.

The naive approach — read the counter, decide, then increment — is a
read-modify-write race: two workers both read "9 used" under a limit of 10, both
decide OK, both increment, and 11 send. Correctness requires the check and the
reservation to be one indivisible step.

## Decision

**Check-and-reserve is one atomic Redis Lua script**
(`packages/queue/rate-limit.lua`, wrapped by `packages/queue/src/rate-limit.ts`).
Redis executes scripts serially, so no two workers can interleave a check with a
reservation. It reads the per-sender quota counter (and, if enabled, the global
one), then the throttle gate, and only if both pass does it stamp the last-send
time and INCR both counters. It returns `{ok, reason, waitMs}` with reason `OK`,
`THROTTLE`, or `QUOTA`. Registered with `redis.defineCommand` so Redis caches it
by SHA instead of re-sending the body every call.

- **Keys:** `throttle:{senderId}` (last send ms), `quota:{senderId}:{window}`,
  `quota:global:{window}`, where `window = floor(now / RATE_LIMIT_WINDOW_MS)`.
  Quota counters get a TTL of twice the window — long enough to outlive the window
  for a late reader, short enough to be gone before the index is reused.
- **All state is in Redis**, never process memory (CONVENTIONS.md #4), which is what
  makes it correct across worker instances.

**Rate-limited jobs are re-parked, never failed.** On `THROTTLE` the processor
calls `job.moveToDelayed(now + waitMs, token)` then `throw new DelayedError()`; on
`QUOTA` it recomputes the fire time as `(window+1) * RATE_LIMIT_WINDOW_MS + seq *
MIN_DELAY_BETWEEN_EMAILS_MS`, persists it via `updateScheduledAt`, fires the
rate-limit notification hook (a stub until Phase 8 wires Slack), then re-parks to
that time. **Why not just `throw new Error()`:** a thrown error consumes a BullMQ
retry attempt and, once attempts are exhausted, marks the job `failed` — which the
spec explicitly forbids for a rate-limited send. `moveToDelayed` + `DelayedError`
re-parks the job without touching the attempt count.

**Sender selection is quota-aware.** Before reserving, the worker MGETs every
active sender's quota counter for this window and picks the one with the most
remaining (`pickMostQuota`), so a large campaign spreads across senders rather than
draining the first. The reservation then happens against that chosen sender.

## Consequences

- The 50-concurrent-vs-limit-10 test (`packages/queue/src/rate-limit.test.ts`)
  asserts exactly 10 reservations win — the atomicity proof. Quota exhaustion,
  throttle spacing, and window rollover are covered alongside it.
- **Cross-worker ordering is approximate, honestly.** The `seq` offset orders a
  campaign's re-parked rows *within one worker's view*, but there is no global
  sequencer: two workers re-parking rows due in the same millisecond have no
  guaranteed relative order, and BullMQ makes no such promise either. Ordering is
  best-effort spacing, not a strict sequence.
- **Reserve-before-claim can over-count by one.** The slot is reserved before the
  guarded row claim, so if the claim then no-ops (another worker already sent that
  row — which also reserved), the slot stays counted. This errs toward
  under-sending, never over the limit, so it's the safe direction; the wasted slot
  is rare (only under a genuine claim race) and self-heals next window.
- Adding the global cap was free — same script, one extra key, disabled by setting
  `MAX_EMAILS_PER_HOUR_GLOBAL=0`.
