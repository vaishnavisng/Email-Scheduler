import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql, pingDb } from './index.js';
import { users } from './schema.js';
import {
  ensureUser,
  createCampaignWithEmails,
  claimForSending,
  resetStalledSends,
} from './index.js';

// Needs a live Postgres with migrations applied. Skips when unreachable so
// `pnpm test` stays green without Docker; runs for real during the gate. The
// probe is bounded so an unreachable host skips fast instead of hanging.
const dbUp = await Promise.race([
  pingDb(),
  new Promise<boolean>((r) => setTimeout(() => r(false), 2500)),
]);
const createdUsers: string[] = [];

async function seedRow(): Promise<string> {
  const user = await ensureUser({
    googleSub: `test-${randomUUID()}`,
    email: 'claimtest@outbox.local',
    name: 'Claim Test',
  });
  createdUsers.push(user.id);
  const { emails } = await createCampaignWithEmails(user.id, {
    subject: 's',
    body: 'b',
    startAt: new Date(),
    delayMs: 0,
    recipients: [`${randomUUID()}@example.com`],
  });
  const row = emails[0];
  if (!row) throw new Error('seed produced no email row');
  return row.id;
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.delete(users).where(eq(users.id, id)); // cascades to campaign + emails
  }
  await sql.end();
});

describe.skipIf(!dbUp)('idempotency: guarded claim', () => {
  it('two concurrent claims on one row → exactly one succeeds', async () => {
    const id = await seedRow();
    const [a, b] = await Promise.all([claimForSending(id), claimForSending(id)]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners.length).toBe(1);
    expect(winners[0]?.attempts).toBe(1); // only the winner bumped attempts
  });

  it('resetStalledSends rescues a stuck sending row (attempts < 3)', async () => {
    const id = await seedRow();
    await claimForSending(id); // row is now `sending`, no message_id, attempts 1
    // Negative threshold ⇒ cutoff is in the future ⇒ "stalled for more than -1s",
    // i.e. treat every in-flight row as stalled, without waiting the real window.
    const reset = await resetStalledSends(-1000);
    expect(reset.some((r) => r.id === id)).toBe(true);
    // Reset back to `scheduled` ⇒ it can be claimed again.
    expect(await claimForSending(id)).not.toBeNull();
  });
});
