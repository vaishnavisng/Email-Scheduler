/** Round-robin pick. `n` is a monotonic counter (a Redis INCR result), so
 * selection is stable across workers and processes. Empty list → undefined. */
export function pickRoundRobin<T>(list: T[], n: number): T | undefined {
  if (list.length === 0) return undefined;
  return list[n % list.length];
}
