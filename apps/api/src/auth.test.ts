import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { sessionTokenFromRequest } from './auth.js';

/** Minimal Request stub: only the two accessors sessionTokenFromRequest touches. */
function req(cookie?: string, authorization?: string): Request {
  return {
    headers: { cookie },
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authorization : undefined,
  } as unknown as Request;
}

describe('sessionTokenFromRequest', () => {
  it('prefers the session cookie over a Bearer header', () => {
    expect(
      sessionTokenFromRequest(req('a=1; outbox_session=cookieTok; b=2', 'Bearer hdrTok')),
    ).toBe('cookieTok');
  });

  it('falls back to the Bearer header when no cookie is present', () => {
    expect(sessionTokenFromRequest(req(undefined, 'Bearer hdrTok'))).toBe('hdrTok');
  });

  it('returns null when neither is present', () => {
    expect(sessionTokenFromRequest(req())).toBeNull();
  });

  it('ignores a non-Bearer authorization scheme', () => {
    expect(sessionTokenFromRequest(req(undefined, 'Basic zzz'))).toBeNull();
  });
});
