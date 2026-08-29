# 0009 — Cookie session, one auth authority

## Status

Accepted (Phase 8). Revises the Bearer-only premise of `0007-slack.md`.

## Context

Phase 8 adds the real Google login and the dashboard shell. Two hard constraints
frame it: auth must be real OAuth with no dev-bypass (CONVENTIONS §2), and there
must be one auth authority — the browser is a thin client. Earlier phases
authenticated the `/api` router with a Bearer JWT (SPA-style, no session), which
a plain top-level browser navigation can't carry.

The web app (`:3000`) and the API (`:4000`) are separate origins. The browser
cannot read an httpOnly cookie, so if the session is a cookie, the API — not the
web app — must both set it and read it.

## Decision

**The Express API runs the entire OAuth code flow and owns the session.**
`apps/api/src/auth.ts`:

- `GET /api/auth/google` sets a short-lived httpOnly `oauth_state` cookie (random
  nonce) and redirects to Google consent, echoing the nonce in `state`.
- `GET /api/auth/google/callback` rejects any `state` that doesn't match the
  cookie (CSRF), exchanges the code, fetches `userinfo`, upserts by `google_sub`
  (`ensureUser`), signs an HS256 JWT and sets it as an httpOnly `outbox_session`
  cookie, then redirects to `/dashboard`.
- `POST /api/auth/logout` clears the cookie.

These public routes mount **before** the guarded `/api` router, like the Slack
callback.

**`requireAuth` reads the cookie first, Bearer second.** A tiny hand-rolled
cookie parse (no `cookie-parser` dep) feeds `sessionTokenFromRequest`, used by
the guard in `routes.ts`. Keeping the Bearer fallback means the bootstrap demo
JWT and any script keep working unchanged.

**Cross-origin cookie via port-independence.** The cookie is host-only for
`localhost` with `sameSite=lax`. Cookies ignore ports, so the cookie the API sets
on `:4000` is also sent to the web origin on `:3000`; `lax` lets it survive the
top-level GET redirect back from Google. Next middleware presence-checks the
cookie to gate routes (redirect to `/login`), but only the API verifies the
signature — the middleware is a cheap guard, not a security boundary. The API
enables `cors({ origin: WEB_URL, credentials: true })` so the browser's
credentialed `fetch` to `:4000` is allowed.

## Consequences

- **Same registrable domain required in real prod.** Port-independence covers
  localhost and any single-domain deploy. Split domains (`app.x.com` /
  `api.x.com`) need an explicit shared parent `Domain` plus `sameSite=none;
  secure`. Marked with a `ponytail:` note in `auth.ts`.
- `0007`'s Slack `connect` still returns JSON and is driven by a credentialed
  fetch (now carrying the cookie instead of a Bearer header) — unchanged.
- `secure` is on only in production, so local http works while real deploys get
  secure cookies.
- CSRF is defended by the state-cookie/param match; the session cookie's `lax`
  scope already blocks cross-site POSTs.
