# 0003 — Bootstrap provisions senders under a demo user

## Status

Accepted (Phase 3).

## Context

`senders.user_id` is `NOT NULL` (a sender belongs to a tenant). Bootstrap
auto-provisions three Ethereal senders on first boot so the send path works out
of the box — but real users don't exist until Google OAuth lands in Phase 6, so
there is no owner to attach them to yet.

The worker selects senders **globally** (round-robin over all active senders),
not per-user, so sender ownership doesn't affect sending in Phase 3.

## Decision

`scripts/bootstrap.ts` seeds one deterministic demo user (`google_sub =
demo-bootstrap-user`, via the same `ensureUser` upsert OAuth will use) and owns
the three senders under it. Bootstrap logs a never-expiring JWT for that user so
the Phase 3 gate can `POST /api/campaigns` before OAuth exists.

## Consequences

- Send path is demoable immediately; no manual seeding.
- Bootstrap stays idempotent — it provisions only when the senders table is empty,
  and `ensureUser` is an upsert.
- **Known limitation:** senders are owned by the demo user, so a real Phase 6
  user won't see them in `GET /api/senders` (which is user-scoped). Per-user
  sender management, and whether these seeded senders become shared/system
  senders, is deferred to the phase that adds sender CRUD. The global worker
  selection is unaffected.
