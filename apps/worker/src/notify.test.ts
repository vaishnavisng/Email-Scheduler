import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  notifyRateLimit,
  dedupeKey,
  rateLimitBlocks,
  type RateLimitContext,
} from './notify.js';
import type { SlackIntegrationRow } from '@outbox/db';

const ctx: RateLimitContext = {
  senderLabel: 'primary',
  limit: 200,
  count: 200,
  nextWindowAt: new Date('2026-08-29T18:00:00.000Z'),
  campaignName: 'Launch blast',
};

const integration: SlackIntegrationRow = {
  id: 'i1',
  userId: 'u1',
  teamId: 't1',
  teamName: 'Acme',
  channel: '#alerts',
  webhookUrl: 'https://hooks.slack.test/abc',
  accessToken: 'xoxb-test',
  createdAt: new Date(),
};

/** In-memory SET NX EX: returns 'OK' the first time a key is claimed, null after. */
function fakeRedis(): Redis {
  const keys = new Set<string>();
  return {
    set: vi.fn(async (key: string) =>
      keys.has(key) ? null : (keys.add(key), 'OK'),
    ),
  } as unknown as Redis;
}

const fixedNow = () => Date.parse('2026-08-29T17:30:00.000Z');

describe('dedupeKey', () => {
  it('is scoped to user + sender + window', () => {
    expect(dedupeKey('u1', 's1', 42)).toBe('slack:notified:u1:s1:42');
  });
});

describe('rateLimitBlocks', () => {
  it('renders the sender label, limit and campaign name', () => {
    const text = JSON.stringify(rateLimitBlocks(ctx));
    expect(text).toContain('primary');
    expect(text).toContain('200');
    expect(text).toContain('Launch blast');
  });
});

describe('notifyRateLimit', () => {
  it('no integration → silent no-op: no dedupe write, no post', async () => {
    const redis = fakeRedis();
    const post = vi.fn();
    await notifyRateLimit('u1', 's1', ctx, {
      redis,
      getIntegration: async () => null,
      now: fixedNow,
      post,
    });
    expect(redis.set).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('dedupes: 400 re-parked jobs → exactly one message per window', async () => {
    const redis = fakeRedis();
    const post = vi.fn(async () => {});
    const deps = {
      redis,
      getIntegration: async () => integration,
      now: fixedNow,
      post,
    };
    for (let i = 0; i < 400; i++) {
      await notifyRateLimit('u1', 's1', ctx, deps);
    }
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(integration.webhookUrl, {
      blocks: rateLimitBlocks(ctx),
    });
  });

  it('a dead webhook never throws', async () => {
    await expect(
      notifyRateLimit('u1', 's1', ctx, {
        redis: fakeRedis(),
        getIntegration: async () => integration,
        now: fixedNow,
        post: async () => {
          throw new Error('502 from slack');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
