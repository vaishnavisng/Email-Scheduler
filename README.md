# Outbox — Email Scheduler

[![CI](https://github.com/vaishnavisng/Outbox-Email-Scheduler/actions/workflows/ci.yml/badge.svg)](https://github.com/vaishnavisng/Outbox-Email-Scheduler/actions/workflows/ci.yml)

A production-grade email scheduler + dashboard: compose a message, upload a lead
list, schedule it, and watch emails send through Ethereal SMTP under a
Redis-backed rate limiter — with Google login, Slack rate-limit alerts, full-text
search, and a live BullMQ dashboard. Scheduling is BullMQ delayed jobs, **no cron**.

---

## Evaluation quickstart

Everything runs in Docker. From a fresh clone:

```bash
cp .env.example .env
docker compose up --build
```

Then open:

| URL | What |
|---|---|
| http://localhost:3000 | Dashboard (Google login → compose, tables, search) |
| http://localhost:4000/health | API health (`{ status: "ok", dependencies: {…} }`) |
| http://localhost:4000/admin/queues | Bull Board — live queue visibility (basic auth `admin` / `admin`) |

The `migrate` init container runs migrations, seeds a demo user + three Ethereal
senders, and creates the Elasticsearch index before the API starts — no manual
setup. Compose waits on healthchecks, so the first boot takes a minute.

**To see the scheduler under load** (1200 jobs, same instant) and the drain in
Bull Board:

```bash
pnpm load-test
```

**End-to-end smoke test** (create a campaign, poll until sent, assert searchable):

```bash
pnpm smoke-test
```

> **Google login and Slack Connect both work out of the box** — the client
> credentials are committed to `.env.example` for evaluation convenience (private
> repo; rotated after eval). Nothing to configure.

---

## Running backend & frontend locally (without Docker)

If you'd rather run the app processes on your host (hot-reload, debugging), the
backing services (Postgres, Redis, Elasticsearch) still come from Docker, and
`.env` already points them at `localhost`.

**Prerequisites:** Node ≥ 20, [pnpm](https://pnpm.io) 11, and Docker (for the
three backing services only).

**1. Install deps and env file**

```bash
pnpm install
cp .env.example .env
```

**2. Start the backing services** (Postgres, Redis, Elasticsearch)

```bash
docker compose up -d postgres redis elasticsearch
```

**3. Migrate the DB + seed Ethereal senders + create the ES index** (one command)

```bash
pnpm bootstrap
```

### Backend

The backend is **two processes** — run each in its own terminal:

```bash
# Terminal A — Express REST API + Bull Board dashboard  (http://localhost:4000)
pnpm --filter @outbox/api dev

# Terminal B — BullMQ worker: sends emails + indexes them into Elasticsearch
pnpm --filter @outbox/worker dev
```

- **API** (`:4000`) serves the REST endpoints, Google/Slack OAuth callbacks, and
  Bull Board at `/admin/queues`. It's stateless — restarting it never touches the
  schedule.
- **Worker** consumes delayed jobs from Redis, enforces the rate limit, sends via
  Ethereal SMTP, then indexes into Elasticsearch (both the send worker and the
  index worker run inside this single process).

### Frontend

```bash
# Terminal C — Next.js dashboard  (http://localhost:3000)
pnpm --filter @outbox/web dev
```

Open **http://localhost:3000**, sign in with Google, and you're on the dashboard.

> **Shortcut:** `pnpm dev` from the repo root runs the API, worker, and web
> together in parallel (after steps 1–3 above).

---

## Running the whole app (Docker — recommended)

The one-command path in [Evaluation quickstart](#evaluation-quickstart) above
(`docker compose up --build`) boots everything — Postgres, Redis, Elasticsearch,
the API, the worker, and the web dashboard — with migrations and seeding handled
by the `migrate` init container. Nothing else to configure.

---

## Testing

```bash
pnpm typecheck   # TypeScript across all packages
pnpm lint        # ESLint
pnpm test        # Vitest unit tests (infra-dependent tests skip without services)
```

**Against a running stack** (start it with Docker or the local path above):

```bash
pnpm smoke-test                   # end-to-end: create a campaign → poll until sent → assert searchable
pnpm load-test                    # enqueue 1200 jobs at the same instant; prints the drain (watch Bull Board)
pnpm tsx scripts/demo-restart.ts  # restart-safety drill: schedule, restart api+worker, confirm nothing is lost
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck, lint,
and unit tests, then brings up the compose stack and runs the smoke test.

---

## Environment variables

All parsed and defaulted through Zod in [`packages/shared/src/env.ts`](packages/shared/src/env.ts).
Copy `.env.example` → `.env`; it works as-is (localhost URLs, sensible defaults).
Compose overrides the service URLs with container names internally.

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_PORT` / `REDIS_PORT` / `ES_PORT` | 5432 / 6379 / 9200 | Published host ports |
| `API_PORT` / `WEB_PORT` | 4000 / 3000 | Published host ports |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | outbox | Postgres credentials |
| `DATABASE_URL` | `postgres://outbox:outbox@localhost:5432/outbox` | Host view of Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Host view of Redis |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Host view of Elasticsearch |
| `WORKER_CONCURRENCY` | 5 | Jobs processed in parallel per worker |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | 2000 | **Minimum spacing between sends from one sender (2s)** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 200 | Hourly quota per sender |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | 1000 | Optional global cap |
| `RATE_LIMIT_WINDOW_MS` | 3600000 | Rate-limit window (shortened in `.env.demo`) |
| `STALLED_SEND_THRESHOLD_MS` | 120000 | Reclaim rows stuck in `sending` past this |
| `ETHEREAL_USER_1..3` / `ETHEREAL_PASS_1..3` | blank | SMTP senders — blank auto-creates test accounts |
| `JWT_SECRET` | `dev-insecure-…` | Signs the session + Slack-state JWTs |
| `BULLBOARD_USER` / `BULLBOARD_PASS` | admin / admin | Bull Board basic auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | committed | Google OAuth login (shared for eval; rotated after) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URI` | committed | Slack OAuth (incoming-webhook) — shared for eval; rotated after |
| `NEXT_PUBLIC_API_URL` / `WEB_URL` | localhost:4000 / :3000 | Browser-facing URLs |

A tiny-window demo profile lives in `.env.demo` (window 120s, 5/sender) so the
rate limiter and Slack alert are observable in a short live demo. Pass **both**
env files — `.env` first for the base config (DB URLs, OAuth creds), then
`.env.demo` to override the two rate-limit values (Compose applies them in order,
last wins; a single `--env-file .env.demo` would drop the OAuth creds and break
login):
`docker compose --env-file .env --env-file .env.demo up`.

### Ethereal setup

Ethereal is a fake SMTP service — mail is captured, never delivered, and each
message gets a preview URL. **Nothing to configure:** on first boot `pnpm bootstrap`
calls Ethereal's API to create three throwaway test accounts and seeds them as
senders. Sent rows link their Ethereal preview from the Sent tab. To pin your own
accounts (e.g. offline), create them at https://ethereal.email/create and set
`ETHEREAL_USER_1..3` / `ETHEREAL_PASS_1..3` in `.env`.

---

## Architecture summary

Three processes over Postgres (source of truth), Redis (durable schedule +
rate-limit state) and Elasticsearch (search index):

- **`api`** — Express REST, Google/Slack OAuth callbacks, Bull Board. Stateless;
  restarting it never touches the schedule.
- **`worker`** — consumes delayed jobs, enforces rate limits via an atomic Lua
  reserve, sends via Ethereal, then indexes into Elasticsearch on a second queue.
- **`web`** — Next.js dashboard, a thin typed client over the API.

**Scheduling** is BullMQ delayed jobs (`delay = scheduledAt − now`) parked in a
Redis sorted set — no cron anywhere. **Persistence:** Postgres holds the truth,
Redis is AOF-persisted, and a boot reconciler rebuilds the schedule from Postgres
after any restart under deterministic job IDs, so nothing is lost or duplicated.
**Concurrency** is BullMQ worker concurrency (`WORKER_CONCURRENCY`, default 5):
each worker pulls at most that many jobs in parallel, and every send passes through
an atomic `claimForSending` (single SQL `UPDATE … WHERE status='scheduled'`), so
two workers can never send the same email — safe to scale workers horizontally.
**Rate limiting** is a single Redis Lua script (check-and-reserve, atomic across
workers); over-quota jobs `moveToDelayed` into the next window rather than failing,
and fire one Slack alert per sender per window.

📖 **Full detail — read this for the review:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(scheduling §3, persistence §4, idempotency §5, concurrency + rate limiting §6,
behaviour under load §7). Design decisions are logged in [`docs/DECISIONS/`](docs/DECISIONS).

---

## Features — mapped to `docs/REQUIREMENTS.md`

Line references are to [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

### Backend

| Requirement (REQUIREMENTS.md) | Status | Where |
|---|---|---|
| Accept scheduling requests via API (§1) | ✅ | `POST /api/campaigns` — [`apps/api/src/routes.ts`](apps/api/src/routes.ts) |
| Store in a relational DB (§1) | ✅ | Postgres + Drizzle — [`packages/db/src/schema.ts`](packages/db/src/schema.ts) |
| Schedule via BullMQ delayed jobs, **no cron** (§1, §3) | ✅ | [`packages/queue/src/index.ts`](packages/queue/src/index.ts); ARCHITECTURE §3 |
| Send from multiple senders via Ethereal (§1) | ✅ | quota-aware sender pick — [`apps/worker/src/index.ts`](apps/worker/src/index.ts) |
| Searchable via Elasticsearch indexing (§1) | ✅ | [`packages/search/src/index.ts`](packages/search/src/index.ts); `GET /api/emails/search` |
| Live BullMQ dashboard (§1) | ✅ | Bull Board at `/admin/queues` |
| Persist across restart, no loss (§1, §3) | ✅ | AOF + boot reconciler — [`apps/worker/src/reconcile.ts`](apps/worker/src/reconcile.ts) |
| No duplicates / idempotency (§3) | ✅ | deterministic jobId + guarded claim + `UNIQUE(campaign_id, recipient)`; ARCHITECTURE §5 |
| Configurable worker concurrency, parallel-safe (§2) | ✅ | `WORKER_CONCURRENCY`; atomic `claimForSending` |
| Minimum delay between sends (§2) | ✅ | `MIN_DELAY_BETWEEN_EMAILS_MS` (2s) — throttle gate in `rate-limit.lua` |
| Per-sender hourly rate limit, Redis-backed, configurable (§2) | ✅ | [`packages/queue/rate-limit.lua`](packages/queue/rate-limit.lua); ARCHITECTURE §6 |
| Over-limit → reschedule, don't drop, preserve order (§2) | ✅ | `moveToDelayed` + seq offset — worker QUOTA branch |
| Slack OAuth + live alert on limit hit; connect/disconnect-safe (§2) | ✅ | [`apps/api/src/slack.ts`](apps/api/src/slack.ts), [`apps/worker/src/notify.ts`](apps/worker/src/notify.ts) |
| Defined behaviour under load (1000+ same instant) (§2) | ✅ | ARCHITECTURE §7 + `scripts/load-test.ts` |

### Frontend

| Requirement (REQUIREMENTS.md) | Status | Where |
|---|---|---|
| Real Google OAuth login → dashboard (§F1) | ✅ | [`apps/api/src/auth.ts`](apps/api/src/auth.ts), [`apps/web/app/login`](apps/web/app/login) |
| Header: name, email, avatar, logout (§F1) | ✅ | [`apps/web/components/AppHeader.tsx`](apps/web/components/AppHeader.tsx) |
| Dashboard: Scheduled / Sent tabs + Compose button (§F2) | ✅ | [`apps/web/app/dashboard/page.tsx`](apps/web/app/dashboard/page.tsx) |
| Compose: subject, body, CSV upload w/ detected count, start/delay/hourly (§F3) | ✅ | [`apps/web/components/ComposeModal.tsx`](apps/web/components/ComposeModal.tsx), [`apps/web/lib/parse-leads.ts`](apps/web/lib/parse-leads.ts) |
| Scheduled table: Email, Subject, Scheduled time, Status (§F4) | ✅ | dashboard page |
| Sent table: Email, Subject, Sent time, Status(sent/failed) (§F5) | ✅ | + Ethereal preview link + `last_error` on failed rows |
| Loading + empty states (§F4/§F5) | ✅ | skeleton rows, designed empty state with CTA |
| Reusable components, typed API, toasts/error handling (§F6) | ✅ | `apps/web/components/ui/*`, `@outbox/shared` types, Toast |
| Search box wired to search API | ✅ | debounced → `GET /api/emails/search` |

Beyond the spec: server pagination, live `refetchInterval` so rows migrate
Scheduled→Sent without a refresh, and a Postgres `ILIKE` fallback when
Elasticsearch is unreachable (`degraded: true`).

---

## Trade-offs, assumptions & shortcuts

- **OAuth credentials are shared in this private repo for evaluation
  convenience and will be rotated after evaluation.** Both the Google and Slack
  client id/secret are committed to `.env.example` so reviewers get working login
  and Slack Connect on a fresh clone (the repo is private). All shared creds will
  be rotated once evaluation is complete.
- **Sender SMTP credentials are stored unencrypted** in Postgres. Production would
  wrap them with a KMS (see ARCHITECTURE §12).
- **Elasticsearch runs single-node with security disabled** — local/dev only.
- **Search is eventually consistent:** results lag Postgres by the index-job
  latency, and the ILIKE fallback during an ES outage is unranked. The plain list
  endpoints are always exact.
- **Ordering within a rescheduled window is approximate** — BullMQ gives no
  cross-worker ordering guarantee for jobs due in the same millisecond.
- **No dead-letter UI** — exhausted-attempt failures are visible in Bull Board.
- Assumes internet on first boot (Ethereal account creation; Google/Slack OAuth).

---

## Demo video

**▶ [Watch the demo (≤5 min)](https://drive.google.com/file/d/1bGkxoYdddcW5ty6JYH39n1a1gKyIZp5u/view?usp=sharing)**

Walkthrough: Google login, compose + schedule from the UI, Scheduled→Sent live,
the restart scenario (stop → start → future emails still send), and
rate-limit/delay behaviour under load.

---

## Submission

Private repo; collaborators **Mitrajit** and **Yadav036** invited per the
assignment.
