/** Round-robin pick. `n` is a monotonic counter (a Redis INCR result), so
 * selection is stable across workers and processes. Empty list → undefined. */
export function pickRoundRobin<T>(list: T[], n: number): T | undefined {
  if (list.length === 0) return undefined;
  return list[n % list.length];
}

interface QuotaSender {
  id: string;
  hourlyLimit: number | null;
}

/** Pick the active sender with the most remaining quota this window. Remaining =
 * (sender.hourlyLimit ?? envDefault) − used-so-far. First wins ties. When all are
 * exhausted it still returns the least-spent one, so the caller re-parks it via a
 * QUOTA reservation rather than crashing. Pure (Redis I/O stays in the caller),
 * so it's unit-testable. Empty list → undefined. */
export function pickMostQuota<T extends QuotaSender>(
  senders: T[],
  used: Map<string, number>,
  envDefault: number,
): T | undefined {
  let best: T | undefined;
  let bestRemaining = -Infinity;
  for (const s of senders) {
    const remaining = (s.hourlyLimit ?? envDefault) - (used.get(s.id) ?? 0);
    if (remaining > bestRemaining) {
      best = s;
      bestRemaining = remaining;
    }
  }
  return best;
}
