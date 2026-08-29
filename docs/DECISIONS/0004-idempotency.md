# 0004 — Idempotency in three layers

## Status

Accepted (Phase 4).

> Numbering note: the phase brief labelled this ADR `0001`, but `0001`–`0003`
> were already taken by earlier phases, so it continues the sequence as `0004`.

## Context

An email must be delivered **exactly once**, and the system must survive
restarts, retried API requests, and boot reconciliation re-adding jobs. Any of
those can present the same send more than once. Relying on a single guard is
fragile: if it's the deterministic jobId and Redis is wiped, it's gone; if it's
only the DB claim and two workers race, ordering matters. So the guarantee is
layered — each layer independently prevents a duplicate, and no single failure
produces one.

## Decision

Three independent layers:

1. **Deterministic BullMQ jobId** — `email-{row.id}` (`enqueueEmailSends`,
   `packages/queue/src/index.ts`). BullMQ refuses a second job with an existing
   jobId, so enqueueing the same row twice — a retried request, or the boot
   reconciler — adds nothing the second time. (BullMQ forbids `:` in a custom
   jobId, the Redis key separator, so the `email:{id}` convention uses `-`; the
   id is a UUID, so determinism and uniqueness are unaffected.)

2. **Guarded status UPDATE that claims the row** — `claimForSending`
   (`packages/db/src/emails.ts`):
   `UPDATE emails SET status='sending', attempts=attempts+1 WHERE id=$1 AND
   status IN ('scheduled','queued') RETURNING *`. One atomic statement, so under
   `WORKER_CONCURRENCY > 1` (or multiple worker containers) exactly one caller
   claims a given row. Zero rows back = someone else has it, or it's already
   sent — the processor returns successfully instead of throwing.

3. **`UNIQUE(campaign_id, recipient)`** — stops duplicates at the source:
   re-submitting the same recipient list can't create a second row to send.

## Consequences

- Re-running the boot reconciler any number of times is safe (layer 1).
- A stalled send reset back to `scheduled` can be re-claimed, and the guarded
  UPDATE guarantees only one worker wins the re-claim (layer 2).
- A send failure must release the claim (`resetForRetry`, `sending`→`queued`)
  before re-throwing, or layer 2 would no-op every BullMQ retry. Only the final
  `failed` event (attempts exhausted) writes `failed` + `last_error`.
- Verified by the integration tests: `packages/queue/src/idempotency.test.ts`
  (one row enqueued twice → exactly one job) and `packages/db/src/claim.test.ts`
  (two concurrent claims → exactly one wins).
