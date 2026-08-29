# 2. `emails.sender_id` is nullable, assigned at claim time

Status: accepted (Phase 2)

## Context

`campaigns` carries no sender; `emails` does. When is a sender bound to a row?
Phase 2 only schedules — it doesn't send — so nothing has chosen a sender yet.

## Decision

`emails.sender_id` is nullable. `POST /api/campaigns` inserts rows with
`sender_id = NULL`, status `scheduled`. The worker picks an active sender when it
claims the job (Phase 3). The FK is `ON DELETE set null` so removing a sender
doesn't erase sent history.

## Consequences

- Campaign creation needs no sender to exist — the Phase 2 gate runs with only a
  user seeded, no sender fixtures.
- Sender rotation/selection logic lives entirely in the worker, not at insert time.
