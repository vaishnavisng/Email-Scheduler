import { env } from '@outbox/shared';
import { createRedis, pingRedis } from '@outbox/queue';
import { pingDb } from '@outbox/db';

/**
 * Worker boot. No queue/consumer yet (Phase 3+). For now it just verifies its
 * backing services are reachable and stays alive, so compose can bring it up
 * healthy alongside the api.
 */
const redis = createRedis();

async function main(): Promise<void> {
  const [db, redisOk] = await Promise.all([pingDb(), pingRedis(redis)]);
  console.log(
    `worker up (concurrency=${env.WORKER_CONCURRENCY}) db=${db ? 'ok' : 'down'} redis=${
      redisOk ? 'ok' : 'down'
    }`,
  );
}

main().catch((err) => {
  console.error('worker boot failed:', err);
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await redis.quit();
    process.exit(0);
  });
}
