import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT sign/verify on Node crypto — no dependency for ~40 lines.
 * Phase 6 mints these tokens after Google OAuth; this file is just the
 * signature/claims layer both the issuer (Phase 6) and the API verifier share.
 *
 * ponytail: HS256 + shared secret, no key rotation. Fine for a single service
 * behind one JWT_SECRET; add JWKS/asymmetric keys only if tokens ever cross a
 * trust boundary.
 */

export interface JwtClaims {
  /** Subject — our internal user id. */
  sub: string;
  /** Issued-at (seconds). */
  iat: number;
  /** Expiry (seconds). Absent = never expires. */
  exp?: number;
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64url');

const b64urlJson = (obj: unknown): string =>
  b64url(Buffer.from(JSON.stringify(obj)));

function sign(input: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(input).digest());
}

export function signJwt(
  claims: Omit<JwtClaims, 'iat'> & { iat?: number },
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtClaims = { iat: Math.floor(Date.now() / 1000), ...claims };
  const body = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  return `${body}.${sign(body, secret)}`;
}

/** Returns claims if the signature is valid and the token is unexpired, else null. */
export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (typeof claims.sub !== 'string') return null;
  if (claims.exp !== undefined && claims.exp < Date.now() / 1000) return null;
  return claims;
}
