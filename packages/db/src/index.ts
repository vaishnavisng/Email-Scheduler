import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '@outbox/shared';

// postgres.js with prepare:false — required for Drizzle + pgbouncer-safe usage.
export const sql = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(sql);

export * as schema from './schema.js';
export {
  scheduledAtFor,
  clampPagination,
  createCampaignWithEmails,
  listEmails,
  claimForSending,
  markSent,
  markFailed,
  resetForRetry,
  getReconcilable,
  resetStalledSends,
  getEmailForSchedule,
  updateScheduledAt,
  type CreateCampaignInput,
  type EmailRow,
} from './emails.js';
export { ensureUser, getUser } from './users.js';
export {
  listSenders,
  getActiveSenders,
  countSenders,
  insertSenders,
  type SenderRow,
} from './senders.js';

/** Apply pending migrations. Shared by the migrate CLI and the bootstrap script,
 * so the migrations-folder path is resolved in one place. No-op if the folder is
 * absent (keeps first-run connectivity checks green). */
export async function runMigrations(): Promise<void> {
  const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
  if (!existsSync(folder)) {
    console.log('No migrations folder — nothing to apply.');
    return;
  }
  await migrate(db, { migrationsFolder: folder });
  console.log('Migrations applied.');
}

/** Liveness ping for /health. Returns true if a trivial query succeeds. */
export async function pingDb(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
