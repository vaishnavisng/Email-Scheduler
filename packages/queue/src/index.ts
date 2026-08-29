import { Redis } from 'ioredis';
import { env } from '@outbox/shared';

/**
 * Shared Redis connection factory. BullMQ requires maxRetriesPerRequest: null
 * on the connection it blocks on. Queues/workers are added per phase; for now
 * this exports the connection and a liveness ping for /health.
 */
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
