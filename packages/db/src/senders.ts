import { asc, eq } from 'drizzle-orm';
import type { Sender } from '@outbox/shared';
import { db } from './index.js';
import { senders } from './schema.js';

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
