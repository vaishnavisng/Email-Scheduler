import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
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
  type CreateCampaignInput,
} from './emails.js';
export { ensureUser, getUser } from './users.js';
export { listSenders } from './senders.js';

/** Liveness ping for /health. Returns true if a trivial query succeeds. */
export async function pingDb(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
