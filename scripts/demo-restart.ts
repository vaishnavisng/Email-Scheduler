import { sql, ensureUser, createCampaignWithEmails } from '@outbox/db';
import { enqueueEmailSends } from '@outbox/queue';

/**
 * Phase 4 restart-safety drill. Schedules 10 emails at T+3min, then prints the
 * exact commands to restart api + worker mid-flight and what you should observe.
 *
 * The point: restarting both services loses no mail and sends no duplicate,
 * because the schedule lives in Redis (AOF-persisted) and the worker rebuilds it
 * from Postgres via reconcileOnBoot() — see docs/DECISIONS/0005-restart-persistence.md.
 *
 * Run on the host against the compose stack (localhost URLs from .env):
 *   pnpm tsx scripts/demo-restart.ts
 */

const COUNT = 10;
const LEAD_MS = 3 * 60_000; // T+3min

async function main(): Promise<void> {
  const startAt = new Date(Date.now() + LEAD_MS);
  const user = await ensureUser({
    googleSub: 'demo-bootstrap-user', // reuse the seeded demo user (upsert)
    email: 'demo@outbox.local',
    name: 'Demo User',
  });

  const { id, emails } = await createCampaignWithEmails(user.id, {
    subject: 'Phase 4 restart drill',
    body: 'If you are reading exactly one of these, restart safety works.',
    startAt,
    delayMs: 0, // all target T+3min; the worker's min-delay paces them out
    recipients: Array.from({ length: COUNT }, (_, i) => `demo-${i + 1}@example.com`),
  });
  await enqueueEmailSends(emails);
  await sql.end();

  const restartAt = new Date(Date.now() + 60_000); // T+1min
  const hhmm = (d: Date) => d.toTimeString().slice(0, 8);

  console.log(`
Scheduled campaign ${id}: ${emails.length} emails firing at ${hhmm(startAt)} (T+3min).

NOW — start recording your screen, then:

  1. At about ${hhmm(restartAt)} (T+1min, well before send time), restart both services:

       docker compose restart api worker

  2. Watch the worker log for the reconciler rebuilding the schedule from Postgres:

       docker compose logs -f worker    # look for: "reconcile: 0 stalled send(s) reset, N row(s) re-enqueued"

Expected outcome:
  • All ${COUNT} emails still send at ${hhmm(startAt)} — the restart did not drop them.
  • Exactly ${COUNT} messages appear in Ethereal — zero duplicates.
  • Bull Board shows ${COUNT} completed jobs, none failed.
`);
}

main().catch((err) => {
  console.error('demo-restart failed:', err);
  process.exit(1);
});
