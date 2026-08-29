import { and, asc, count, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { EmailStatus, EmailListItem } from '@outbox/shared';
import { db } from './index.js';
import { campaigns, emails } from './schema.js';

export type EmailRow = typeof emails.$inferSelect;

/**
 * The single place email/campaign rows are written or read. Route handlers never
 * touch these tables directly (CONVENTIONS.md). The two pure helpers below are unit
 * tested; the DB functions are exercised by the smoke gate.
 */

/** scheduled_at = start_at + seq * delay_ms. Pure, so it's unit-testable. */
export function scheduledAtFor(
  startAt: Date,
  seq: number,
  delayMs: number,
): Date {
  return new Date(startAt.getTime() + seq * delayMs);
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Clamp caller-supplied paging to sane bounds. NaN/negative/huge all normalize. */
export function clampPagination(input: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number; offset: number; limit: number } {
  const page = Number.isFinite(input.page) ? Math.floor(input.page as number) : 1;
  const pageSize = Number.isFinite(input.pageSize)
    ? Math.floor(input.pageSize as number)
    : DEFAULT_PAGE_SIZE;
  const safePage = Math.max(1, page);
  const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  return {
    page: safePage,
    pageSize: safeSize,
    offset: (safePage - 1) * safeSize,
    limit: safeSize,
  };
}

export interface CreateCampaignInput {
  subject: string;
  body: string;
  startAt: Date;
  delayMs: number;
  recipients: string[];
  hourlyLimit?: number | null;
}

/**
 * Insert the campaign plus one email row per (deduped) recipient in one
 * transaction. Does not enqueue — Phase 3 does that. Duplicate recipients are
 * collapsed so the UNIQUE(campaign_id, recipient) constraint can't 500 a request.
 */
export async function createCampaignWithEmails(
  userId: string,
  input: CreateCampaignInput,
): Promise<{
  id: string;
  totalRecipients: number;
  emails: { id: string; scheduledAt: Date }[];
}> {
  const recipients = [...new Set(input.recipients.map((r) => r.trim()))].filter(
    Boolean,
  );

  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        userId,
        subject: input.subject,
        body: input.body,
        startAt: input.startAt,
        delayMs: input.delayMs,
        hourlyLimit: input.hourlyLimit ?? null,
        totalRecipients: recipients.length,
      })
      .returning({ id: campaigns.id });
    // Drizzle types .returning() as possibly-empty; a single insert always yields one row.
    if (!campaign) throw new Error('campaign insert returned no row');
    const campaignId = campaign.id;

    // .returning() the ids + fire times so the caller can enqueue after commit.
    const inserted =
      recipients.length > 0
        ? await tx
            .insert(emails)
            .values(
              recipients.map((recipient, seq) => ({
                campaignId,
                userId,
                recipient,
                subject: input.subject,
                body: input.body,
                status: 'scheduled' as const,
                seq,
                scheduledAt: scheduledAtFor(input.startAt, seq, input.delayMs),
              })),
            )
            .returning({ id: emails.id, scheduledAt: emails.scheduledAt })
        : [];

    return {
      id: campaignId,
      totalRecipients: recipients.length,
      emails: inserted,
    };
  });
}

/**
 * Idempotency layer 2: atomically claim a row for sending. The single guarded
 * UPDATE means that with concurrency > 1 exactly one worker wins. Zero rows back
 * = another worker has it, or it's already sent/cancelled — the caller returns
 * successfully rather than throwing.
 */
export async function claimForSending(id: string): Promise<EmailRow | null> {
  const [row] = await db
    .update(emails)
    .set({
      status: 'sending',
      attempts: sql`${emails.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(emails.id, id), inArray(emails.status, ['scheduled', 'queued'])),
    )
    .returning();
  return row ?? null;
}

/** Minimal read for the rate-limiter path, which runs BEFORE the row is claimed:
 * it needs `seq` (quota re-park ordering offset) without pulling the whole row.
 * Null = row is gone. */
export async function getEmailForSchedule(
  id: string,
): Promise<{ id: string; seq: number; status: EmailStatus } | null> {
  const [row] = await db
    .select({ id: emails.id, seq: emails.seq, status: emails.status })
    .from(emails)
    .where(eq(emails.id, id));
  return row ?? null;
}

/** Push a rate-limited row's scheduled_at to its next-window fire time. Guarded
 * to pending states so it can never disturb a row that's mid-send or done. */
export async function updateScheduledAt(id: string, when: Date): Promise<void> {
  await db
    .update(emails)
    .set({ scheduledAt: when, updatedAt: new Date() })
    .where(
      and(eq(emails.id, id), inArray(emails.status, ['scheduled', 'queued'])),
    );
}

export async function markSent(
  id: string,
  data: { senderId: string; messageId: string | null; previewUrl: string | null },
): Promise<void> {
  await db
    .update(emails)
    .set({
      status: 'sent',
      sentAt: new Date(),
      senderId: data.senderId,
      messageId: data.messageId,
      previewUrl: data.previewUrl,
      updatedAt: new Date(),
    })
    .where(eq(emails.id, id));
}

/** Release a claimed row back to 'queued' so a BullMQ retry can re-claim it.
 * Without this, a failed send leaves the row stuck in 'sending' and every retry
 * would no-op against the guarded claim. */
export async function resetForRetry(id: string): Promise<void> {
  await db
    .update(emails)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(and(eq(emails.id, id), eq(emails.status, 'sending')));
}

export async function markFailed(id: string, lastError: string): Promise<void> {
  await db
    .update(emails)
    .set({ status: 'failed', lastError, updatedAt: new Date() })
    .where(eq(emails.id, id));
}

/**
 * Boot reconciliation, pass 1: every row Postgres still considers pending. The
 * worker re-enqueues these with their deterministic jobIds; BullMQ ignores any
 * that already exist, so this is safe to run on every boot. Overdue rows are
 * enqueued with delay 0 by `enqueueEmailSends` (it clamps negative delays).
 */
export async function getReconcilable(): Promise<
  { id: string; scheduledAt: Date }[]
> {
  return db
    .select({ id: emails.id, scheduledAt: emails.scheduledAt })
    .from(emails)
    .where(inArray(emails.status, ['scheduled', 'queued']));
}

/**
 * Boot reconciliation, pass 2: rescue rows a worker claimed but never finished
 * (killed mid-send). A row stuck in `sending` past the stall threshold with no
 * `message_id` is reset to `scheduled` so it becomes claimable again — but only
 * while `attempts < 3`, so a poison message can't loop forever. Returns the
 * reset rows for re-enqueue. `updated_at` is the claim time (claimForSending
 * stamps it), so it doubles as "sending since".
 */
export async function resetStalledSends(
  thresholdMs: number,
): Promise<{ id: string; scheduledAt: Date }[]> {
  const cutoff = new Date(Date.now() - thresholdMs);
  return db
    .update(emails)
    .set({ status: 'scheduled', updatedAt: new Date() })
    .where(
      and(
        eq(emails.status, 'sending'),
        isNull(emails.messageId),
        lt(emails.updatedAt, cutoff),
        lt(emails.attempts, 3),
      ),
    )
    .returning({ id: emails.id, scheduledAt: emails.scheduledAt });
}

const toIso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Paginated list of a user's emails, newest-scheduled ordering by seq for stable spacing. */
export async function listEmails(
  userId: string,
  opts: { status?: EmailStatus; page?: number; pageSize?: number },
): Promise<{ data: EmailListItem[]; page: number; pageSize: number; total: number }> {
  const { page, pageSize, offset, limit } = clampPagination(opts);
  const where = opts.status
    ? and(eq(emails.userId, userId), eq(emails.status, opts.status))
    : eq(emails.userId, userId);

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(emails)
      .where(where)
      .orderBy(asc(emails.scheduledAt), asc(emails.seq))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(emails).where(where),
  ]);

  const data: EmailListItem[] = rows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    seq: r.seq,
    scheduledAt: r.scheduledAt.toISOString(),
    sentAt: toIso(r.sentAt),
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));

  return { data, page, pageSize, total: totals?.n ?? 0 };
}
