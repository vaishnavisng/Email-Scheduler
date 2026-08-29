import { Worker, type Job } from 'bullmq';
import { env } from '@outbox/shared';
import {
  createRedis,
  EMAIL_INDEX_QUEUE,
  type EmailIndexJobData,
} from '@outbox/queue';
import { getEmailForIndex } from '@outbox/db';
import { ensureEmailsIndex, indexEmail } from '@outbox/search';

/**
 * Consumes the `email-index` queue and upserts rows into Elasticsearch. Runs in
 * the worker process but on its own BullMQ Worker, so a slow or down ES back-
 * pressures only indexing, never sending. Upsert-by-id + BullMQ retries give
 * at-least-once indexing; reprocessing the same job is harmless.
 */

// Ensure the index (with the explicit mapping) exists before the first upsert —
// otherwise es.index would auto-create it with a guessed dynamic mapping. Memoise
// the promise so N concurrent jobs ensure once; reset on failure so a job retried
// after ES comes up re-ensures. See docs/DECISIONS/0008-search-indexing.md.
let ensuring: Promise<void> | undefined;
function ensureIndexOnce(): Promise<void> {
  ensuring ??= ensureEmailsIndex().catch((err) => {
    ensuring = undefined;
    throw err;
  });
  return ensuring;
}

async function index(job: Job<EmailIndexJobData>): Promise<void> {
  const row = await getEmailForIndex(job.data.emailId);
  if (!row) {
    console.log(`index ${job.data.emailId}: row gone, skipping`);
    return;
  }
  await ensureIndexOnce();
  await indexEmail(row);
}

export function startIndexWorker(): Worker<EmailIndexJobData> {
  const worker = new Worker<EmailIndexJobData>(EMAIL_INDEX_QUEUE, index, {
    connection: createRedis(),
    concurrency: env.WORKER_CONCURRENCY,
  });
  worker.on('ready', () => console.log('index worker up'));
  worker.on('failed', (job, err) =>
    console.error(`index ${job?.data.emailId}: failed — ${err.message}`),
  );
  return worker;
}
