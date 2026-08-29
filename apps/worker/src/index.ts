import nodemailer from 'nodemailer';
import { Worker, DelayedError, type Job } from 'bullmq';
import { env } from '@outbox/shared';
import {
  createRedis,
  EMAIL_SEND_QUEUE,
  defineReserveSlot,
  reserveSlot,
  readUsed,
  windowFor,
  type EmailJobData,
} from '@outbox/queue';
import {
  claimForSending,
  markSent,
  markFailed,
  resetForRetry,
  getActiveSenders,
  getEmailForSchedule,
  updateScheduledAt,
  type SenderRow,
} from '@outbox/db';
import { pickMostQuota } from './pick.js';
import { reconcileOnBoot } from './reconcile.js';
import { notifyRateLimit } from './notify.js';

/**
 * Worker process. Consumes email-send jobs and sends via Ethereal SMTP. The
 * schedule and rate-limit state live in Redis (not here), so this scales to N
 * instances and restarts without losing work.
 */
const connection = createRedis();
// Rate-limit reservations and quota-aware sender selection run on this client.
// The reserve Lua is registered once at boot (idempotent).
const rr = createRedis();
defineReserveSlot(rr);

async function send(job: Job<EmailJobData>, token?: string): Promise<void> {
  const emailId = job.data.emailId;

  // Rate-limit BEFORE claiming (CLAUDE.md #5: re-park, never fail). We only need
  // seq here, so read it light instead of claiming the row.
  const pending = await getEmailForSchedule(emailId);
  if (!pending || (pending.status !== 'scheduled' && pending.status !== 'queued')) {
    console.log(`email ${emailId}: nothing to send, skipping`);
    return;
  }

  const senders = await getActiveSenders();
  const now = Date.now();
  const window = windowFor(now, env.RATE_LIMIT_WINDOW_MS);
  const used = await readUsed(rr, senders.map((s) => s.id), window);
  const sender = pickMostQuota(senders, used, env.MAX_EMAILS_PER_HOUR_PER_SENDER);
  if (!sender) {
    // No senders provisioned — reset so a retry can pick one up once they exist.
    await resetForRetry(emailId);
    throw new Error('no active senders available');
  }

  const res = await reserveSlot(rr, {
    senderId: sender.id,
    now,
    minDelay: env.MIN_DELAY_BETWEEN_EMAILS_MS,
    limit: sender.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    globalLimit: env.MAX_EMAILS_PER_HOUR_GLOBAL,
  });

  if (res.reason === 'THROTTLE') {
    // Too soon after this sender's last send — re-park by the exact wait.
    await job.moveToDelayed(Date.now() + res.waitMs, token);
    throw new DelayedError();
  }
  if (res.reason === 'QUOTA') {
    // Window (or global cap) spent — re-park to the next window, seq-offset so a
    // campaign's rows drain in order. Persist the new fire time for the reconciler.
    const next =
      (window + 1) * env.RATE_LIMIT_WINDOW_MS +
      pending.seq * env.MIN_DELAY_BETWEEN_EMAILS_MS;
    await updateScheduledAt(emailId, new Date(next));
    const limit = sender.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    // Reuse rr (the reserve client) so notify opens no extra Redis connection.
    // notifyRateLimit never throws — a Slack failure can't fail this job.
    await notifyRateLimit(
      pending.userId,
      sender.id,
      {
        senderLabel: sender.label,
        limit,
        count: used.get(sender.id) ?? limit,
        nextWindowAt: new Date(next),
        campaignName: pending.subject,
      },
      { redis: rr },
    );
    await job.moveToDelayed(next, token);
    throw new DelayedError();
  }

  // Slot reserved. Now claim the row for this send.
  const email = await claimForSending(emailId);
  if (!email) {
    // Another worker claimed it between our read and reserve. Not an error; the
    // reserved slot is left counted (approximate accounting — see the ADR).
    console.log(`email ${emailId}: nothing to claim, skipping`);
    return;
  }

  try {
    const info = await transportFor(sender).sendMail({
      from: `"${sender.fromName}" <${sender.fromEmail}>`,
      to: email.recipient,
      subject: email.subject,
      text: email.body,
    });
    await markSent(email.id, {
      senderId: sender.id,
      messageId: info.messageId ?? null,
      previewUrl: nodemailer.getTestMessageUrl(info) || null,
    });
    console.log(`email ${email.id}: sent via ${sender.label}`);
  } catch (err) {
    // Release the claim so BullMQ's retry can re-claim; then rethrow to trigger it.
    await resetForRetry(email.id);
    throw err;
  }
}

/** One transport per send. ponytail: fine for demo volume; pool by sender id if
 * throughput ever matters. */
function transportFor(sender: SenderRow): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
  });
}

const worker = new Worker<EmailJobData>(EMAIL_SEND_QUEUE, send, {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

// Write the terminal failure once BullMQ has exhausted its retries. Transient
// failures (attempts remaining) are left alone — the row is already back to
// 'queued' from resetForRetry, ready for the next attempt.
worker.on('failed', async (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= attempts) {
    await markFailed(job.data.emailId, err.message).catch((e) =>
      console.error(`email ${job.data.emailId}: markFailed errored`, e),
    );
    console.error(`email ${job.data.emailId}: failed permanently — ${err.message}`);
  }
});

worker.on('ready', () =>
  console.log(`worker up (concurrency=${env.WORKER_CONCURRENCY})`),
);

// One-shot crash recovery at boot — rebuild the Redis schedule from Postgres.
// Not a timer, not a cron; runs exactly once. A failure here shouldn't stop the
// worker from processing new jobs, so log and continue.
reconcileOnBoot().catch((err) =>
  console.error('reconcile: boot reconciliation failed', err),
);

// Await worker.close() so in-flight sends finish before the process exits.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, draining…`);
    await worker.close();
    await Promise.all([connection.quit(), rr.quit()]);
    process.exit(0);
  });
}
