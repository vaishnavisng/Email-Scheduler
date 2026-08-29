# 0005 — Restart persistence, and why boot reconciliation is not a cron

## Status

Accepted (Phase 4).

> Numbering note: the phase brief labelled this ADR `0002`, but `0001`–`0003`
> were already taken, so it continues the sequence as `0005`.

## Context

The service must lose no scheduled mail across restarts of any component, and
must send no duplicate when recovering. Two independent stores hold state, and
they can disagree after a crash:

- **Redis** holds the live schedule (BullMQ delayed jobs).
- **Postgres** holds every email row and its status.

A worker killed mid-send leaves a row stuck in `sending`. A lost enqueue (row
committed, job never added) leaves a row `scheduled` with no job. A wiped Redis
loses the whole schedule. All three must recover without a human.

## Decision

- **Postgres is the source of truth.** Redis is a rebuildable projection of it.
  A row's status in Postgres, never Redis, decides whether it still needs sending.
- **Redis is AOF-persisted** (`--appendonly yes` in compose), so an ordinary
  Redis restart loses nothing and no rebuild is even needed.
- **`reconcileOnBoot()`** (`apps/worker/src/reconcile.ts`) rebuilds the schedule
  from Postgres at worker startup:
  1. `resetStalledSends()` — rows stuck in `sending` past
     `STALLED_SEND_THRESHOLD_MS` with no `message_id` and `attempts < 3` go back
     to `scheduled`, so they're claimable again (the `attempts` bound stops a
     poison message looping forever).
  2. `getReconcilable()` + `enqueueEmailSends()` — every `scheduled`/`queued`
     row is re-enqueued under its deterministic jobId. BullMQ ignores jobIds that
     already exist, so nothing double-schedules; overdue rows go out with
     `delay: 0` and drain under the rate limiter — an outage delays mail, never
     drops it.

## Why this is not a cron (CONVENTIONS.md constraint 1)

`reconcileOnBoot()` runs **exactly once, at process startup** — it is crash
recovery that reconciles two stores after a restart, then returns. It has no
timer, no interval, no recurring trigger; nothing re-arms it. A cron re-runs on
a schedule to *do work on a cadence*; this runs on a lifecycle event to *repair
state once*. Ongoing scheduling remains entirely BullMQ delayed jobs. This is
the only timer-adjacent code in the system, and it is deliberately one-shot.

## Consequences

| Failure | Outcome | Mechanism |
|---|---|---|
| API restarts | No impact | Schedule lives in Redis, not the API process |
| Worker restarts | In-flight sends finish, jobs resume | SIGTERM → `worker.close()`; delayed jobs untouched |
| Redis restarts | Nothing lost | AOF persistence |
| Redis data wiped | Fully recovered | `reconcileOnBoot()` rebuilds from Postgres |
| Worker killed mid-send | Row recovered, not duplicated | Stalled-`sending` sweep, bounded by `attempts` |

Verified by the drill in `scripts/demo-restart.ts` (schedule 10 at T+3min,
`docker compose restart api worker` at T+1min, expect 10 sends and zero
duplicates in Ethereal).
