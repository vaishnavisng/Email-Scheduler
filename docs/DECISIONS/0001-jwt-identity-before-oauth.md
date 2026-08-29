# 1. Zero-dependency HS256 JWT for identity, issued at OAuth login

Status: accepted (Phase 2)

## Context

Every Phase 2 endpoint is user-scoped, but Google OAuth (the token issuer) doesn't
land until Phase 6. We need real per-user identity now without violating the
"no mock auth, no dev-login" constraint.

## Decision

The API authenticates with a signed HS256 JWT whose `sub` claim is the internal
user id. Sign/verify is ~40 lines on Node's `crypto` (`packages/shared/jwt.ts`) —
no `jsonwebtoken` dependency for what the stdlib does. Phase 6's OAuth callback
mints the token after `ensureUser` upserts the Google profile by `google_sub`;
until then a test token drives the same verified path. The API only ever
*verifies* — it never issues a bypass token or skip-auth route.

## Consequences

- Real auth boundary exists from Phase 2; Phase 6 adds the issuer, not the check.
- Single shared secret, no key rotation (`ponytail:` noted in the file). Adequate
  for one service; revisit if tokens ever cross a trust boundary.
