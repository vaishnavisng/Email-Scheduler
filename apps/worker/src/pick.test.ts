import { describe, it, expect } from 'vitest';
import { pickRoundRobin } from './pick.js';

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
