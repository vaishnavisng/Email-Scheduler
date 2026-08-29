import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { env } from '@outbox/shared';
import {
  emailSendQueue,
  enqueueEmailSends,
  closeEmailSendQueue,
} from './index.js';

// Needs a live Redis. Skips (rather than fails) when none is reachable at
// REDIS_URL, so `pnpm test` stays green in CI / on a host that can't resolve the
// Docker service name; runs for real inside the stack. The probe is bounded so a
// missing Redis skips fast instead of hanging on ioredis's infinite retry.
async function redisReachable(): Promise<boolean> {
  const probe = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // one shot, no reconnect loop
  });
  probe.on('error', () => {}); // swallow connect errors; absence ⇒ skip
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisUp = await redisReachable();

afterAll(async () => {
  await closeEmailSendQueue().catch(() => {});
});

describe.skipIf(!redisUp)('idempotency: deterministic jobId dedup', () => {
  it('enqueuing one row twice leaves exactly one job', async () => {
    const id = randomUUID();
    const jobId = `email-${id}`;
    // Far-future delay so it sits in `delayed` and no worker can drain it.
    const scheduledAt = new Date(Date.now() + 3_600_000);

    await enqueueEmailSends([{ id, scheduledAt }]);
    await enqueueEmailSends([{ id, scheduledAt }]); // second add must be a no-op

    const q = emailSendQueue();
    const mine = (await q.getJobs(['delayed', 'waiting', 'active'])).filter(
      (j) => j.id === jobId,
    );
    expect(mine.length).toBe(1);

    await mine[0]?.remove();
  });
});
