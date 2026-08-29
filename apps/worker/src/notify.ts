import type { Redis } from 'ioredis';
import { env } from '@outbox/shared';
import { createRedis, windowFor } from '@outbox/queue';
import { getSlackIntegration, type SlackIntegrationRow } from '@outbox/db';

/**
 * Slack rate-limit notification. Replaces the Phase 5 log stub.
 *
 * Contract (docs/DECISIONS/0007-slack.md, ARCHITECTURE §9):
 *   - Integration is read from the DB on EVERY call, never cached at boot, so a
 *     user connecting Slack later gets notifications with no redeploy.
 *   - No integration → return silently (no crash, no error-level log).
 *   - Deduped per user+sender+window via SET NX EX, so 400 re-parked jobs
 *     produce one message, not 400.
 *   - The whole thing is wrapped in try/catch: a dead webhook must never fail an
 *     email job.
 */

export interface RateLimitContext {
  senderLabel: string;
  limit: number;
  count: number;
  nextWindowAt: Date;
  campaignName: string;
}

/** Injectable seams — real defaults in prod, fakes in tests (no DB/Redis/HTTP). */
export interface NotifyDeps {
  redis: Redis;
  getIntegration: (userId: string) => Promise<SlackIntegrationRow | null>;
  now: () => number;
  post: (webhookUrl: string, body: unknown) => Promise<void>;
}

/** Dedupe key: one Slack message per user+sender+window. Pure, so it's testable. */
export function dedupeKey(
  userId: string,
  senderId: string,
  window: number,
): string {
  return `slack:notified:${userId}:${senderId}:${window}`;
}

/** Block Kit payload. Pure — the notify test asserts the fields render. */
export function rateLimitBlocks(ctx: RateLimitContext): unknown[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '⏳ Sender rate limit reached' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Sender:*\n${ctx.senderLabel}` },
        { type: 'mrkdwn', text: `*Campaign:*\n${ctx.campaignName}` },
        { type: 'mrkdwn', text: `*Hourly limit:*\n${ctx.limit}` },
        { type: 'mrkdwn', text: `*Sent this window:*\n${ctx.count}` },
        {
          type: 'mrkdwn',
          text: `*Resumes:*\n<!date^${Math.floor(
            ctx.nextWindowAt.getTime() / 1000,
          )}^{date_short_pretty} {time}|${ctx.nextWindowAt.toISOString()}>`,
        },
      ],
    },
  ];
}

async function postWebhook(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`slack webhook returned ${res.status}`);
}

let sharedRedis: Redis | undefined;
function defaultRedis(): Redis {
  // Lazy so importing this module (e.g. in tests) opens no connection.
  if (!sharedRedis) sharedRedis = createRedis();
  return sharedRedis;
}

export async function notifyRateLimit(
  userId: string,
  senderId: string,
  ctx: RateLimitContext,
  deps: Partial<NotifyDeps> = {},
): Promise<void> {
  const getIntegration = deps.getIntegration ?? getSlackIntegration;
  const redis = deps.redis ?? defaultRedis();
  const now = deps.now ?? Date.now;
  const post = deps.post ?? postWebhook;
  try {
    const integration = await getIntegration(userId);
    if (!integration) return; // not connected — nothing to do, not an error

    const window = windowFor(now(), env.RATE_LIMIT_WINDOW_MS);
    const ttl = Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000);
    const claimed = await redis.set(
      dedupeKey(userId, senderId, window),
      '1',
      'EX',
      ttl,
      'NX',
    );
    if (claimed !== 'OK') return; // already notified for this window

    await post(integration.webhookUrl, { blocks: rateLimitBlocks(ctx) });
  } catch (err) {
    // A dead webhook (or any failure) must never fail the email job.
    console.warn('notifyRateLimit: suppressed', err);
  }
}
