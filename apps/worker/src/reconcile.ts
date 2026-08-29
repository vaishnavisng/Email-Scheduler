import { env } from '@outbox/shared';
import { enqueueEmailSends } from '@outbox/queue';
import { getReconcilable, resetStalledSends } from '@outbox/db';

/**
 * Runs ONCE at worker boot — not on a timer, not a cron (CONVENTIONS.md constraint 1).
 * It is crash recovery: rebuild the Redis schedule from Postgres, which is the
 * source of truth. Safe to run on every boot because all three idempotency
 * layers hold (deterministic jobId, guarded claim, unique constraint) — see
 * docs/DECISIONS/0004-idempotency.md.
 *
 *   1. Un-stick rows a killed worker left in `sending` (past the stall
 *      threshold, no message_id, attempts < 3) → back to `scheduled`.
 *   2. Re-enqueue every `scheduled`/`queued` row (now including the ones just
 *      un-stuck) with its deterministic jobId. BullMQ silently ignores jobIds
 *      that already exist, so nothing double-sends; overdue rows go out with
 *      delay 0 and drain under the rate limiter.
 */
export async function reconcileOnBoot(): Promise<void> {
  const stalled = await resetStalledSends(env.STALLED_SEND_THRESHOLD_MS);
  const rows = await getReconcilable();
  await enqueueEmailSends(rows);
  console.log(
    `reconcile: ${stalled.length} stalled send(s) reset, ${rows.length} row(s) re-enqueued`,
  );
}
