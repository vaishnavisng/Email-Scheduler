import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { slackIntegrations } from './schema.js';

export type SlackIntegrationRow = typeof slackIntegrations.$inferSelect;

/**
 * Slack incoming-webhook integration, one per user (UNIQUE user_id). Written by
 * the OAuth callback, read by the worker on every rate-limit notification (never
 * cached, so connecting Slack later starts notifications with no redeploy).
 */
export interface SlackIntegrationInput {
  teamId: string;
  teamName: string;
  channel: string;
  webhookUrl: string;
  accessToken: string;
}

export async function getSlackIntegration(
  userId: string,
): Promise<SlackIntegrationRow | null> {
  const [row] = await db
    .select()
    .from(slackIntegrations)
    .where(eq(slackIntegrations.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Upsert by user_id — reconnecting replaces the old webhook rather than 500ing
 * on the unique constraint. */
export async function upsertSlackIntegration(
  userId: string,
  input: SlackIntegrationInput,
): Promise<void> {
  await db
    .insert(slackIntegrations)
    .values({ userId, ...input })
    .onConflictDoUpdate({
      target: slackIntegrations.userId,
      set: { ...input },
    });
}

export async function deleteSlackIntegration(userId: string): Promise<void> {
  await db
    .delete(slackIntegrations)
    .where(eq(slackIntegrations.userId, userId));
}
