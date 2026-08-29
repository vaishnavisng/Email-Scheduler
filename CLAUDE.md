# CLAUDE.md

## What this is

A production-grade email scheduler service + dashboard, built as an internship
assignment for Outbox Labs / ReachInbox. Emails are scheduled via API, queued as
BullMQ delayed jobs in Redis, sent through Ethereal SMTP by a separate worker
process, indexed into Elasticsearch, and managed from a Next.js dashboard.

Full requirements: `docs/REQUIREMENTS.md`. Design rationale: `docs/ARCHITECTURE.md`.
Read both before proposing structural changes.

## Environment

Developed on Windows with Docker Desktop. No host-specific paths. All shell scripts
use LF endings.

## Hard constraints — never violate these

If a task seems to require breaking one, stop and ask instead of working around it.

1. **No cron. Ever.** No node-cron, agenda, node-schedule, OS crontab, and no
   setInterval/setTimeout used for scheduling. All scheduling is BullMQ delayed
   jobs. The only permitted timer-like code is the one-shot reconciler at worker boot.
2. **No mock auth.** Google login is real OAuth. Never add a dev-login or
   skip-auth button.
3. **Idempotency is mandatory.** Three layers: deterministic BullMQ jobId
   `email:{id}`, a guarded status UPDATE that claims the row, and
   `UNIQUE(campaign_id, recipient)`.
4. **Rate-limit state lives in Redis**, never process memory. Must be correct with
   multiple worker instances.
5. **Rate-limited jobs are re-parked, never failed.** `job.moveToDelayed()` plus
   `throw new DelayedError()`. Never `throw new Error()` for a rate limit.
6. **No hardcoded limits.** Concurrency, min delay, hourly limit and window length
   all come from env, parsed through zod in `packages/shared/env.ts`.
7. **Nothing container-to-container talks to `localhost`.** Service names
   internally; `localhost` only in `NEXT_PUBLIC_*`.
8. **`.env` is never committed.** Shared defaults live in `.env.example`; personal
   overrides in the gitignored `.env`.

## Stack

TypeScript, Express, BullMQ, Redis, Postgres, Elasticsearch, nodemailer.
Drizzle with postgres.js (`prepare: false`). Next.js App Router, Tailwind,
TanStack Query. Docker Compose.

## Layout

apps/api/ · apps/worker/ · apps/web/ · packages/db/ · packages/queue/ ·
packages/shared/ · scripts/ · docs/

## Conventions

- Strict TypeScript. No `any`, no `!` assertions without a comment.
- API types live in `packages/shared/types.ts`, imported by both API and web.
  Never redeclare a response shape in the frontend.
- All timestamps `timestamptz`, stored UTC, converted only at render time.
- Every email status write goes through `packages/db/emails.ts`.
- Frontend: no raw fetch in components — typed client + TanStack Query hooks.
- API errors: `{ error: { code, message } }`. Never leak stack traces.

## Commands

pnpm dev · pnpm build · pnpm typecheck · pnpm lint · pnpm test ·
pnpm db:generate · pnpm db:migrate · pnpm smoke · docker compose up --build

## Working agreement

- Plan before edits touching more than ~3 files; propose and wait.
- One phase per branch (`phase-N-slug`). Don't start later-phase work unasked.
- Run `pnpm typecheck` and `pnpm test` before declaring anything done. Don't
  report success on the basis of code having been written.
- Update `docs/ARCHITECTURE.md` in the same commit as any change to scheduling,
  persistence, idempotency or rate limiting.
- Record non-obvious choices as numbered ADRs in `docs/DECISIONS/`.
- Conventional Commits, referencing the issue:
  `feat(worker): add rate limiter (#12)`.
