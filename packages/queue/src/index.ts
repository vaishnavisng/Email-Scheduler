import { Redis } from 'ioredis';
import { Queue, type JobsOptions } from 'bullmq';
import { env } from '@outbox/shared';

/**
 * Shared Redis connection factory. BullMQ requires maxRetriesPerRequest: null
 * on the connection it blocks on.
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

export const EMAIL_SEND_QUEUE = 'email-send';

/** Payload for an email-send job. The row id is the only state carried in Redis;
 * everything else is read fresh from Postgres when the job runs. */
export interface EmailJobData {
  emailId: string;
}

/**
 * Default job options for the send queue.
 * - attempts/backoff: retry transient SMTP failures, exponential from 5s.
 * - removeOnComplete/removeOnFail: keep recent history so Bull Board can show it
 *   during the demo. NEVER `removeOnComplete: true` — that wipes completed jobs
 *   immediately and the board would look empty.
 */
const emailJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 5000 },
  removeOnFail: { age: 604800 },
};

/** One Queue instance per process; construct lazily so importing this module
 * (e.g. in the API just for createRedis) doesn't open a queue connection. */
let queue: Queue<EmailJobData> | undefined;
export function emailSendQueue(): Queue<EmailJobData> {
  if (!queue) {
    queue = new Queue<EmailJobData>(EMAIL_SEND_QUEUE, {
      connection: createRedis(),
      defaultJobOptions: emailJobOptions,
    });
  }
  return queue;
}

/** Close the lazy queue singleton (and its Redis connection). Mainly for tests
 * and graceful shutdown — without it the connection keeps the process alive. */
export async function closeEmailSendQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

const CHUNK = 500;

export interface EmailToEnqueue {
  id: string;
  scheduledAt: Date;
}

/**
 * Enqueue send jobs for freshly-created email rows. Called by POST /api/campaigns
 * AFTER the DB transaction commits (a job pointing at an uncommitted row is an
 * unrecoverable race; the reverse — committed row, lost enqueue — is recovered by
 * the boot reconciler).
 *
 * jobId = `email-${row.id}` is deterministic and load-bearing for idempotency:
 * BullMQ refuses a second job with an existing id, so re-enqueueing the same row
 * (reconciler, retried request) can never double-schedule a send.
 *
 * Note: BullMQ forbids ':' in a custom jobId (it's the Redis key separator), so
 * the convention documented as `email:{id}` uses '-'. The row id is a UUID, so
 * determinism/uniqueness are unaffected — the prefix is just namespacing.
 */
export async function enqueueEmailSends(rows: EmailToEnqueue[]): Promise<void> {
  if (rows.length === 0) return;
  const now = Date.now();
  const q = emailSendQueue();
  for (let i = 0; i < rows.length; i += CHUNK) {
    await q.addBulk(
      rows.slice(i, i + CHUNK).map((r) => ({
        name: 'send',
        data: { emailId: r.id },
        opts: {
          jobId: `email-${r.id}`,
          delay: Math.max(0, r.scheduledAt.getTime() - now),
        },
      })),
    );
  }
}
