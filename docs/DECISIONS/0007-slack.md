# 0007 — Slack OAuth and rate-limit notifications

## Status

Accepted (Phase 6).

## Context

When a sender hits its hourly quota, jobs re-park into the next window. Operators
want to know this is happening without watching Bull Board. The spec asks for a
Slack notification with three properties: a user who connects Slack *later* must
start getting alerts with no redeploy; a burst of hundreds of re-parked jobs must
produce one message, not hundreds; and a broken webhook must never fail an email
send.

Two design frictions shaped the rest:

1. **No session store.** The API authenticates with a Bearer JWT (SPA style);
   there is no cookie session and, at this phase, no Google login wired up. A
   browser navigating to `/api/slack/connect` therefore carries no identity, and
   Slack's callback carries none either.
2. **The worker must read fresh state.** Anything cached at worker boot would
   miss users who connect afterwards.

## Decision

**State carries identity, signed.** `/api/slack/connect` (Bearer-authed) returns
`{ url }` — a Slack authorize URL whose `state` is a short-TTL (10 min) HS256 JWT
of `{ sub: userId }`, reusing `packages/shared/jwt.ts`. The public callback
verifies that state to recover the user id, so it needs no session store. This is
also why `connect` returns JSON instead of a 302: the SPA has the Bearer token
and does the redirect itself; a top-level browser navigation couldn't send the
header.

**Callback is public, mounted first.** Slack redirects the browser to
`/api/slack/callback` with no auth header, so it is mounted before the
Bearer-guarded `/api` router. It exchanges the code at `oauth.v2.access`, upserts
the integration (`UNIQUE(user_id)` → reconnect replaces), and 302s back to the
dashboard with a `?slack=` status flag.

**Notifications read the DB every call and dedupe in Redis.**
`notifyRateLimit(userId, senderId, ctx)` (`apps/worker/src/notify.ts`):

- reads `slack_integrations` on every call — no boot cache — so a later connect
  just works;
- no integration → returns silently (not an error);
- `SET slack:notified:{userId}:{senderId}:{window} NX EX <window>` gates the
  send: a null reply means the key already exists, so we skip. One message per
  user+sender+window;
- posts a Block Kit message and wraps everything in try/catch, so a dead webhook
  is logged at `warn` and swallowed — it can never fail the email job.

Dependencies (Redis client, integration getter, HTTP post, clock) are injectable
with real defaults, so the no-integration and dedupe paths are unit-tested
(`notify.test.ts`) without a live DB, Redis, or Slack.

## Consequences

- OAuth client id/secret are committed to this **private** repo's `.env.example`
  so reviewers can Connect Slack without creating their own app. They'll be
  rotated after evaluation (ARCHITECTURE §11).
- `connect` returning JSON assumes a fetch-capable client. Until the dashboard's
  Connect button lands, the flow is driven by an authenticated fetch, not a plain
  link. A cookie-session redirect flow would only be worth it alongside the
  Google login work.
- Dedupe reuses the same fixed-window index as the rate limiter
  (`docs/DECISIONS/0006-rate-limiting.md`), so notification windows line up with
  quota windows by construction.
