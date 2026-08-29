import { sql, ensureUser } from '@outbox/db';
import { signJwt, env } from '@outbox/shared';

/**
 * Load test: 1200 recipients all scheduled for the same instant, to exercise the
 * rate limiter, the QUOTA re-park path and the Slack notification under pressure.
 *
 *   node --env-file=.env --import tsx scripts/load-test.ts   (or: pnpm load-test)
 *
 * Creates the campaign over HTTP, then samples queue depth (pending vs sent) from
 * Postgres for ~2 minutes so you can watch the drain — and screenshot Bull Board
 * at /admin/queues while it runs. It does NOT wait for full drain (that takes as
 * long as the configured window × quota); Ctrl-C any time.
 */

const API = process.env.API_URL ?? `http://localhost:${env.API_PORT}`;
const COUNT = 1200;
const SAMPLE_MS = 5_000;
const SAMPLES = 24; // ~2 minutes
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const user = await ensureUser({
    googleSub: 'demo-bootstrap-user',
    email: 'demo@outbox.local',
    name: 'Demo User',
  });
  const H = {
    authorization: `Bearer ${signJwt({ sub: user.id }, env.JWT_SECRET)}`,
    'content-type': 'application/json',
  };

  const tag = `load-${Date.now()}`;
  const recipients = Array.from(
    { length: COUNT },
    (_, i) => `${tag}-${i}@example.com`,
  );

  console.log(`Creating ${COUNT} recipients, all firing ~now (same instant)…`);
  const started = Date.now();
  const res = await fetch(`${API}/api/campaigns`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      subject: tag,
      body: 'load test',
      startAt: new Date(Date.now() + 3_000).toISOString(),
      delayMs: 0, // all target the same instant — the rate limiter paces them
      recipients,
      hourlyLimit: null,
    }),
  });
  const camp = await res.json();
  if (res.status !== 201) {
    console.error('create failed', res.status, JSON.stringify(camp));
    process.exit(1);
  }
  console.log(
    `Created campaign ${camp.id} (${camp.totalRecipients} rows) in ${Date.now() - started}ms.`,
  );
  console.log(
    `\nConfig: WORKER_CONCURRENCY=${env.WORKER_CONCURRENCY}, ` +
      `MIN_DELAY=${env.MIN_DELAY_BETWEEN_EMAILS_MS}ms, ` +
      `${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/sender/window, ` +
      `window=${env.RATE_LIMIT_WINDOW_MS}ms`,
  );
  console.log(
    `\nWatch the drain in Bull Board: ${API.replace(/\/$/, '')}/admin/queues ` +
      `(basic auth ${env.BULLBOARD_USER}/${env.BULLBOARD_PASS})\n`,
  );

  console.log('elapsed_s  sent  pending(sched/queued/sending)  failed');
  for (let i = 0; i <= SAMPLES; i++) {
    const [row] = await sql<
      { sent: number; pending: number; failed: number }[]
    >`
      select
        count(*) filter (where status = 'sent')                              as sent,
        count(*) filter (where status in ('scheduled','queued','sending'))   as pending,
        count(*) filter (where status = 'failed')                            as failed
      from emails where campaign_id = ${camp.id}`;
    const t = String(Math.round((Date.now() - started) / 1000)).padStart(7);
    console.log(
      `${t}  ${String(row.sent).padStart(4)}  ${String(row.pending).padStart(27)}  ${String(row.failed).padStart(6)}`,
    );
    if (row.pending === 0) break;
    if (i < SAMPLES) await sleep(SAMPLE_MS);
  }

  await sql.end();
  console.log(
    '\nSampling window ended (jobs keep draining in the background subject to the rate limiter).',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('load-test failed:', err);
  process.exit(1);
});
