import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from './jwt.js';

const secret = 'test-secret';

describe('jwt', () => {
  it('round-trips a valid token', () => {
    const token = signJwt({ sub: 'user-1' }, secret);
    expect(verifyJwt(token, secret)?.sub).toBe('user-1');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signJwt({ sub: 'user-1' }, secret);
    expect(verifyJwt(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signJwt({ sub: 'user-1' }, secret);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0 })).toString(
      'base64url',
    );
    expect(verifyJwt(`${h}.${forged}.${s}`, secret)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signJwt({ sub: 'user-1', exp: 1 }, secret);
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyJwt('not-a-jwt', secret)).toBeNull();
  });
});
