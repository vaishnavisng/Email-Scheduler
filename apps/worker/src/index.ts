import nodemailer from 'nodemailer';
import { Worker, type Job } from 'bullmq';
import { env } from '@outbox/shared';
import {
  createRedis,
  EMAIL_SEND_QUEUE,
  type EmailJobData,
} from '@outbox/queue';
import {
  claimForSending,
  markSent,
  markFailed,
  resetForRetry,
  getActiveSenders,
  type SenderRow,
} from '@outbox/db';
import { pickRoundRobin } from './pick.js';

/**
 * Worker process. Consumes email-send jobs and sends via Ethereal SMTP. The
 * schedule and rate-limit state live in Redis (not here), so this scales to N
 * instances and restarts without losing work.
 */
const connection = createRedis();
// Sender selection uses a Redis counter so round-robin is consistent across
// worker instances, not per-process. ponytail: plain round-robin for now;
// Phase 4 makes it quota-aware.
const rr = createRedis();

async function send(job: Job<EmailJobData>): Promise<void> {
  const email = await claimForSending(job.data.emailId);
  if (!email) {
    // Another worker claimed it, or it's already sent/cancelled. Not an error.
    console.log(`email ${job.data.emailId}: nothing to claim, skipping`);
    return;
  }

  const senders = await getActiveSenders();
  const sender = pickRoundRobin(senders, await rr.incr('sender:rr'));
  if (!sender) {
    // No senders provisioned — reset so a retry can pick one up once they exist.
    await resetForRetry(email.id);
    throw new Error('no active senders available');
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

// Await worker.close() so in-flight sends finish before the process exits.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, draining…`);
    await worker.close();
    await Promise.all([connection.quit(), rr.quit()]);
    process.exit(0);
  });
}
