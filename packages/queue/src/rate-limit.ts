import { readFileSync } from 'node:fs';
import type { Redis } from 'ioredis';

/**
 * Per-sender throttle + hourly quota, reserved atomically in Redis so it's
 * correct across multiple worker instances. All state lives in Redis (CONVENTIONS.md
 * #4); the Lua script (../rate-limit.lua) is the only place the check and the
 * reserve happen together. See docs/DECISIONS/0006-rate-limiting.md.
 *
 * The .lua sits at the package root so this same relative URL resolves whether
 * the worker runs from src (tsx) or dist (tsc) — the file is a sibling of both.
 */
const SCRIPT = readFileSync(new URL('../rate-limit.lua', import.meta.url), 'utf8');

export type RateReason = 'OK' | 'THROTTLE' | 'QUOTA';

export interface Reservation {
  ok: boolean;
  reason: RateReason;
  /** For THROTTLE, ms to wait before the next attempt; otherwise 0. */
  waitMs: number;
}

// ponytail: cast — ioredis has no types for a defineCommand'd method. The Lua
// returns a 3-element array; ioredis surfaces it as (number | string)[].
type RedisWithReserve = Redis & {
  reserveSlot(
    throttleKey: string,
    quotaKey: string,
    globalKey: string,
    now: number,
    minDelay: number,
    limit: number,
    ttl: number,
    globalLimit: number,
  ): Promise<[number, string, number]>;
};

/** Register the reserve script on a client (idempotent; ioredis caches by SHA).
 * Call once per client before reserveSlot. */
export function defineReserveSlot(redis: Redis): void {
  const r = redis as RedisWithReserve;
  if (typeof r.reserveSlot === 'function') return;
  redis.defineCommand('reserveSlot', { numberOfKeys: 3, lua: SCRIPT });
}

/** Current fixed rate-limit window index. Pure, so it's unit-testable. */
export function windowFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

export interface ReserveOptions {
  senderId: string;
  now: number;
  minDelay: number;
  limit: number;
  windowMs: number;
  /** 0 disables the global cap. */
  globalLimit: number;
}

/** Attempt to reserve one send slot for a sender. Requires defineReserveSlot on
 * this client first. Returns which gate (if any) blocked. */
export async function reserveSlot(
  redis: Redis,
  opts: ReserveOptions,
): Promise<Reservation> {
  const window = windowFor(opts.now, opts.windowMs);
  // TTL twice the window so a counter outlives its window for late readers but
  // is gone well before the index is reused.
  const ttl = Math.ceil((2 * opts.windowMs) / 1000);
  const [ok, reason, waitMs] = await (redis as RedisWithReserve).reserveSlot(
    `throttle:${opts.senderId}`,
    `quota:${opts.senderId}:${window}`,
    `quota:global:${window}`,
    opts.now,
    opts.minDelay,
    opts.limit,
    ttl,
    opts.globalLimit,
  );
  return { ok: ok === 1, reason: reason as RateReason, waitMs };
}

/** Per-sender counts used so far in `window`, for quota-aware sender selection.
 * One MGET; senders with no key yet read as 0. */
export async function readUsed(
  redis: Redis,
  senderIds: string[],
  window: number,
): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (senderIds.length === 0) return used;
  const values = await redis.mget(
    ...senderIds.map((id) => `quota:${id}:${window}`),
  );
  senderIds.forEach((id, i) => used.set(id, Number(values[i] ?? 0)));
  return used;
}
