import { describe, it, expect } from 'vitest';
import { pickRoundRobin, pickMostQuota } from './pick.js';

describe('pickRoundRobin', () => {
  const senders = ['a', 'b', 'c'];

  it('cycles through the list as the counter increments', () => {
    expect([1, 2, 3, 4].map((n) => pickRoundRobin(senders, n))).toEqual([
      'b',
      'c',
      'a',
      'b',
    ]);
  });

  it('returns undefined for an empty list', () => {
    expect(pickRoundRobin([], 7)).toBeUndefined();
  });
});

describe('pickMostQuota', () => {
  const s = (id: string, hourlyLimit: number | null = null) => ({ id, hourlyLimit });

  it('picks the sender with the most remaining quota', () => {
    const senders = [s('a'), s('b'), s('c')];
    const used = new Map([['a', 8], ['b', 3], ['c', 9]]);
    expect(pickMostQuota(senders, used, 10)?.id).toBe('b'); // 2 vs 7 vs 1 remaining
  });

  it('honours a per-sender hourlyLimit override', () => {
    const senders = [s('a', 5), s('b', 100)];
    const used = new Map([['a', 4], ['b', 90]]);
    expect(pickMostQuota(senders, used, 10)?.id).toBe('b'); // 1 vs 10 remaining
  });

  it('returns the least-spent sender even when all are exhausted', () => {
    const senders = [s('a'), s('b')];
    const used = new Map([['a', 12], ['b', 11]]);
    expect(pickMostQuota(senders, used, 10)?.id).toBe('b'); // -2 vs -1
  });

  it('returns undefined for an empty list', () => {
    expect(pickMostQuota([], new Map(), 10)).toBeUndefined();
  });
});
