import { and, asc, count, eq } from 'drizzle-orm';
import type { EmailStatus, EmailListItem } from '@outbox/shared';
import { db } from './index.js';
import { campaigns, emails } from './schema.js';

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
): Promise<{ id: string; totalRecipients: number }> {
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

    if (recipients.length > 0) {
      await tx.insert(emails).values(
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
      );
    }

    return { id: campaignId, totalRecipients: recipients.length };
  });
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
