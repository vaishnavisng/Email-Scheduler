import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { env } from '@outbox/shared';
import { defineReserveSlot, reserveSlot } from './rate-limit.js';

// Needs a live Redis. Skips (rather than fails) when none is reachable at
// REDIS_URL, mirroring idempotency.test.ts — green in CI, real inside the stack.
async function redisReachable(r: Redis): Promise<boolean> {
  r.on('error', () => {});
  try {
    await r.connect();
    return (await r.ping()) === 'PONG';
  } catch {
    return false;
  }
}

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  connectTimeout: 1500,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
const redisUp = await redisReachable(redis);
if (redisUp) defineReserveSlot(redis);

afterAll(async () => {
  redis.disconnect();
});

// Big window so tests that shouldn't roll over don't; unique senderId per test
// isolates keys so cases can't bleed into each other.
const WINDOW = 3_600_000;
const base = () => ({
  now: Date.now(),
  minDelay: 0,
  windowMs: WINDOW,
  globalLimit: 0,
});

describe.skipIf(!redisUp)('reserveSlot: atomic throttle + quota', () => {
  it('exhausts the per-sender quota', async () => {
    const senderId = randomUUID();
    const opts = { ...base(), senderId, limit: 3 };
    const reasons = [];
    for (let i = 0; i < 4; i++) {
      reasons.push((await reserveSlot(redis, opts)).reason);
    }
    expect(reasons).toEqual(['OK', 'OK', 'OK', 'QUOTA']);
  });

  it('throttles a too-soon second send, then allows it after minDelay', async () => {
    const senderId = randomUUID();
    const now = Date.now();
    const opts = { senderId, minDelay: 50, limit: 100, windowMs: WINDOW, globalLimit: 0 };

    expect((await reserveSlot(redis, { ...opts, now })).reason).toBe('OK');

    const throttled = await reserveSlot(redis, { ...opts, now: now + 10 });
    expect(throttled.reason).toBe('THROTTLE');
    expect(throttled.waitMs).toBeGreaterThan(0);

    const after = await reserveSlot(redis, { ...opts, now: now + 50 });
    expect(after.reason).toBe('OK');
  });

  it('resets quota when the window rolls over', async () => {
    const senderId = randomUUID();
    // Pin `now` into a window, exhaust it, then step one full window forward.
    const now = Math.floor(Date.now() / WINDOW) * WINDOW;
    const opts = { senderId, minDelay: 0, limit: 1, windowMs: WINDOW, globalLimit: 0 };

    expect((await reserveSlot(redis, { ...opts, now })).reason).toBe('OK');
    expect((await reserveSlot(redis, { ...opts, now })).reason).toBe('QUOTA');
    expect((await reserveSlot(redis, { ...opts, now: now + WINDOW })).reason).toBe('OK');
  });

  it('lets exactly `limit` win under 50 concurrent reservations', async () => {
    const senderId = randomUUID();
    const opts = { ...base(), senderId, limit: 10 };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => reserveSlot(redis, opts)),
    );
    expect(results.filter((r) => r.ok).length).toBe(10);
  });
});
