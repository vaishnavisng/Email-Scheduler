import { asc, count, eq } from 'drizzle-orm';
import type { Sender } from '@outbox/shared';
import { db } from './index.js';
import { senders } from './schema.js';

export type SenderRow = typeof senders.$inferSelect;

/** Active senders WITH SMTP secrets — for the worker's send path only. Never
 * serialized to a client; the public `listSenders` above strips smtpPass. */
export async function getActiveSenders(): Promise<SenderRow[]> {
  return db
    .select()
    .from(senders)
    .where(eq(senders.isActive, true))
    .orderBy(asc(senders.createdAt));
}

export async function countSenders(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(senders);
  return row?.n ?? 0;
}

export async function insertSenders(
  rows: (typeof senders.$inferInsert)[],
): Promise<void> {
  if (rows.length > 0) await db.insert(senders).values(rows);
}

/** A user's senders, secrets stripped (smtpPass never leaves the DB layer). */
export async function listSenders(userId: string): Promise<Sender[]> {
  const rows = await db
    .select()
    .from(senders)
    .where(eq(senders.userId, userId))
    .orderBy(asc(senders.createdAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    fromName: r.fromName,
    fromEmail: r.fromEmail,
    smtpHost: r.smtpHost,
    smtpPort: r.smtpPort,
    smtpUser: r.smtpUser,
    hourlyLimit: r.hourlyLimit,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));
}
